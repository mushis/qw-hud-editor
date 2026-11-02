// Decoders for dropped texture files: TGA images, Quake WAD2 lumps and zip/pk3 archives.
import QUAKE_PALETTE from '../hud/quake-palette.json'

export interface Rgba {
  w: number
  h: number
  data: Uint8ClampedArray // RGBA, top row first
}

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8)
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0

// Uncompressed (2) and RLE (10) true-colour TGA, 24 or 32 bpp.
export function decodeTga(buf: Uint8Array): Rgba {
  const idLength = buf[0]
  const type = buf[2]
  const w = u16(buf, 12)
  const h = u16(buf, 14)
  const bpp = buf[16] >> 3
  const topDown = (buf[17] & 0x20) !== 0
  if ((type !== 2 && type !== 10) || (bpp !== 3 && bpp !== 4)) throw new Error(`unsupported TGA (type ${type}, ${bpp * 8} bpp)`)
  const data = new Uint8ClampedArray(w * h * 4)
  let src = 18 + idLength
  let n = 0
  const put = (o: number) => {
    const y = Math.floor(n / w)
    const d = ((topDown ? y : h - 1 - y) * w + (n % w)) * 4
    data[d] = buf[o + 2]
    data[d + 1] = buf[o + 1]
    data[d + 2] = buf[o]
    data[d + 3] = bpp === 4 ? buf[o + 3] : 255
    n++
  }
  while (n < w * h && src < buf.length) {
    if (type === 2) {
      put(src)
      src += bpp
      continue
    }
    const header = buf[src++]
    const count = (header & 0x7f) + 1
    if (header & 0x80) {
      for (let k = 0; k < count; k++) put(src)
      src += bpp
    } else {
      for (let k = 0; k < count; k++, src += bpp) put(src)
    }
  }
  return { w, h, data }
}

const PALETTE = (QUAKE_PALETTE as string[]).map((hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)))

function fromPalette(pixels: Uint8Array, w: number, h: number, transparent: number): Rgba {
  const data = new Uint8ClampedArray(w * h * 4)
  for (let i = 0; i < w * h; i++) {
    const c = pixels[i]
    const [r, g, b] = PALETTE[c]
    data.set([r, g, b, c === transparent ? 0 : 255], i * 4)
  }
  return { w, h, data }
}

// WAD2 (gfx.wad): qpic lumps (status bar pictures) and the conchars charset.
export function decodeWad(buf: Uint8Array): { name: string; image: Rgba }[] {
  if (String.fromCharCode(...buf.subarray(0, 4)) !== 'WAD2') throw new Error('not a WAD2 file')
  const count = u32(buf, 4)
  const table = u32(buf, 8)
  const out: { name: string; image: Rgba }[] = []
  for (let i = 0; i < count; i++) {
    const e = table + i * 32
    const pos = u32(buf, e)
    const size = u32(buf, e + 4)
    const type = buf[e + 12]
    const name = String.fromCharCode(...buf.subarray(e + 16, e + 32))
      .replace(/\0.*$/s, '')
      .toLowerCase()
    if (name === 'conchars' && size >= 128 * 128) {
      out.push({ name, image: fromPalette(buf.subarray(pos, pos + 128 * 128), 128, 128, 0) })
    } else if (type === 0x42) {
      const w = u32(buf, pos)
      const h = u32(buf, pos + 4)
      if (w > 0 && h > 0 && w * h + 8 <= size) out.push({ name, image: fromPalette(buf.subarray(pos + 8, pos + 8 + w * h), w, h, 255) })
    }
  }
  return out
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'))
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

// Zip / pk3: stored and deflated entries.
export async function unzip(buf: Uint8Array): Promise<{ path: string; data: Uint8Array }[]> {
  let end = buf.length - 22
  while (end >= 0 && u32(buf, end) !== 0x06054b50) end--
  if (end < 0) throw new Error('not a zip file')
  const entries = u16(buf, end + 10)
  let p = u32(buf, end + 16)
  const out: { path: string; data: Uint8Array }[] = []
  for (let i = 0; i < entries && u32(buf, p) === 0x02014b50; i++) {
    const method = u16(buf, p + 10)
    const compSize = u32(buf, p + 20)
    const nameLen = u16(buf, p + 28)
    const skip = nameLen + u16(buf, p + 30) + u16(buf, p + 32)
    const path = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen))
    const local = u32(buf, p + 42)
    p += 46 + skip
    if (path.endsWith('/')) continue
    const start = local + 30 + u16(buf, local + 26) + u16(buf, local + 28)
    const raw = buf.subarray(start, start + compSize)
    if (method === 0) out.push({ path, data: raw })
    else if (method === 8) out.push({ path, data: await inflate(raw) })
  }
  return out
}

export async function toPng({ w, h, data }: Rgba): Promise<Blob> {
  const canvas = new OffscreenCanvas(w, h)
  canvas.getContext('2d')!.putImageData(new ImageData(data as ImageDataArray, w, h), 0, 0)
  return canvas.convertToBlob({ type: 'image/png' })
}
