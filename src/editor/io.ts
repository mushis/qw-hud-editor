// cfg files are Latin-1 (Quake high-bit characters), so bytes map 1:1 to char codes.

export function bytesToText(bytes: Uint8Array): string {
  let s = ''
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i])
  return s
}

export function textToBytes(text: string): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(text.length)
  for (let i = 0; i < text.length; i++) out[i] = text.charCodeAt(i) & 0xff
  return out
}

export async function readFileText(file: File): Promise<string> {
  return bytesToText(new Uint8Array(await file.arrayBuffer()))
}

export function downloadText(name: string, text: string) {
  downloadBlob(name, new Blob([textToBytes(text)], { type: 'text/plain' }))
}

export function downloadBlob(name: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}

const presetUrls = import.meta.glob('../hud/presets/*.cfg', { query: '?url', import: 'default', eager: true }) as Record<string, string>

export const PRESETS = Object.entries(presetUrls)
  .map(([path, url]) => ({ id: path.split('/').pop()!.replace(/\.cfg$/, ''), url }))
  .sort((a, b) => (a.id === 'nquake-default' ? -1 : b.id === 'nquake-default' ? 1 : a.id.localeCompare(b.id)))

export async function fetchPreset(id: string): Promise<string> {
  const preset = PRESETS.find((p) => p.id === id)
  if (!preset) throw new Error(`unknown preset ${id}`)
  const res = await fetch(preset.url)
  return bytesToText(new Uint8Array(await res.arrayBuffer()))
}
