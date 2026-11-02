// Downloads the HUD assets the editor needs from nQuake distfiles, converts
// TGA textures to PNG and writes them to public/assets. Sample HUD configs from
// ezquake.pk3 go to src/hud/presets. Run with: npm run fetch-assets
import { mkdir, writeFile } from 'node:fs/promises'
import { inflateRawSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const BASE = 'https://raw.githubusercontent.com/nQuake/distfiles/HEAD'
const WAD_OUT = join(ROOT, 'public/assets/wad')
const CHARSET_OUT = join(ROOT, 'public/assets/charsets')
const PRESET_OUT = join(ROOT, 'src/hud/presets')

// HUD lumps used by the editor (pickup flash frames inva1..5 are skipped).
const WAD_FILES = [
  ...[...'0123456789', 'colon', 'minus'].flatMap((d) => [`num_${d}.tga`, `anum_${d}.tga`]),
  'num_slash.png', 'anum_slash.png',
  'face1.tga', 'face2.tga', 'face3.tga', 'face4.tga', 'face5.tga',
  'face_p1.tga', 'face_p2.tga', 'face_p3.tga', 'face_p4.tga', 'face_p5.tga',
  'face_invis.tga', 'face_invul2.tga', 'face_inv2.tga', 'face_quad.tga',
  'sb_armor1.tga', 'sb_armor2.tga', 'sb_armor3.tga', 'disc.tga',
  'sb_shells.png', 'sb_nails.png', 'sb_rocket.png', 'sb_cells.png',
  'sb_key1.png', 'sb_key2.png', 'sb_invis.tga', 'sb_invuln.tga', 'sb_suit.tga', 'sb_quad.tga',
  'sb_sigil1.png', 'sb_sigil2.png', 'sb_sigil3.png', 'sb_sigil4.png',
  ...['shotgun', 'sshotgun', 'nailgun', 'snailgun', 'rlaunch', 'srlaunch', 'lightng']
    .flatMap((w) => [`inv_${w}.tga`, `inv2_${w}.tga`]),
  'ibar.png', 'net.png',
]

async function download(path) {
  const res = await fetch(`${BASE}/${path}`)
  if (!res.ok) throw new Error(`${res.status} ${path}`)
  return Buffer.from(await res.arrayBuffer())
}

// Uncompressed (2) and RLE (10) true-colour TGA, 24 or 32 bpp.
function tgaToPng(buf) {
  const idLength = buf[0], type = buf[2]
  const width = buf.readUInt16LE(12), height = buf.readUInt16LE(14)
  const bpp = buf[16] >> 3, topDown = (buf[17] & 0x20) !== 0
  if (type !== 2 && type !== 10) throw new Error(`unsupported TGA type ${type}`)
  const pixels = Buffer.alloc(width * height * 4)
  let src = 18 + idLength, n = 0
  const put = (o) => {
    const i = n++, y = Math.floor(i / width), row = topDown ? y : height - 1 - y
    const d = (row * width + (i % width)) * 4
    pixels[d] = buf[o + 2]; pixels[d + 1] = buf[o + 1]; pixels[d + 2] = buf[o]
    pixels[d + 3] = bpp === 4 ? buf[o + 3] : 255
  }
  while (n < width * height) {
    if (type === 2) { put(src); src += bpp; continue }
    const header = buf[src++], count = (header & 0x7f) + 1
    if (header & 0x80) { for (let k = 0; k < count; k++) put(src); src += bpp }
    else for (let k = 0; k < count; k++) { put(src); src += bpp }
  }
  const png = new PNG({ width, height })
  pixels.copy(png.data)
  return PNG.sync.write(png)
}

// Minimal zip reader (stored + deflate) via the central directory.
function readZip(buf) {
  let eocd = buf.length - 22
  while (buf.readUInt32LE(eocd) !== 0x06054b50) eocd--
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let i = 0; i < count; i++) {
    const method = buf.readUInt16LE(p + 10), size = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32)
    const local = buf.readUInt32LE(p + 42), name = buf.toString('latin1', p + 46, p + 46 + nameLen)
    entries.set(name, () => {
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28)
      const data = buf.subarray(start, start + size)
      return method === 0 ? Buffer.from(data) : inflateRawSync(data)
    })
    p += 46 + nameLen + extra + comment
  }
  return entries
}

await Promise.all([WAD_OUT, CHARSET_OUT, PRESET_OUT].map((d) => mkdir(d, { recursive: true })))

for (const file of WAD_FILES) {
  const data = await download(`non-gpl/qw/textures/wad/${file}`)
  const name = file.replace(/\.tga$/, '.png')
  await writeFile(join(WAD_OUT, name), file.endsWith('.tga') ? tgaToPng(data) : data)
  console.log('wad', name)
}

// From the shareware pak0.pak: the Quake palette (gfx/palette.lmp) for cvars that take a palette index,
// and backtile from gfx.wad, drawn around the view when viewsize is below 100.
const pak = await download('qsw106/ID1/PAK0.PAK')
const pakFiles = new Map()
for (let i = 0, dir = pak.readUInt32LE(4), n = pak.readUInt32LE(8) / 64; i < n; i++) {
  const entry = dir + i * 64
  const offset = pak.readUInt32LE(entry + 56)
  pakFiles.set(pak.toString('latin1', entry, entry + 56).replace(/\0.*$/s, ''), pak.subarray(offset, offset + pak.readUInt32LE(entry + 60)))
}
const lmp = pakFiles.get('gfx/palette.lmp')
const hex = Array.from({ length: 256 }, (_, c) => '#' + lmp.subarray(c * 3, c * 3 + 3).toString('hex'))
await writeFile(join(ROOT, 'src/hud/quake-palette.json'), JSON.stringify(hex) + '\n')
console.log('palette quake-palette.json')
const wad = pakFiles.get('gfx.wad')
for (let i = 0, n = wad.readUInt32LE(4), dir = wad.readUInt32LE(8); i < n; i++) {
  const entry = dir + i * 32
  if (wad.toString('latin1', entry + 16, entry + 32).replace(/\0.*$/s, '').toLowerCase() !== 'backtile') continue
  const offset = wad.readUInt32LE(entry)
  const png = new PNG({ width: wad.readUInt32LE(offset), height: wad.readUInt32LE(offset + 4) })
  for (let k = 0; k < png.width * png.height; k++) {
    const c = wad[offset + 8 + k]
    png.data.set([lmp[c * 3], lmp[c * 3 + 1], lmp[c * 3 + 2], 255], k * 4)
  }
  await writeFile(join(WAD_OUT, 'backtile.png'), PNG.sync.write(png))
  console.log('wad backtile.png')
}

const pk3 = readZip(await download('gpl/ezquake/ezquake.pk3'))
await writeFile(join(CHARSET_OUT, 'povo5.png'), pk3.get('textures/charsets/povo5.png')())
console.log('charset povo5.png')
// Sample HUDs left out of the preset list.
const SKIP_PRESETS = /^hud_(berzerk|dithes_\w+|empezar|murdoc)\.cfg$/
for (const [name, read] of pk3) {
  const m = name.match(/^cfg\/(hud_[\w]+\.cfg)$/)
  if (m && !SKIP_PRESETS.test(m[1])) { await writeFile(join(PRESET_OUT, m[1]), read()); console.log('preset', m[1]) }
}
