import type { HudDoc } from '../hud/cfg'
import { parseRgb } from '../hud/colors'
import { implFor, type Ctx, type Gfx, type TextColor } from '../hud/elements'
import type { Placed, Rect } from '../hud/layout'
import { CHARSET, getCrosshair, getTexture } from './textures'

const BASE = import.meta.env.BASE_URL

// Image cache; `onLoad` fires so the stage can redraw once textures arrive.
const images = new Map<string, HTMLImageElement>()
let onLoad = () => {}
export function setAssetListener(fn: () => void) {
  onLoad = fn
}

function load(url: string): HTMLImageElement | null {
  let img = images.get(url)
  if (!img) {
    img = new Image()
    img.onload = () => onLoad()
    img.src = url
    images.set(url, img)
  }
  return img.complete && img.naturalWidth ? img : null
}
const image = (path: string) => load(BASE + path)

// frame_color: "R G B" (0-255) or a colour name.
function frameColor(spec: string | undefined, alpha: number): string {
  const [r, g, b] = parseRgb(spec ?? '') ?? [0, 0, 0]
  return `rgba(${r},${g},${b},${alpha})`
}

// "proportional 1": ezQuake draws text and numbers with the loaded TTF font instead of the charset / big digits.
const TTF = 'Arial, Helvetica, sans-serif'
const TTF_COLORS: Record<TextColor, string> = { white: '#f2f2f2', alt: '#d08c48', gold: '#e8c040' }
const BIG_GLYPHS: Record<string, string> = { colon: ':', minus: '-', slash: '/' }

// &cRGB text: ezQuake multiplies the charset by the colour. One tinted copy per charset and colour.
const tinted = new Map<string, HTMLCanvasElement>()
function tint(img: HTMLImageElement, color: string): HTMLCanvasElement {
  const key = `${img.src}|${color}`
  let canvas = tinted.get(key)
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.width = img.naturalWidth
    canvas.height = img.naturalHeight
    const t = canvas.getContext('2d')!
    t.drawImage(img, 0, 0)
    t.globalCompositeOperation = 'multiply'
    t.fillStyle = color
    t.fillRect(0, 0, canvas.width, canvas.height)
    t.globalCompositeOperation = 'destination-in'
    t.drawImage(img, 0, 0)
    tinted.set(key, canvas)
  }
  return canvas
}

interface RenderGfx extends Gfx {
  proportional: boolean
}

// Coordinates are virtual pixels; drawHud sets the canvas transform to scale them.
function makeGfx(c: CanvasRenderingContext2D): RenderGfx {
  const k = 1
  return {
    proportional: false,
    pic(name, x, y, w, h) {
      const digit = this.proportional && name.match(/^(a?)num_(\w+)$/)
      if (digit) {
        c.save()
        c.font = `bold ${h * k}px ${TTF}`
        c.textAlign = 'center'
        c.textBaseline = 'middle'
        c.fillStyle = digit[1] ? '#e04030' : TTF_COLORS.white
        c.fillText(BIG_GLYPHS[digit[2]] ?? digit[2], (x + w / 2) * k, (y + h / 2) * k, w * k)
        c.restore()
        return
      }
      const custom = getTexture(name)
      const img = custom ? load(custom.url) : image(`assets/wad/${name}.png`)
      if (img) c.drawImage(img, x * k, y * k, w * k, h * k)
    },
    text(s, x, y, scale, color: TextColor | string = 'white') {
      const named = color === 'white' || color === 'alt' || color === 'gold'
      if (this.proportional) {
        c.save()
        c.font = `${8 * scale * k}px ${TTF}`
        c.textBaseline = 'top'
        c.fillStyle = named ? TTF_COLORS[color as TextColor] : color
        c.fillText(s, x * k, y * k)
        c.restore()
        return
      }
      const custom = getTexture(CHARSET)
      const plain = custom ? load(custom.url) : image('assets/charsets/povo5.png')
      if (!plain) return
      const charset = named ? plain : tint(plain, color)
      const cell = plain.naturalWidth / 16
      const size = 8 * scale * k
      for (let i = 0; i < s.length; i++) {
        let code = s.charCodeAt(i) & 0xff
        if (code === 32) continue
        if (color === 'alt') code |= 0x80
        else if (color === 'gold' && code >= 48 && code <= 57) code = code - 48 + 18
        c.drawImage(charset, (code % 16) * cell, (code >> 4) * cell, cell, cell, (x + i * 8 * scale) * k, y * k, size, size)
      }
    },
    fill(x, y, w, h, color) {
      c.fillStyle = color
      c.fillRect(x * k, y * k, w * k, h * k)
    },
    image(url, sx, sy, sw, sh, dx, dy, dw, dh, alpha) {
      const img = load(url)
      if (!img || sw <= 0 || sh <= 0) return
      const prev = c.globalAlpha
      c.globalAlpha = prev * alpha
      c.drawImage(img, sx, sy, sw, sh, dx * k, dy * k, dw * k, dh * k)
      c.globalAlpha = prev
    },
  }
}

// crosshairimage (Draw_Crosshair): centred on the view, sized in real pixels by crosshairsize, tinted by crosshaircolor.
function drawCrosshair(c: CanvasRenderingContext2D, view: Rect, kx: number, ky: number) {
  const cross = getCrosshair()
  const img = cross && load(cross.url)
  if (!cross || !img || !cross.alpha || !cross.size) return
  const [r, g, b] = parseRgb(cross.color) ?? [255, 0, 0]
  const before = cross.size * (cross.w * 0.5 - 0.5)
  const side = before + cross.size * (cross.h * 0.5 + 0.5)
  c.globalAlpha = cross.alpha
  c.drawImage(
    r === 255 && g === 255 && b === 255 ? img : tint(img, `rgb(${r},${g},${b})`),
    view.x + view.w / 2 - before / kx,
    view.y + view.h / 2 - before / ky,
    side / kx,
    side / ky,
  )
  c.globalAlpha = 1
}

// Draws the HUD at canvas resolution. kx/ky = canvas pixels per virtual pixel; they differ
// when vid_conwidth/conheight have another aspect ratio than the window (the game stretches too).
export function drawHud(
  c: CanvasRenderingContext2D,
  doc: HudDoc,
  ordered: Placed[],
  ctx: Ctx,
  kx: number,
  ky: number,
  isActive: (name: string) => boolean,
  showInactive: boolean,
  view: Rect,
) {
  c.clearRect(0, 0, c.canvas.width, c.canvas.height)
  c.imageSmoothingEnabled = true
  c.setTransform(kx, 0, 0, ky, 0, 0)
  drawCrosshair(c, view, kx, ky)
  const g = makeGfx(c)
  for (const placed of ordered) {
    if (!placed.draw) continue
    const active = isActive(placed.name)
    if (!active && !showInactive) continue
    const p = doc.elements[placed.name]
    const opacity = Math.min(1, Math.max(0, parseFloat(p.item_opacity ?? '1') || 0))
    c.globalAlpha = active ? opacity : opacity * 0.35

    const frame = parseFloat(p.frame ?? '0') || 0
    const o = placed.outer
    if (frame > 0 && frame <= 1) {
      g.fill(o.x, o.y, o.w, o.h, frameColor(p.frame_color, frame))
    } else if (frame === 2) {
      g.fill(o.x, o.y, o.w, o.h, 'rgba(40,30,20,0.9)')
      c.strokeStyle = '#8a6a3a'
      c.lineWidth = 2
      c.strokeRect(o.x + 2, o.y + 2, o.w - 4, o.h - 4)
    }
    g.proportional = (parseInt(p.proportional ?? '0', 10) || 0) !== 0
    implFor(placed.name).draw(g, p, ctx, placed.content)
  }
  c.globalAlpha = 1
  c.setTransform(1, 0, 0, 1, 0, 0)
}
