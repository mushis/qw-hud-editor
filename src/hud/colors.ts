// ezQuake also accepts colour names (ColorNameToRGBString).
export const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 255, 0],
  blue: [0, 0, 255],
  yellow: [255, 255, 0],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  pink: [255, 192, 203],
  orange: [255, 165, 0],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
}

export type Rgba = [number, number, number, number?]

export function parseRgb(value: string): Rgba | null {
  const v = value.trim().toLowerCase()
  if (NAMED[v]) return [...NAMED[v]]
  const parts = v.split(/\s+/).map(Number)
  if ((parts.length === 3 || parts.length === 4) && parts.every((n) => Number.isFinite(n))) return parts as Rgba
  return null
}

// Colour cvars are "R G B", "R G B A" (bars), a colour name, or a Quake palette index (speed bars).
export function isPaletteColor(element: string, param: string): boolean {
  return /^speed2?$/.test(element) && param.startsWith('color_')
}

export function isColorParam(param: string): boolean {
  return /(^|_)color(_|$)/.test(param) && param !== 'colorize'
}

