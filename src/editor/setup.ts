// "Import setup": from the user's Quake folder, loads ezquake/configs/config.cfg and the charset,
// crosshair and HUD pictures it uses. Files are read in the browser; nothing is uploaded.
import { lastValues } from '../hud/cfg'
import { crosshairFromCvars } from '../render/crosshair'
import { importKind, isHudPicture, previewImage, removeKind, texturePriority, type PathFile } from '../render/textures'
import { useStore } from '../store'
import { cfgPictures, importCfg } from './actions'
import { readCfgFile } from './cfgFile'

// A folder read lazily: only the subfolders looked into are listed (a Quake folder can hold thousands of files).
export interface Folder {
  entries(): Promise<Map<string, Entry>> // keyed by key(name): Windows names ignore case
  // Opens a name directly, for one the listing left out (the folder picker's listing can miss files).
  open?(name: string): Promise<Entry | null>
}
type Entry = { name: string; file: () => Promise<File> } | { name: string; folder: Folder }

// Names are matched ignoring case, accents written either way and spaces around them.
const key = (name: string) => name.normalize('NFC').trim().toLowerCase()

const cached = (list: () => Promise<Entry[]>): Folder => {
  let entries: Promise<Map<string, Entry>> | null = null
  return { entries: () => (entries ??= list().then((all) => new Map(all.map((e) => [key(e.name), e])))) }
}

// Why direct opens failed, for the error message.
const openErrors: string[] = []

const fileEntry = (h: FileSystemFileHandle): Entry => ({ name: h.name, file: () => h.getFile() })

// From the folder picker (Chrome, Edge, Opera).
export function handleFolder(dir: FileSystemDirectoryHandle): Folder {
  const folder = cached(async () => {
    const out: Entry[] = []
    try {
      for await (const h of dir.values()) {
        out.push(h.kind === 'file' ? fileEntry(h as FileSystemFileHandle) : { name: h.name, folder: handleFolder(h as FileSystemDirectoryHandle) })
      }
    } catch (e) {
      // Keeps what was listed before the error; open() still tries the names it needs.
      openErrors.push(`${dir.name}/ listing: ${(e as Error).name}`)
    }
    return out
  })
  folder.open = async (name) => {
    try {
      return fileEntry(await dir.getFileHandle(name))
    } catch (e) {
      try {
        return { name, folder: handleFolder(await dir.getDirectoryHandle(name)) }
      } catch {
        openErrors.push(`${dir.name}/${name}: ${(e as Error).name}`)
        return null
      }
    }
  }
  return folder
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

const child = async (dir: Folder, name: string): Promise<Entry | null> => (await dir.entries()).get(key(name)) ?? (await dir.open?.(name)) ?? null

async function folderAt(root: Folder, path: string): Promise<Folder | null> {
  let dir: Folder | null = root
  for (const part of path.split('/').filter(Boolean)) {
    const e: Entry | null = await child(dir, part)
    dir = e && 'folder' in e ? e.folder : null
    if (!dir) return null
  }
  return dir
}

async function fileAt(root: Folder, path: string): Promise<PathFile | null> {
  const parts = path.split('/')
  const dir = await folderAt(root, parts.slice(0, -1).join('/'))
  const e = dir && (await child(dir, parts[parts.length - 1]))
  return e && 'file' in e ? { path: `${parts.slice(0, -1).join('/')}/${e.name}`, file: await e.file() } : null
}

// ezQuake searches qw before its own folder (it is added to the search path last, fs.c), and loads .tga, .png,
// .jpg, then .pcx; the extension in a cvar is ignored.
const GAMEDIRS = ['qw', 'ezquake']
const EXTENSIONS = ['tga', 'png', 'jpg', 'pcx']

// `games`: the game folders to look in, [''] for a folder that is no Quake folder (e.g. a textures folder).
async function findImage(root: Folder, folders: string[], name: string, games = GAMEDIRS): Promise<PathFile | null> {
  const base = name.replace(/\\/g, '/').replace(/\.[^./]+$/, '')
  for (const game of games) {
    for (const folder of folders) {
      for (const ext of EXTENSIONS) {
        const found = await fileAt(root, [game, folder, `${base}.${ext}`].filter(Boolean).join('/'))
        if (found) return found
      }
    }
  }
  return null
}

// The HUD pictures (num_0, face1, sb_shells…) in these folders, first ones first; for a name in several of them,
// or with several extensions, the one ezQuake uses.
async function hudPictures(folders: { dir: Folder | null; path: string }[]): Promise<PathFile[]> {
  const best = new Map<string, { rank: number; entry: Entry; path: string }>()
  for (const [g, { dir, path: folder }] of folders.entries()) {
    for (const entry of dir ? (await entriesOf(dir)).values() : []) {
      const m = entry.name.toLowerCase().match(/^(.+)\.(tga|png|jpe?g|pcx)$/)
      if (!('file' in entry) || !m || !isHudPicture(m[1]) || /_(luma|glow)$/.test(m[1])) continue
      const path = `${folder}/${entry.name}`
      const rank = g * 100 + texturePriority(path)
      if (!best.has(m[1]) || rank < best.get(m[1])!.rank) best.set(m[1], { rank, entry, path })
    }
  }
  return Promise.all([...best.values()].map(async ({ entry, path }) => ({ path, file: await (entry as { file: () => Promise<File> }).file() })))
}

// The HUD pictures in textures/wad, qw's before ezquake's.
const wadPictures = async (root: Folder) =>
  hudPictures(await Promise.all(GAMEDIRS.map(async (game) => ({ dir: await folderAt(root, `${game}/textures/wad`), path: `${game}/textures/wad` }))))

export interface SetupResult {
  ok: boolean
  lines: string[] // what was loaded or kept, one line each
  needConfig?: boolean // the folder is fine but its cfg can't be opened from it: ask for the file
  canSkipConfig?: boolean // the folder is fine but no config was imported: the user may go on without one
  charsets?: CharsetChoice[] // a folder of charsets: the user picks one
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

export interface CharsetChoice {
  name: string // file name without extension, as loadcharset takes it
  file: PathFile
  url: string // preview; revoked by the dialog
  w: number
  h: number
}

// Images that can be a charset (square, at least 64 pixels, a 16×16 grid of characters), up to 64 of them.
async function charsetFiles(folders: { dir: Folder | null; path: string }[]): Promise<CharsetChoice[]> {
  const out: CharsetChoice[] = []
  for (const { dir, path } of folders) {
    for (const e of dir ? (await entriesOf(dir)).values() : []) {
      const m = e.name.match(/^(.+)\.(tga|png|jpe?g|webp|pcx)$/i)
      if (!('file' in e) || !m || isHudPicture(m[1].toLowerCase()) || /_(luma|glow)$/i.test(m[1]) || out.length >= 64) continue
      const file = { path: `${path}/${e.name}`, file: await e.file() }
      const img = await previewImage(file.path, file.file)
      if (img && img.w === img.h && img.w >= 64) out.push({ name: m[1], file, ...img })
      else if (img) URL.revokeObjectURL(img.url)
    }
  }
  return out
}

// Loads the charset the user picked from a folder of them.
export async function importCharset(choice: CharsetChoice): Promise<string> {
  await importKind('charset', choice.name, [choice.file])
  return `Charset: ${choice.file.path.split('/').pop()}.`
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

// `config`: the cfg the user picked on its own, when the folder couldn't give it (see needConfig).
// `skipConfig`: go on without a config (see canSkipConfig).
export async function importSetup(chosen: Folder, chosenName = '', config?: File, skipConfig = false): Promise<SetupResult> {
  openErrors.length = 0
  const found = await findQuakeRoot(chosen)
  if (!found) {
    // Not a Quake folder, but HUD pictures (a wad folder: num_0, anum_5, face1…) and/or charsets, in it or in
    // its wad and charsets subfolders (a textures folder): the pictures are loaded, a charset is picked.
    const here = chosenName || 'folder'
    const pictures = await hudPictures([
      { dir: chosen, path: here },
      { dir: await folderAt(chosen, 'wad'), path: `${here}/wad` },
    ])
    const lines: string[] = []
    if (pictures.length) {
      const names = await importKind('wad', chosenName || 'HUD pictures', pictures)
      lines.push(`HUD pictures: ${names.length} loaded from ${chosenName || 'this folder'}.`)
    }
    // The charset and crosshair the last imported cfg names, when they are here; else the charsets to pick from.
    const { cfgCharset, cfgCrosshair } = useStore.getState().settings
    const named = cfgCharset && (await findImage(chosen, ['', 'charsets'], cfgCharset, ['']))
    if (named) lines.push(await loadCharset(chosen, cfgCharset, ['']))
    const crosshair = cfgCrosshair && (await findImage(chosen, ['', 'crosshairs'], cfgCrosshair, ['']))
    if (crosshair) lines.push(await loadCrosshair(chosen, cfgCrosshair, ['']))
    const charsets = named
      ? []
      : (
          await charsetFiles([
            { dir: chosen, path: here },
            { dir: await folderAt(chosen, 'charsets'), path: `${here}/charsets` },
          ])
        ).filter((c) => !crosshair || c.file.path !== crosshair.path)
    if (charsets.length) return { ok: false, charsets, lines: [...lines, `Charsets: ${charsets.length} found. Choose the one to use, or skip.`] }
    const rest = ['Config', !named && 'charset', !crosshair && 'crosshair'].filter(Boolean).join(', ').replace(/, (\w+)$/, ' and $1')
    if (lines.length) return { ok: true, lines: [...lines, `${rest}: none here, so the HUD and the current ones stay.`] }
    const inside = /^(id1|qw|ezquake)$/i.test(chosenName)
      ? ` You chose the ${chosenName} folder: choose the folder that holds it.`
      : ' Choose your Quake folder, or a folder of HUD pictures (num_0, face1…) or charsets.'
    // What the browser could see, to tell a wrong folder from one it can't read.
    const seen = [...(await entriesOf(chosen)).values()].filter((e) => 'folder' in e).map((e) => e.name)
    const listed = seen.length ? ` Folders the browser sees in ${chosenName || 'it'}: ${seen.slice(0, 12).join(', ')}${seen.length > 12 ? '…' : ''}.` : ` The browser sees no folders in ${chosenName || 'it'}.`
    return { ok: false, lines: [`No folder with id1 and qw inside was found here.${inside}${listed}`] }
  }
  const root = found.dir
  const where = found.path ? ` in ${found.path}` : ''
  // Without a config (the user chose to go on without one), the HUD stays as it is and only the folder's HUD
  // pictures are loaded: which charset and crosshair to use is in the config.
  // The charset and crosshair the last imported cfg named are still looked for.
  if (skipConfig) {
    const { cfgCharset, cfgCrosshair } = useStore.getState().settings
    const lines = [...(where ? [`Quake folder found${where}.`] : []), 'Config: not imported, so the HUD and its settings stay as they are.']
    if (cfgCharset) lines.push(await loadCharset(root, cfgCharset, GAMEDIRS))
    if (cfgCrosshair) lines.push(await loadCrosshair(root, cfgCrosshair, GAMEDIRS))
    if (!cfgCharset && !cfgCrosshair) lines.push('Charset and crosshair: the config names them, so the current ones stay.')
    lines.push(await loadWad(root))
    return { ok: true, lines }
  }
  const cfg = config ? { path: config.name, file: config } : await findConfig(root)
  // Chrome doesn't let a site open .cfg files in a folder from the folder picker: they are left out of its
  // listings, and opening one by name is refused ("Name is not allowed", a TypeError). A file input can open it.
  if (!cfg && openErrors.some((e) => e.startsWith('configs/config.cfg: TypeError'))) {
    return {
      ok: false,
      needConfig: true,
      canSkipConfig: true,
      lines: [
        `Found the Quake folder${where}, but the browser doesn't let this site open .cfg files in a folder chosen this way. ` +
          `Choose the config file itself: config.cfg in ${chosenName || 'your Quake folder'}${where ? `/${found.path}` : ''}/ezquake/configs. Or drop the Quake folder on the box instead.`,
      ],
    }
  }
  if (!cfg) {
    const list = async (path: string) => {
      const dir = await folderAt(root, path)
      if (!dir) return ` There is no ${path} folder.`
      const names = [...(await entriesOf(dir)).values()].map((e) => e.name + ('folder' in e ? '/' : ''))
      return ` The browser sees in ${path}: ${names.slice(0, 15).join(', ') || 'nothing'}${names.length > 15 ? '…' : ''}.`
    }
    const opened = openErrors.find((e) => e.startsWith('configs/config.cfg'))
    const listing = openErrors.filter((e) => e.includes('/ listing:'))
    return {
      ok: false,
      canSkipConfig: true,
      lines: [
        `Found the Quake folder${where}, but no config.cfg in ezquake/configs, qw/configs, ezquake, qw or id1, and no other cfg in a configs folder.` +
          (await list('ezquake')) +
          (await list('ezquake/configs')) +
          (opened ? ` Opening ezquake/configs/config.cfg directly gave ${opened.split(': ')[1]}.` : '') +
          (listing.length ? ` Listing failed for: ${listing.join(', ')}.` : '') +
          ' Dropping the Quake folder on this box instead may work.',
      ],
    }
  }

  const text = await readCfgFile(cfg.file)
  if (text === null) return { ok: false, canSkipConfig: true, lines: ['The config was not imported.'] }
  const lines = [
    ...(where ? [`Quake folder found${where}.`] : []),
    ...(config ? [`Config: ${config.name}, chosen on its own.`] : key(cfg.path) === 'ezquake/configs/config.cfg' ? [] : [`Config: ${cfg.path}.`]),
    importCfg(fileName(cfg), text),
  ]
  const cvars = lastValues(text)
  const { charset, crosshair } = cfgPictures(text)

  if (charset) {
    lines.push(await loadCharset(root, charset, GAMEDIRS))
  } else {
    // Unset, the game uses povo5 (from ezquake.pk3), which the editor has.
    await removeKind('charset')
    lines.push("Charset: the cfg doesn't set gl_consolefont or loadcharset, so ezQuake's povo5, the editor's own.")
  }

  const look = crosshairFromCvars(cvars)
  useStore.getState().setSettings({ crosshair: look })
  if (crosshair) {
    lines.push(await loadCrosshair(root, crosshair, GAMEDIRS))
  } else {
    // No image: the game draws its own crosshair, picked by the crosshair cvar.
    await removeKind('crosshair')
    lines.push(`Crosshair: ezQuake's own, crosshair ${look.crosshair}${look.crosshair ? '' : ' (none)'}.`)
  }

  lines.push(await loadWad(root))
  return { ok: true, lines }
}

// The charset loadcharset / gl_consolefont names, from textures/charsets (or, in a folder that is no Quake
// folder, from it or its charsets folder).
async function loadCharset(root: Folder, charset: string, games: string[]): Promise<string> {
  const file = await findImage(root, games === GAMEDIRS ? ['textures/charsets'] : ['', 'charsets'], charset, games)
  if (file) {
    await importKind('charset', charset, [file])
    return `Charset: ${fileName(file)}, as the config names it.`
  }
  // povo5 comes in ezquake.pk3, and the editor has it.
  if (/^povo5(\.\w+)?$/i.test(charset)) {
    await removeKind('charset')
    return "Charset: povo5, the editor's own."
  }
  return `Charset: the config names "${charset}", which isn't in ${games === GAMEDIRS ? 'textures/charsets' : 'this folder'}, so the current one stays.`
}

// The crosshair crosshairimage names, from crosshairs/ (textures/crosshairs is also checked).
async function loadCrosshair(root: Folder, crosshair: string, games: string[]): Promise<string> {
  const folders = games === GAMEDIRS ? ['crosshairs', 'textures/crosshairs', 'textures/crosshair'] : ['', 'crosshairs']
  const file = await findImage(root, folders, crosshair, games)
  if (!file) return `Crosshair: the config names "${crosshair}", which isn't in ${games === GAMEDIRS ? 'crosshairs' : 'this folder'}, so the current one stays.`
  await importKind('crosshair', crosshair, [file])
  return `Crosshair: ${fileName(file)}, as the config names it.`
}

async function loadWad(root: Folder): Promise<string> {
  const wad = await wadPictures(root)
  const names = wad.length ? await importKind('wad', 'textures/wad', wad) : []
  return names.length ? `HUD pictures: ${names.length} from textures/wad.` : 'HUD pictures: none in textures/wad, so the current ones stay.'
}
