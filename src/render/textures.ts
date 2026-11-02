// Custom textures the user dropped (png/tga/jpg, gfx.wad, zip/pk3). They replace the built-in
// HUD pictures by name (num_0, sb_shells, face1...), add group pictures (gfx/<name>), or replace
// the charset. Kept in IndexedDB so they survive reloads.
import { create } from 'zustand'
import { setCustomPictures, type Picture } from '../hud/pictures'
import { decodeTga, decodeWad, toPng, unzip } from './decode'

export const CHARSET = '#charset'

interface Stored {
  name: string
  blob: Blob
  w: number
  h: number
}

interface TextureState {
  textures: Record<string, Picture>
  version: number // bumps on every change, for redraws and relayouts
}

export const useTextures = create<TextureState>(() => ({ textures: {}, version: 0 }))

export const getTexture = (name: string): Picture | undefined => useTextures.getState().textures[name]

// ---------------------------------------------------------------- IndexedDB

const DB = 'qw-hud-editor'
const STORE = 'textures'

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'name' })
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction(STORE, mode)
    const req = run(t.objectStore(STORE))
    t.oncomplete = () => resolve(req ? req.result : undefined)
    t.onerror = () => reject(t.error)
  })
}

function publish(list: Stored[], replace: boolean) {
  const prev = useTextures.getState().textures
  if (replace) Object.values(prev).forEach((t) => URL.revokeObjectURL(t.url))
  const textures = replace ? {} : { ...prev }
  for (const s of list) {
    if (textures[s.name]) URL.revokeObjectURL(textures[s.name].url)
    textures[s.name] = { url: URL.createObjectURL(s.blob), w: s.w, h: s.h }
  }
  setCustomPictures(textures)
  useTextures.setState({ textures, version: useTextures.getState().version + 1 })
}

export async function loadSavedTextures() {
  try {
    const all = (await tx<Stored[]>('readonly', (s) => s.getAll() as IDBRequest<Stored[]>)) ?? []
    if (all.length) publish(all, true)
  } catch {
    // no IndexedDB (private window): textures just aren't remembered
  }
}

export async function clearTextures() {
  publish([], true)
  await tx('readwrite', (s) => s.clear()).catch(() => {})
}

// ---------------------------------------------------------------- importing

const IMAGE = /\.(png|tga|jpe?g|webp)$/i
// Status bar pictures, as named in gfx.wad and textures/wad/.
const HUD_PIC = /^(a?num_|face|inv|sb_|ibar|sbar|disc|net$|ram$|turtle$|backtile$)/
// Inside archives, other images only count in folders that look like HUD graphics.
const HUD_FOLDER = /(^|\/)[^/]*(wad|gfx|hud|score|char)[^/]*\//i

const baseName = (path: string) =>
  path
    .split('/')
    .pop()!
    .replace(/\.[^.]+$/, '')
    .toLowerCase()

const isCharset = (path: string, name: string, w: number, h: number) =>
  name === 'conchars' || /(^|\/)charsets?\//i.test(path) || (name.includes('char') && w === h)

async function fromImage(path: string, data: Uint8Array): Promise<Stored | null> {
  let blob: Blob
  let w: number
  let h: number
  if (/\.tga$/i.test(path)) {
    const img = decodeTga(data)
    blob = await toPng(img)
    w = img.w
    h = img.h
  } else {
    blob = new Blob([data as BlobPart], { type: /\.png$/i.test(path) ? 'image/png' : /\.webp$/i.test(path) ? 'image/webp' : 'image/jpeg' })
    const bitmap = await createImageBitmap(blob)
    w = bitmap.width
    h = bitmap.height
    bitmap.close()
  }
  const name = baseName(path)
  return { name: isCharset(path, name, w, h) ? CHARSET : name, blob, w, h }
}

async function fromWad(data: Uint8Array): Promise<Stored[]> {
  return Promise.all(
    decodeWad(data).map(async ({ name, image }) => ({ name: name === 'conchars' ? CHARSET : name, blob: await toPng(image), w: image.w, h: image.h })),
  )
}

// Unsupported files are skipped; luma/glow maps are ignored.
async function collect(path: string, data: Uint8Array, inArchive: boolean): Promise<Stored[]> {
  if (/\.(zip|pk3)$/i.test(path)) {
    const files = await unzip(data)
    return (await Promise.all(files.map((f) => collect(f.path, f.data, true)))).flat()
  }
  if (/\.wad$/i.test(path)) return fromWad(data)
  if (!IMAGE.test(path) || /_(luma|glow)\.[^.]+$/i.test(path)) return []
  const name = baseName(path)
  if (inArchive && !HUD_PIC.test(name) && !HUD_FOLDER.test(path) && name !== 'conchars') return []
  const tex = await fromImage(path, data)
  return tex ? [tex] : []
}

export const isTextureFile = (name: string) => /\.(png|tga|jpe?g|webp|wad|zip|pk3)$/i.test(name)

// Returns the names of the textures added or replaced.
export async function importTextures(files: File[]): Promise<string[]> {
  const list = (await Promise.all(files.map(async (f) => collect(f.name, new Uint8Array(await f.arrayBuffer()), false)))).flat()
  if (!list.length) return []
  publish(list, false)
  await tx('readwrite', (s) => list.forEach((t) => s.put(t))).catch(() => {})
  return [...new Set(list.map((t) => (t.name === CHARSET ? 'charset' : t.name)))]
}
