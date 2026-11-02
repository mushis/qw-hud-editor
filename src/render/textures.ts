// Custom textures the user dropped (png/tga/jpg, gfx.wad, zip/pk3, folders). They replace the
// built-in HUD pictures by name (num_0, sb_shells, face1...), add group pictures (gfx/<name>), or
// replace the charset. Each import is a set that can be removed on its own; later sets win for
// names they share. Kept in IndexedDB so they survive reloads.
import { create } from 'zustand'
import { setCustomPictures, type Picture } from '../hud/pictures'
import { decodePcx, decodeTga, decodeWad, toPng, unzip } from './decode'

export const CHARSET = '#charset'
export const CROSSHAIR = '#crosshair'

interface Stored {
  name: string
  blob: Blob
  w: number
  h: number
}

interface Row extends Stored {
  key: string // set/name
  set: string
}

// Sets from "Import setup" have a kind; a newer set of the same kind replaces the older one.
export type TextureKind = 'wad' | 'charset' | 'crosshair'

export interface TextureSet {
  id: string
  label: string // what was loaded: a folder, a file, "a.png +3"
  created: number
  names: string[]
  kind?: TextureKind
}

interface TextureState {
  textures: Record<string, Picture> // what is drawn: the newest set's picture for each name
  sets: TextureSet[] // oldest first
  version: number // bumps on every change, for redraws and relayouts
}

export const useTextures = create<TextureState>(() => ({ textures: {}, sets: [], version: 0 }))

export const getTexture = (name: string): Picture | undefined => useTextures.getState().textures[name]

// In memory: every stored texture of every set, with an object URL for drawing.
const records = new Map<string, Picture & { set: string; name: string }>()

function rebuild(sets: TextureSet[]) {
  const textures: Record<string, Picture> = {}
  for (const set of sets) {
    for (const name of set.names) {
      const r = records.get(`${set.id}/${name}`)
      if (r) textures[name] = { url: r.url, w: r.w, h: r.h }
    }
  }
  setCustomPictures(textures)
  useTextures.setState({ textures, sets, version: useTextures.getState().version + 1 })
}

function remember(r: Row) {
  records.set(r.key, { url: URL.createObjectURL(r.blob), w: r.w, h: r.h, set: r.set, name: r.name })
}

// ---------------------------------------------------------------- IndexedDB

const DB = 'qw-hud-editor'

function db(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 3)
    req.onupgradeneeded = (e) => {
      const d = req.result
      if (e.oldVersion < 2) {
        // Version 1 kept one flat list of textures, without sets.
        if (d.objectStoreNames.contains('textures')) d.deleteObjectStore('textures')
        d.createObjectStore('textures', { keyPath: 'key' })
        d.createObjectStore('sets', { keyPath: 'id' })
      }
      if (e.oldVersion < 3) d.createObjectStore('files') // other user files, e.g. the uploaded background
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(store: 'textures' | 'sets' | 'files', mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T> | void): Promise<T | undefined> {
  const d = await db()
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode)
    const req = run(t.objectStore(store))
    t.oncomplete = () => resolve(req ? req.result : undefined)
    t.onerror = () => reject(t.error)
  })
}

export async function loadSavedTextures() {
  try {
    const sets = ((await tx<TextureSet[]>('sets', 'readonly', (s) => s.getAll() as IDBRequest<TextureSet[]>)) ?? []).sort(
      (a, b) => a.created - b.created,
    )
    const all = (await tx<Row[]>('textures', 'readonly', (s) => s.getAll() as IDBRequest<Row[]>)) ?? []
    all.forEach(remember)
    if (sets.length) rebuild(sets)
  } catch {
    // no IndexedDB (private window): textures just aren't remembered
  }
}

async function addSet(label: string, list: Stored[], extra: Pick<TextureSet, 'kind'> = {}) {
  const set: TextureSet = { id: crypto.randomUUID(), label, created: Date.now(), names: list.map((t) => t.name), ...extra }
  const rows: Row[] = list.map((t) => ({ ...t, set: set.id, key: `${set.id}/${t.name}` }))
  rows.forEach(remember)
  rebuild([...useTextures.getState().sets, set])
  await tx('textures', 'readwrite', (s) => rows.forEach((r) => s.put(r))).catch(() => {})
  await tx('sets', 'readwrite', (s) => s.put(set)).catch(() => {})
}

// Removes one set; names it shared with older sets show those again.
export async function removeTextureSet(id: string) {
  const keys = [...records.entries()].filter(([, r]) => r.set === id).map(([key]) => key)
  for (const key of keys) {
    URL.revokeObjectURL(records.get(key)!.url)
    records.delete(key)
  }
  rebuild(useTextures.getState().sets.filter((s) => s.id !== id))
  await tx('textures', 'readwrite', (s) => keys.forEach((k) => s.delete(k))).catch(() => {})
  await tx('sets', 'readwrite', (s) => s.delete(id)).catch(() => {})
}

// ---------------------------------------------------------------- uploaded background

// The settings only say "custom"; the image itself is kept here (too big for localStorage).
export const CUSTOM_BACKGROUND = 'custom'
export const useCustomBackground = create<{ url: string | null }>(() => ({ url: null }))

function showBackground(blob: Blob | undefined) {
  const old = useCustomBackground.getState().url
  if (old) URL.revokeObjectURL(old)
  useCustomBackground.setState({ url: blob ? URL.createObjectURL(blob) : null })
}

export async function loadCustomBackground() {
  try {
    showBackground(await tx<Blob>('files', 'readonly', (s) => s.get('background') as IDBRequest<Blob>))
  } catch {
    // not remembered: the "custom" option then falls back to no background
  }
}

export async function saveCustomBackground(file: Blob) {
  showBackground(file)
  await tx('files', 'readwrite', (s) => s.put(file, 'background')).catch(() => {})
}

// ---------------------------------------------------------------- importing

const IMAGE = /\.(png|tga|jpe?g|webp|pcx)$/i
// Status bar pictures, as named in gfx.wad and textures/wad/.
const HUD_PIC = /^(a?num_|face|inv|sb_|ibar|sbar|disc|net$|ram$|turtle$|backtile$)/
export const isHudPicture = (name: string) => HUD_PIC.test(name)
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
  if (/\.(tga|pcx)$/i.test(path)) {
    const img = /\.tga$/i.test(path) ? decodeTga(data) : decodePcx(data)
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

interface Found extends Stored {
  rank: number // lower wins when several files give the same name
}

// ezQuake looks for textures/wad/<name> before gfx/<name>, and in each tries .tga, .png, .jpg;
// the 8-bit picture in gfx.wad is only used when there is no replacement.
export function texturePriority(path: string): number {
  const folder = /(^|\/)textures\/wad\//i.test(path) ? 0 : /(^|\/)gfx\//i.test(path) ? 1 : 2
  const ext = ['tga', 'png', 'jpg', 'jpeg', 'webp'].indexOf(path.split('.').pop()!.toLowerCase())
  return folder * 10 + (ext < 0 ? 9 : ext)
}

interface Collected {
  found: Found[]
  skipped: string[] // files that could not be read
}

// From a folder or an archive, images only count when they look like HUD graphics
// (a whole qw folder also holds skins and map textures). Luma/glow maps are ignored.
async function collect(path: string, data: Uint8Array, nested: boolean, out: Collected): Promise<void> {
  try {
    if (/\.(zip|pk3)$/i.test(path)) {
      for (const f of await unzip(data)) await collect(f.path, f.data, true, out)
      return
    }
    if (/\.wad$/i.test(path)) {
      out.found.push(...(await fromWad(data)).map((t) => ({ ...t, rank: 99 })))
      return
    }
    if (!IMAGE.test(path) || /_(luma|glow)\.[^.]+$/i.test(path)) return
    const name = baseName(path)
    if (nested && !HUD_PIC.test(name) && !HUD_FOLDER.test(path) && name !== 'conchars') return
    const tex = await fromImage(path, data)
    if (tex) out.found.push({ ...tex, rank: texturePriority(path) })
  } catch {
    out.skipped.push(path.split('/').pop()!)
  }
}

export const isTextureFile = (name: string) => /\.(png|tga|jpe?g|webp|wad|zip|pk3)$/i.test(name)

// A dropped or picked file, with its path inside a dropped folder ("wad/num_0.tga").
export interface PathFile {
  path: string
  file: File
}

// Adds the textures in these files as a new set. When several files give the same name, the one ezQuake would use wins.
export async function importTextures(files: PathFile[], label: string): Promise<{ names: string[]; skipped: string[] }> {
  const out: Collected = { found: [], skipped: [] }
  for (const { path, file } of files) await collect(path, new Uint8Array(await file.arrayBuffer()), path.includes('/'), out)
  const best = new Map<string, Found>()
  for (const t of out.found) if (!best.has(t.name) || t.rank < best.get(t.name)!.rank) best.set(t.name, t)
  const list: Stored[] = [...best.values()].map(({ name, blob, w, h }) => ({ name, blob, w, h }))
  if (list.length) await addSet(label, list)
  return { names: list.map((t) => (t.name === CHARSET ? 'charset' : t.name)).sort(), skipped: out.skipped }
}

// Files from a drop, descending into dropped folders.
export async function droppedFiles(dt: DataTransfer): Promise<PathFile[]> {
  const entries = [...dt.items].map((i) => i.webkitGetAsEntry?.()).filter((e): e is FileSystemEntry => !!e)
  if (!entries.length) return [...dt.files].map((file) => ({ path: file.name, file }))
  const out: PathFile[] = []
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
      out.push({ path: prefix + entry.name, file })
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      // readEntries returns the folder in batches until an empty one.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
        if (!batch.length) break
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`)
      }
    }
  }
  for (const entry of entries) await walk(entry, '')
  return out
}

// Replaces the set of this kind (if any) with these files. Charset and crosshair take one file each.
export async function importKind(kind: TextureKind, label: string, files: PathFile[]): Promise<string[]> {
  const list: Stored[] = []
  for (const { path, file } of files) {
    const tex = await fromImage(path, new Uint8Array(await file.arrayBuffer()))
    if (tex) list.push(kind === 'wad' ? tex : { ...tex, name: kind === 'charset' ? CHARSET : CROSSHAIR })
  }
  if (!list.length) return []
  await removeKind(kind)
  await addSet(label, list, { kind })
  return list.map((t) => t.name)
}

// Back to the editor's own picture for this kind (ezQuake's povo5 charset, its built-in crosshair).
export async function removeKind(kind: TextureKind) {
  for (const old of useTextures.getState().sets.filter((s) => s.kind === kind)) await removeTextureSet(old.id)
}
