// "Import setup": from the user's Quake folder, loads ezquake/configs/config.cfg and the charset,
// crosshair and HUD pictures it uses. Files are read in the browser; nothing is uploaded.
import { lastValues } from '../hud/cfg'
import { crosshairFromCvars } from '../render/crosshair'
import { importKind, isHudPicture, removeKind, texturePriority, type PathFile } from '../render/textures'
import { useStore } from '../store'
import { importCfg } from './actions'
import { readFileText } from './io'

// A folder read lazily: only the subfolders looked into are listed (a Quake folder can hold thousands of files).
export interface Folder {
  entries(): Promise<Map<string, Entry>> // keyed by key(name): Windows names ignore case
}
type Entry = { name: string; file: () => Promise<File> } | { name: string; folder: Folder }

// Names are matched ignoring case, accents written either way and spaces around them.
const key = (name: string) => name.normalize('NFC').trim().toLowerCase()

const cached = (list: () => Promise<Entry[]>): Folder => {
  let entries: Promise<Map<string, Entry>> | null = null
  return { entries: () => (entries ??= list().then((all) => new Map(all.map((e) => [key(e.name), e])))) }
}

// From the folder picker (Chrome, Edge, Opera).
export function handleFolder(dir: FileSystemDirectoryHandle): Folder {
  return cached(async () => {
    const out: Entry[] = []
    for await (const h of dir.values()) {
      out.push(h.kind === 'file' ? { name: h.name, file: () => (h as FileSystemFileHandle).getFile() } : { name: h.name, folder: handleFolder(h as FileSystemDirectoryHandle) })
    }
    return out
  })
}

// From a dropped folder (every browser).
export function entryFolder(dir: FileSystemDirectoryEntry): Folder {
  return cached(async () => {
    const reader = dir.createReader()
    const out: Entry[] = []
    // readEntries returns the folder in batches until an empty one.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
      if (!batch.length) return out
      for (const e of batch) {
        out.push(
          e.isFile
            ? { name: e.name, file: () => new Promise<File>((resolve, reject) => (e as FileSystemFileEntry).file(resolve, reject)) }
            : { name: e.name, folder: entryFolder(e as FileSystemDirectoryEntry) },
        )
      }
    }
  })
}

async function folderAt(root: Folder, path: string): Promise<Folder | null> {
  let dir: Folder | null = root
  for (const part of path.split('/').filter(Boolean)) {
    const e: Entry | undefined = (await dir.entries()).get(key(part))
    dir = e && 'folder' in e ? e.folder : null
    if (!dir) return null
  }
  return dir
}

async function fileAt(root: Folder, path: string): Promise<PathFile | null> {
  const parts = path.split('/')
  const dir = await folderAt(root, parts.slice(0, -1).join('/'))
  const e = dir && (await dir.entries()).get(key(parts[parts.length - 1]))
  return e && 'file' in e ? { path: `${parts.slice(0, -1).join('/')}/${e.name}`, file: await e.file() } : null
}

// ezQuake's own folder is searched before qw, and loads .tga, .png, .jpg, then .pcx; the extension in a cvar is ignored.
const GAMEDIRS = ['ezquake', 'qw']
const EXTENSIONS = ['tga', 'png', 'jpg', 'pcx']

async function findImage(root: Folder, folders: string[], name: string): Promise<PathFile | null> {
  const base = name.replace(/\\/g, '/').replace(/\.[^./]+$/, '')
  for (const game of GAMEDIRS) {
    for (const folder of folders) {
      for (const ext of EXTENSIONS) {
        const found = await fileAt(root, `${game}/${folder}/${base}.${ext}`)
        if (found) return found
      }
    }
  }
  return null
}

// The HUD pictures in textures/wad; for a name in both folders, or with several extensions, the one ezQuake uses.
async function wadPictures(root: Folder): Promise<PathFile[]> {
  const best = new Map<string, { rank: number; entry: Entry; path: string }>()
  for (const [g, game] of GAMEDIRS.entries()) {
    const dir = await folderAt(root, `${game}/textures/wad`)
    for (const entry of dir ? (await dir.entries()).values() : []) {
      const m = entry.name.toLowerCase().match(/^(.+)\.(tga|png|jpe?g|pcx)$/)
      if (!('file' in entry) || !m || !isHudPicture(m[1]) || /_(luma|glow)$/.test(m[1])) continue
      const path = `${game}/textures/wad/${entry.name}`
      const rank = g * 100 + texturePriority(path)
      if (!best.has(m[1]) || rank < best.get(m[1])!.rank) best.set(m[1], { rank, entry, path })
    }
  }
  return Promise.all([...best.values()].map(async ({ entry, path }) => ({ path, file: await (entry as { file: () => Promise<File> }).file() })))
}

export interface SetupResult {
  ok: boolean
  lines: string[] // what was loaded or kept, one line each
}

const fileName = (f: PathFile) => f.path.split('/').pop()!

// A folder that can't be read (no permission, a broken link) counts as empty instead of failing the search.
const entriesOf = (dir: Folder) => dir.entries().catch(() => new Map<string, Entry>())
const hasFolder = (entries: Map<string, Entry>, name: string) => 'folder' in (entries.get(name) ?? {})

// How much a folder looks like the Quake folder: 2 with id1 and qw, 1 with only qw or ezquake (id1 isn't
// needed for the HUD), 0 otherwise.
async function quakeScore(dir: Folder): Promise<number> {
  const top = await entriesOf(dir)
  if (hasFolder(top, 'id1') && hasFolder(top, 'qw')) return 2
  return hasFolder(top, 'qw') || hasFolder(top, 'ezquake') ? 1 : 0
}

// The Quake folder is the chosen one, or found in its subfolders (up to two levels down, e.g. Games/nQuake).
// A folder with id1 and qw wins over one with only qw or ezquake.
async function findQuakeRoot(chosen: Folder): Promise<{ dir: Folder; path: string } | null> {
  let best: { dir: Folder; path: string; score: number } | null = null
  let level = [{ dir: chosen, path: '' }]
  for (let depth = 0; depth <= 2 && level.length; depth++) {
    const next: typeof level = []
    for (const { dir, path } of level) {
      const score = await quakeScore(dir)
      if (score === 2) return { dir, path }
      if (score && !best) best = { dir, path, score }
      for (const e of (await entriesOf(dir)).values()) {
        if ('folder' in e) next.push({ dir: e.folder, path: path ? `${path}/${e.name}` : e.name })
      }
    }
    level = next
  }
  return best
}

// ezquake/configs/config.cfg is where ezQuake saves it; older setups keep it in qw or the other folders.
const CONFIG_FOLDERS = ['ezquake/configs', 'qw/configs', 'ezquake', 'qw', 'id1']

async function findConfig(root: Folder): Promise<PathFile | null> {
  for (const folder of CONFIG_FOLDERS) {
    const found = (await fileAt(root, `${folder}/config.cfg`)) ?? (await fileAt(root, `${folder}/config.cfg.txt`))
    if (found) return found
  }
  // Saved under another name (cfg_save mine): the newest cfg in a configs folder.
  const cfgs: PathFile[] = []
  for (const folder of CONFIG_FOLDERS.slice(0, 2)) {
    const dir = await folderAt(root, folder)
    for (const e of dir ? (await entriesOf(dir)).values() : []) {
      if ('file' in e && /\.cfg(\.txt)?$/i.test(e.name)) cfgs.push({ path: `${folder}/${e.name}`, file: await e.file() })
    }
  }
  return cfgs.sort((a, b) => b.file.lastModified - a.file.lastModified)[0] ?? null
}

export async function importSetup(chosen: Folder, chosenName = ''): Promise<SetupResult> {
  const found = await findQuakeRoot(chosen)
  if (!found) {
    const inside = /^(id1|qw|ezquake)$/i.test(chosenName) ? ` You chose the ${chosenName} folder: choose the folder that holds it.` : ' Choose your Quake folder.'
    // What the browser could see, to tell a wrong folder from one it can't read.
    const seen = [...(await entriesOf(chosen)).values()].filter((e) => 'folder' in e).map((e) => e.name)
    const listed = seen.length ? ` Folders the browser sees in ${chosenName || 'it'}: ${seen.slice(0, 12).join(', ')}${seen.length > 12 ? '…' : ''}.` : ` The browser sees no folders in ${chosenName || 'it'}.`
    return { ok: false, lines: [`No folder with id1 and qw inside was found here.${inside}${listed}`] }
  }
  const root = found.dir
  const where = found.path ? ` in ${found.path}` : ''
  const cfg = await findConfig(root)
  if (!cfg) {
    const ezquake = await folderAt(root, 'ezquake')
    const inEzquake = ezquake ? [...(await entriesOf(ezquake)).values()].map((e) => e.name + ('folder' in e ? '/' : '')) : []
    const seen = ezquake
      ? ` The browser sees in ezquake: ${inEzquake.slice(0, 15).join(', ') || 'nothing'}${inEzquake.length > 15 ? '…' : ''}.`
      : ' There is no ezquake folder in it.'
    return {
      ok: false,
      lines: [`Found the Quake folder${where}, but no config.cfg in ezquake/configs, qw/configs, ezquake, qw or id1, and no other cfg in a configs folder.${seen} In ezQuake, cfg_save writes it.`],
    }
  }

  const text = await readFileText(cfg.file)
  const lines = [
    ...(where ? [`Quake folder found${where}.`] : []),
    ...(key(cfg.path) === 'ezquake/configs/config.cfg' ? [] : [`Config: ${cfg.path}.`]),
    importCfg(fileName(cfg), text),
  ]
  const cvars = lastValues(text)

  // loadcharset sets gl_consolefont, so whichever comes last wins.
  const charsetCvar = Object.keys(cvars).filter((k) => k === 'gl_consolefont' || k === 'loadcharset').pop()
  const charset = charsetCvar && cvars[charsetCvar].trim()
  const charsetFile = charset ? await findImage(root, ['textures/charsets'], charset) : null
  // Unset, the game uses povo5 (from ezquake.pk3), which the editor has.
  if (!charset || (!charsetFile && /^povo5(\.\w+)?$/i.test(charset))) {
    await removeKind('charset')
    lines.push(`Charset: ${charset ? 'povo5' : "the cfg doesn't set gl_consolefont or loadcharset, so ezQuake's povo5"}, the editor's own.`)
  } else if (charsetFile) {
    await importKind('charset', charset, [charsetFile])
    lines.push(`Charset: ${fileName(charsetFile)}.`)
  } else {
    lines.push(`Charset: "${charset}" isn't in textures/charsets, so the current one stays.`)
  }

  const look = crosshairFromCvars(cvars)
  useStore.getState().setSettings({ crosshair: look })
  const crosshair = cvars.crosshairimage?.trim()
  // ezQuake loads crosshairimage from crosshairs/; textures/crosshairs is also checked.
  const crosshairFile = crosshair ? await findImage(root, ['crosshairs', 'textures/crosshairs', 'textures/crosshair'], crosshair) : null
  if (!crosshair) {
    // No image: the game draws its own crosshair, picked by the crosshair cvar.
    await removeKind('crosshair')
    lines.push(`Crosshair: ezQuake's own, crosshair ${look.crosshair}${look.crosshair ? '' : ' (none)'}.`)
  } else if (crosshairFile) {
    await importKind('crosshair', crosshair, [crosshairFile])
    lines.push(`Crosshair: ${fileName(crosshairFile)}.`)
  } else {
    lines.push(`Crosshair: "${crosshair}" isn't in crosshairs, so the current one stays.`)
  }

  const wad = await wadPictures(root)
  const names = wad.length ? await importKind('wad', 'textures/wad', wad) : []
  lines.push(names.length ? `HUD pictures: ${names.length} from textures/wad.` : 'HUD pictures: none in textures/wad, so the current ones stay.')
  return { ok: true, lines }
}
