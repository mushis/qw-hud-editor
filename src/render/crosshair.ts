// ezQuake's crosshair (Draw_Crosshair, r_draw.c): the crosshairimage picture when one is loaded, else
// crosshair 2-7, which the game draws from code (CreateBuiltinCrosshair), or the charset's "+" for crosshair 1.

export interface Crosshair {
  crosshair: number // 0 none, 1 "+", 2-7 built in
  size: number // crosshairsize
  color: string // crosshaircolor "R G B"
  alpha: number // crosshairalpha
  scale: number // crosshairscale: the built-in ones are 8 << scale pixels
  scalemethod: number // crosshairscalemethod: 0 grows them with the resolution (width / 320), 1 doesn't
}

export const DEFAULT_CROSSHAIR: Crosshair = { crosshair: 4, size: 1, color: '255 0 0', alpha: 1, scale: 0, scalemethod: 0 }

const num = (v: string | undefined, fallback: number, min: number, max: number) => {
  const n = parseFloat(v ?? '')
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

// From a cfg's cvars (see lastValues); unset ones get ezQuake's defaults.
export function crosshairFromCvars(cvars: Record<string, string>): Crosshair {
  const d = DEFAULT_CROSSHAIR
  return {
    crosshair: Math.trunc(num(cvars.crosshair, d.crosshair, 0, 99)),
    size: num(cvars.crosshairsize, d.size, 0, 20),
    color: cvars.crosshaircolor?.trim() || d.color,
    alpha: num(cvars.crosshairalpha, d.alpha, 0, 1),
    scale: Math.trunc(num(cvars.crosshairscale, d.scale, 0, 5)),
    scalemethod: num(cvars.crosshairscalemethod, d.scalemethod, 0, 1) ? 1 : 0,
  }
}

export const builtinPixels = (scale: number) => 8 << Math.min(5, Math.max(0, Math.trunc(scale)))

// The opaque pixels of built-in crosshair `format` (2-7) in a size × size grid.
export function builtinMask(format: number, size: number): boolean[] {
  const on = new Array<boolean>(size * size).fill(false)
  const at = (x: number, y: number) => (on[x + y * size] = true)
  const middle = size / 2 - 1
  switch (format) {
    case 2: // stippled cross
      for (let i = 0; i < size; i += 2) {
        at(middle, i)
        at(i, middle)
      }
      break
    case 3: // small cross
      at(middle, middle)
      for (let i = 1; i <= size / 8; i++) {
        at(middle - i, middle)
        at(middle + i, middle)
        at(middle, middle - i)
        at(middle, middle + i)
      }
      break
    case 4: // dot
      at(middle, middle)
      break
    case 5: // diagonals without the middle
      for (let i = 0; i < size; i++) {
        if (i >= middle - 1 && i <= middle + 1) continue
        at(i, i)
        at(size - 1 - i, i)
      }
      break
    case 6: // meant to be a smiley; the game draws 7
    case 7: // square with a dot
      at(middle, middle)
      for (let i = 2; i <= size - 4; i++) {
        at(i, 0)
        at(0, i)
        at(i, size - 2)
        at(size - 2, i)
      }
      break
  }
  return on
}

// White on transparent (palette colour 254 is white); the caller tints it by crosshaircolor.
const canvases = new Map<string, HTMLCanvasElement>()
export function builtinCanvas(format: number, scale: number): HTMLCanvasElement {
  const size = builtinPixels(scale)
  const key = `${format}/${size}`
  let canvas = canvases.get(key)
  if (!canvas) {
    canvas = document.createElement('canvas')
    canvas.width = canvas.height = size
    const t = canvas.getContext('2d')!
    const img = t.createImageData(size, size)
    builtinMask(format, size).forEach((v, i) => v && img.data.set([255, 255, 255, 255], i * 4))
    t.putImageData(img, 0, 0)
    canvases.set(key, canvas)
  }
  return canvas
}
