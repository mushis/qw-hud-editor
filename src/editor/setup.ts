// "Import setup": from the user's Quake folder, loads ezquake/configs/config.cfg and the charset,
// crosshair and HUD pictures it uses. Files are read in the browser; nothing is uploaded.
import { lastValues } from '../hud/cfg'
import { importKind, isHudPicture, texturePriority, type CrosshairLook, type PathFile } from '../render/textures'
import { importCfg } from './actions'
import { readFileText } from './io'

// A folder read lazily: only the subfolders looked into are listed (a Quake folder can hold thousands of files).
export interface Folder {
  entries(): Promise<Map<string, Entry>> // keyed by lower-case name: Windows names ignore case
}
type Entry = { name: string; file: () => Promise<File> } | { name: string; folder: Folder }

const cached = (list: () => Promise<Entry[]>): Folder => {
  let entries: Promise<Map<string, Entry>> | null = null
  return { entries: () => (entries ??= list().then((all) => new Map(all.map((e) => [e.name.toLowerCase(), e])))) }
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
    const e: Entry | undefined = (await dir.entries()).get(part.toLowerCase())
    dir = e && 'folder' in e ? e.folder : null
    if (!dir) return null
  }
  return dir
}

async function fileAt(root: Folder, path: string): Promise<PathFile | null> {
  const parts = path.split('/')
  const dir = await folderAt(root, parts.slice(0, -1).join('/'))
  const e = dir && (await dir.entries()).get(parts[parts.length - 1].toLowerCase())
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

const clamp = (v: string | undefined, fallback: number, max: number) => {
  const n = parseFloat(v ?? '')
  return Number.isFinite(n) ? Math.min(max, Math.max(0, n)) : fallback
}

export interface SetupResult {
  ok: boolean
  lines: string[] // what was loaded or kept, one line each
}

const fileName = (f: PathFile) => f.path.split('/').pop()!

const isQuakeRoot = async (dir: Folder) => {
  const top = await dir.entries()
  return ['id1', 'qw'].every((d) => top.get(d) && 'folder' in top.get(d)!)
}

// The Quake folder is the chosen one, or found in its subfolders (up to two levels down, e.g. Games/nQuake).
async function findQuakeRoot(chosen: Folder): Promise<{ dir: Folder; path: string } | null> {
  let level = [{ dir: chosen, path: '' }]
  for (let depth = 0; depth <= 2 && level.length; depth++) {
    const next: typeof level = []
    for (const { dir, path } of level) {
      if (await isQuakeRoot(dir)) return { dir, path }
      for (const e of (await dir.entries().catch(() => new Map<string, Entry>())).values()) {
        if ('folder' in e) next.push({ dir: e.folder, path: path ? `${path}/${e.name}` : e.name })
      }
    }
    level = next
  }
  return null
}

export async function importSetup(chosen: Folder, chosenName = ''): Promise<SetupResult> {
  const found = await findQuakeRoot(chosen)
  if (!found) {
    const inside = /^(id1|qw|ezquake)$/i.test(chosenName) ? ` You chose the ${chosenName} folder: choose the folder that holds it.` : ' Choose your Quake folder.'
    return { ok: false, lines: [`No folder with id1 and qw inside was found here.${inside}`] }
  }
  const root = found.dir
  const where = found.path ? ` in ${found.path}` : ''
  const cfg = await fileAt(root, 'ezquake/configs/config.cfg')
  if (!cfg) return { ok: false, lines: [`Found the Quake folder${where}, but it has no ezquake/configs/config.cfg. Start ezQuake once and save your config (cfg_save) first.`] }

  const text = await readFileText(cfg.file)
  const lines = [...(where ? [`Quake folder found${where}.`] : []), importCfg('config.cfg', text)]
  const cvars = lastValues(text)

  // loadcharset sets gl_consolefont, so whichever comes last wins.
  const charsetCvar = Object.keys(cvars).filter((k) => k === 'gl_consolefont' || k === 'loadcharset').pop()
  const charset = charsetCvar && cvars[charsetCvar].trim()
  const charsetFile = charset ? await findImage(root, ['textures/charsets'], charset) : null
  if (charsetFile) {
    await importKind('charset', charset!, [charsetFile])
    lines.push(`Charset: ${fileName(charsetFile)}.`)
  } else {
    lines.push(charset ? `Charset: "${charset}" isn't in textures/charsets, so the current one stays.` : 'Charset: the cfg doesn\'t set gl_consolefont or loadcharset, so the current one stays.')
  }

  const crosshair = cvars.crosshairimage?.trim()
  // ezQuake loads crosshairimage from crosshairs/; textures/crosshairs is also checked.
  const crosshairFile = crosshair ? await findImage(root, ['crosshairs', 'textures/crosshairs', 'textures/crosshair'], crosshair) : null
  if (crosshairFile) {
    const look: CrosshairLook = {
      size: clamp(cvars.crosshairsize, 1, 20),
      color: cvars.crosshaircolor ?? '255 0 0',
      alpha: clamp(cvars.crosshairalpha, 1, 1),
    }
    await importKind('crosshair', crosshair!, [crosshairFile], look)
    lines.push(`Crosshair: ${fileName(crosshairFile)}.`)
  } else {
    lines.push(crosshair ? `Crosshair: "${crosshair}" isn't in crosshairs, so the current one stays.` : 'Crosshair: the cfg doesn\'t set crosshairimage, so the current one stays.')
  }

  const wad = await wadPictures(root)
  const names = wad.length ? await importKind('wad', 'textures/wad', wad) : []
  lines.push(names.length ? `HUD pictures: ${names.length} from textures/wad.` : 'HUD pictures: none in textures/wad, so the current ones stay.')
  return { ok: true, lines }
}
