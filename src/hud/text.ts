// ezQuake text markup: fun chars ($x10, $[, ^a...) and colours (&cRGB ... &r).

// TP_ParseFunChars (teamplay.c), without chat mode.
const FUN: Record<string, number> = {
  '\\': 0x0d,
  ':': 0x0a,
  '[': 0x10,
  ']': 0x11,
  G: 0x86,
  R: 0x87,
  Y: 0x88,
  B: 0x89,
  W: 0x84,
  '(': 0x80,
  '=': 0x81,
  ')': 0x82,
  a: 0x83,
  '<': 0x1d,
  '-': 0x1e,
  '>': 0x1f,
  ',': 0x1c,
  '.': 0x9c,
  b: 0x8b,
  c: 0x8d,
  d: 0x8d,
  $: 0x24,
  '^': 0x5e,
}

export function parseFunChars(s: string): string {
  let out = ''
  for (let i = 0; i < s.length; ) {
    if (s[i] === '$' && s[i + 1] === 'x' && /^[0-9a-f]{2}$/i.test(s.slice(i + 2, i + 4))) {
      out += String.fromCharCode(parseInt(s.slice(i + 2, i + 4), 16) || 32)
      i += 4
      continue
    }
    if (s[i] === '$' && i + 1 < s.length) {
      const next = s[i + 1]
      const code = /\d/.test(next) ? next.charCodeAt(0) - 48 + 0x12 : FUN[next]
      if (code) {
        out += String.fromCharCode(code)
        i += 2
        continue
      }
    }
    if (s[i] === '^' && i + 1 < s.length && s[i + 1] !== ' ') {
      out += String.fromCharCode((s.charCodeAt(i + 1) | 128) & 0xff)
      i += 2
      continue
    }
    out += s[i++]
  }
  return out
}

export interface Run {
  text: string
  color: string | null // "#rgb", or null for the default colour
}

// Splits on &cRGB (colour) and &r (back to the default), as Draw_SColoredAlphaString does.
export function colorRuns(s: string): Run[] {
  const runs: Run[] = []
  let color: string | null = null
  let text = ''
  const flush = () => {
    if (text) runs.push({ text, color })
    text = ''
  }
  for (let i = 0; i < s.length; ) {
    if (s[i] === '&' && s[i + 1] === 'c' && /^[0-9a-f]{3}$/i.test(s.slice(i + 2, i + 5))) {
      flush()
      color = `#${s.slice(i + 2, i + 5).toLowerCase()}`
      if (color === '#fff') color = null
      i += 5
      continue
    }
    if (s[i] === '&' && s[i + 1] === 'r') {
      flush()
      color = null
      i += 2
      continue
    }
    text += s[i++]
  }
  flush()
  return runs
}

// Characters drawn, without the colour codes.
export const visibleText = (s: string) => colorRuns(s).map((r) => r.text).join('')
export const visibleLength = (s: string) => visibleText(s).length

// Default tp_name_* values (teamplay.c), with the {} that only group them in chat removed.
export const TP_NAMES: Record<string, string> = {
  axe: 'axe',
  sg: 'sg',
  ssg: 'ssg',
  ng: 'ng',
  sng: 'sng',
  gl: 'gl',
  rl: '&cf13rl&cfff',
  lg: '&c2aalg&cfff',
  rlg: '&cf13rl&cfff&c2aag&cfff',
  ra: '&cf00ra&cfff',
  ya: '&cff0ya&cfff',
  ga: '&c0b0ga&cfff',
  quad: '&c05fquad&cfff',
  pent: '&cf00pent&cfff',
  ring: '&cff0ring&cfff',
  mh: '&c0a0mega&cfff',
}
