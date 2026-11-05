// Export setup: the HUD as a cfg plus the pictures the editor shows now, in a zip laid out like the qw folder,
// so extracting it there gives ezQuake the same HUD.
import { shouldShow } from '../hud/layout'
import { pictureName } from '../hud/pictures'
import { DEFAULT_CROSSHAIR } from '../render/crosshair'
import { zip } from '../render/decode'
import { CHARSET, CROSSHAIR, isHudPicture, useTextures } from '../render/textures'
import { useStore } from '../store'
import { currentCfg } from './actions'
import { textToBytes } from './io'

// ezQuake's own file names, which an export must not replace.
const RESERVED = new Set(['config', 'autoexec', 'default', 'frontend', 'pak0', 'pak1'])

// Why this name can't be used for the exported cfg, or null. It also names the charset and crosshair files.
export function invalidName(name: string): string | null {
  if (!name) return 'Give the setup a name.'
  if (!/^[A-Za-z0-9_-]{1,32}$/.test(name)) return 'Use letters, digits, - and _ only (up to 32), no spaces.'
  if (RESERVED.has(name.toLowerCase())) return `${name}.cfg is one of ezQuake's own files: choose another name.`
  return null
}

export interface SetupFile {
  path: string // inside qw/
  what: string
  url?: string // a custom picture, read when exporting
  text?: string // the cfg
}

// What the zip will hold: the cfg, the HUD pictures (textures/wad), the charset, the crosshair and the group
// pictures (gfx) that were loaded into the editor. The editor's own pictures are ezQuake's, so they are left out.
export function setupFiles(name: string): { files: SetupFile[]; unused: number } {
  const { doc, settings } = useStore.getState()
  const { textures } = useTextures.getState()
  const files: SetupFile[] = []
  const lines: string[] = []

  const charset = textures[CHARSET]
  if (charset) {
    files.push({ path: `textures/charsets/${name}`, what: 'charset', url: charset.url })
    lines.push(`loadcharset "${name}"`)
  }
  const crosshair = textures[CROSSHAIR]
  if (crosshair) {
    files.push({ path: `crosshairs/${name}`, what: 'crosshair', url: crosshair.url })
    lines.push(`crosshairimage "${name}"`)
  }
  // The crosshair cvars, when Import setup brought some.
  const c = settings.crosshair
  if (JSON.stringify(c) !== JSON.stringify(DEFAULT_CROSSHAIR)) {
    lines.push(
      `crosshair "${c.crosshair}"`,
      `crosshairsize "${c.size}"`,
      `crosshaircolor "${c.color}"`,
      `crosshairalpha "${c.alpha}"`,
      `crosshairscale "${c.scale}"`,
      `crosshairscalemethod "${c.scalemethod}"`,
    )
  }
  if (settings.fontFacepath) lines.push(`font_facepath "${settings.fontFacepath}"`)

  const used = new Set<string>()
  for (const pic of Object.keys(textures).filter(isHudPicture).sort()) {
    files.push({ path: `textures/wad/${pic}`, what: 'HUD picture', url: textures[pic].url })
    used.add(pic)
  }
  const groups = Object.entries(doc.elements).filter(([n, p]) => /^group\d$/.test(n) && shouldShow(p.show))
  for (const pic of new Set(groups.map(([, p]) => pictureName(p.picture)).filter((pic) => pic && textures[pic]))) {
    files.push({ path: `gfx/${pic}`, what: 'group picture', url: textures[pic].url })
    used.add(pic)
  }
  const unused = Object.keys(textures).filter((n) => !n.startsWith('#') && !used.has(n)).length

  let cfg = currentCfg(settings.exportClient)
  if (lines.length) cfg = cfg.replace(/hud_recalculate\n$/, `\n// Charset, crosshair and font of this setup\n${lines.join('\n')}\n\nhud_recalculate\n`)
  files.unshift({ path: `${name}.cfg`, what: 'cfg', text: cfg })
  return { files, unused }
}

// PNG and JPEG go in as they are; anything else (WebP, GIF, BMP) becomes a PNG, which ezQuake reads.
async function picture(url: string): Promise<{ ext: string; data: Uint8Array }> {
  const blob = await (await fetch(url)).blob()
  const data = new Uint8Array(await blob.arrayBuffer())
  if (data[0] === 0x89 && data[1] === 0x50 && data[2] === 0x4e && data[3] === 0x47) return { ext: 'png', data }
  if (data[0] === 0xff && data[1] === 0xd8) return { ext: 'jpg', data }
  const bitmap = await createImageBitmap(blob)
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0)
  bitmap.close()
  return { ext: 'png', data: new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer()) }
}

export async function exportSetup(name: string): Promise<{ blob: Blob; paths: string[] }> {
  const entries: { path: string; data: Uint8Array }[] = []
  for (const f of setupFiles(name).files) {
    if (f.text !== undefined) entries.push({ path: f.path, data: textToBytes(f.text) })
    else if (f.url) {
      const { ext, data } = await picture(f.url)
      entries.push({ path: `${f.path}.${ext}`, data })
    }
  }
  return { blob: zip(entries), paths: entries.map((e) => e.path) }
}
