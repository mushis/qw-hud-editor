// Size and draw functions per element, following the draw code in ezQuake's hud_*.c.
// Elements marked "mock" draw an approximation with a plausible size.

import type { Params } from './cfg'
import type { Rect, Size } from './layout'
import { findPicture, pictureName } from './pictures'
import { activeAmmo, PLAYERS, type Preview } from './preview'

export type TextColor = 'white' | 'alt' | 'gold'

// Everything is in virtual console pixels; the renderer scales to the canvas.
export interface Gfx {
  pic(name: string, x: number, y: number, w: number, h: number): void
  text(s: string, x: number, y: number, scale: number, color?: TextColor): void
  fill(x: number, y: number, w: number, h: number, color: string): void
  // Source rectangle (sx, sy, sw, sh) of an image url, drawn into (dx, dy, dw, dh).
  image(url: string, sx: number, sy: number, sw: number, sh: number, dx: number, dy: number, dw: number, dh: number, alpha: number): void
}

export interface Ctx {
  preview: Preview
  screenW: number
  screenH: number
}

interface ElementImpl {
  size(p: Params, ctx: Ctx): Size | null
  draw(g: Gfx, p: Params, ctx: Ctx, r: Rect): void
}

const num = (v: string | undefined, fallback = 0) => {
  const n = parseFloat(v ?? '')
  return Number.isFinite(n) ? n : fallback
}
const int = (v: string | undefined, fallback = 0) => Math.trunc(num(v, fallback))
const scaleOf = (p: Params) => num(p.scale, 1)

// Strips ezQuake text markup: &cRGB colours, &r reset, $[ $] brackets.
export const stripMarkup = (s: string) => s.replace(/&c[0-9a-fA-F]{3}/g, '').replace(/&r/g, '').replace(/\$\[|\$\]/g, '')

const textSize = (s: string, scale: number, lines = 1): Size => ({ w: s.length * 8 * scale, h: 8 * scale * lines })

function rgba(spec: string | undefined, alphaFallback = 1): string {
  const parts = (spec ?? '').trim().split(/\s+/).map(Number)
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return `rgba(255,255,255,${alphaFallback})`
  const a = parts.length >= 4 ? parts[3] / 255 : alphaFallback
  return `rgba(${parts[0]},${parts[1]},${parts[2]},${a})`
}

// ---------------------------------------------------------------- numbers

// SCR_HUD_DrawNum: style 0/2 big 24px digits, 1 small text, 3 small golden digits.
function numberImpl(value: (ctx: Ctx) => number, low: (v: number) => boolean = () => false): ElementImpl {
  const layout = (p: Params, ctx: Ctx) => {
    const v = Math.trunc(value(ctx))
    const style = int(p.style)
    const big = style === 0 || style === 2
    const digits = int(p.digits, 3)
    let s = String(style === 2 || v >= 0 ? v : Math.abs(v))
    if (digits > 0 && s.length > digits) s = s.slice(-digits) // hud_digits_trim 1
    const cw = (big ? 24 : 8) * scaleOf(p)
    const boxChars = digits > 0 ? digits : s.length
    return { s, big, style, cw, box: boxChars * cw, low: low(v) }
  }
  return {
    size(p, ctx) {
      const l = layout(p, ctx)
      return { w: l.box, h: l.cw * (l.big ? 1 : 1) }
    },
    draw(g, p, ctx, r) {
      const l = layout(p, ctx)
      const align = (p.align ?? 'right')[0]?.toLowerCase()
      const used = l.s.length * l.cw
      let x = r.x + (align === 'l' ? 0 : align === 'c' ? (l.box - used) / 2 : l.box - used)
      for (const ch of l.s) {
        if (l.big) {
          const glyph = ch === '-' ? 'minus' : ch
          g.pic(`${l.low ? 'anum' : 'num'}_${glyph}`, x, r.y, l.cw, l.cw)
        } else {
          g.text(ch, x, r.y, scaleOf(p), l.style === 3 ? 'gold' : l.low ? 'alt' : 'white')
        }
        x += l.cw
      }
    },
  }
}

// ---------------------------------------------------------------- pictures

function picImpl(
  pic: (p: Params, ctx: Ctx) => string,
  w: number,
  h: number,
  letter: (p: Params, ctx: Ctx) => string,
  picStyle: (style: number) => boolean = (style) => style === 0,
): ElementImpl {
  return {
    size(p) {
      const s = scaleOf(p)
      return picStyle(int(p.style)) ? { w: w * s, h: h * s } : textSize('x', s)
    },
    draw(g, p, ctx, r) {
      const s = scaleOf(p)
      if (picStyle(int(p.style))) g.pic(pic(p, ctx), r.x, r.y, w * s, h * s)
      else g.text(letter(p, ctx), r.x, r.y, s)
    },
  }
}

const WEAPON_PICS = ['', '', 'shotgun', 'sshotgun', 'nailgun', 'snailgun', 'rlaunch', 'srlaunch', 'lightng']
const WEAPON_SHORT = ['', '', 'sg', 'bs', 'ng', 'sn', 'gl', 'rl', 'lg']
const WEAPON_TP = ['', '', 'sg', 'ssg', 'ng', 'sng', 'gl', 'rl', 'lg']

function gunImpl(weapon: (ctx: Ctx) => number): ElementImpl {
  const wide = (p: Params, w: number) => w === 8 && int(p.wide) !== 0
  return {
    size(p, ctx) {
      const s = scaleOf(p)
      const style = int(p.style)
      const w = weapon(ctx)
      if (style === 0) return { w: (wide(p, w) ? 48 : 24) * s, h: 16 * s }
      if (style === 1 || style === 3) return textSize('xx', s)
      if (style === 2 || style === 4) return textSize('x', s)
      return textSize(WEAPON_TP[w], s)
    },
    draw(g, p, ctx, r) {
      const s = scaleOf(p)
      const style = int(p.style)
      const w = weapon(ctx)
      const active = ctx.preview.activeWeapon === w
      if (style === 0) g.pic(`${active ? 'inv2' : 'inv'}_${WEAPON_PICS[w]}`, r.x, r.y, (wide(p, w) ? 48 : 24) * s, 16 * s)
      else if (style === 1 || style === 3) g.text(WEAPON_SHORT[w], r.x, r.y, s, active ? 'white' : 'gold')
      else if (style === 2 || style === 4) g.text(String(w), r.x, r.y, s, active ? 'white' : 'gold')
      else g.text(WEAPON_TP[w], r.x, r.y, s, active ? 'white' : 'alt')
    },
  }
}

// ---------------------------------------------------------------- text

function textImpl(text: (p: Params, ctx: Ctx) => string | string[], color: TextColor = 'white'): ElementImpl {
  const lines = (p: Params, ctx: Ctx) => {
    const t = text(p, ctx)
    return (Array.isArray(t) ? t : [t]).map(stripMarkup)
  }
  return {
    size(p, ctx) {
      const l = lines(p, ctx)
      const longest = Math.max(0, ...l.map((s) => s.length))
      return { w: longest * 8 * scaleOf(p), h: l.length * 8 * scaleOf(p) }
    },
    draw(g, p, ctx, r) {
      const s = scaleOf(p)
      lines(p, ctx).forEach((line, i) => g.text(line, r.x, r.y + i * 8 * s, s, color))
    },
  }
}

// Big 24px digits with 16px colon, or small text (clocks).
function clockImpl(text: (p: Params) => string, bigDefault: number): ElementImpl {
  const isBig = (p: Params) => int(p.big, bigDefault) !== 0
  return {
    size(p) {
      const s = scaleOf(p)
      const t = text(p)
      if (!isBig(p)) return textSize(t, s)
      let w = 0
      for (const ch of t) w += ch === ':' ? 16 : 24
      return { w: w * s, h: 24 * s }
    },
    draw(g, p, _ctx, r) {
      const s = scaleOf(p)
      const t = text(p)
      if (!isBig(p)) return g.text(t, r.x, r.y, s, int(p.style) === 1 ? 'alt' : 'white')
      let x = r.x
      const prefix = int(p.style) === 1 ? 'anum' : 'num'
      for (const ch of t) {
        const w = (ch === ':' ? 16 : 24) * s
        if (ch === ':') g.pic(`${prefix}_colon`, x, r.y, w, 24 * s)
        else if (ch !== ' ') g.pic(`${prefix}_${ch}`, x, r.y, w, 24 * s)
        x += w
      }
    },
  }
}

// ---------------------------------------------------------------- boxes & mocks

function boxImpl(size: (p: Params, ctx: Ctx) => Size, draw?: (g: Gfx, p: Params, ctx: Ctx, r: Rect) => void): ElementImpl {
  return { size, draw: draw ?? (() => {}) }
}

function barImpl(kind: 'health' | 'armor'): ElementImpl {
  return boxImpl(
    (p) => ({ w: num(p.width, 64), h: num(p.height, 16) }),
    (g, p, ctx, r) => {
      const v = kind === 'health' ? ctx.preview.health : ctx.preview.armor
      const color =
        kind === 'health'
          ? v > 100 ? p.color_mega : p.color_normal
          : [p.color_ga, p.color_ya, p.color_ra][ctx.preview.armorType - 1]
      g.fill(r.x, r.y, r.w, r.h, rgba(kind === 'health' ? p.color_nohealth : p.color_noarmor, 0.25))
      const frac = Math.min(1, v / (kind === 'health' ? 100 : 200))
      const dir = int(p.direction, kind === 'health' ? 0 : 1)
      if (dir === 0) g.fill(r.x, r.y, r.w * frac, r.h, rgba(color, 0.5))
      else if (dir === 1) g.fill(r.x + r.w * (1 - frac), r.y, r.w * frac, r.h, rgba(color, 0.5))
      else if (dir === 2) g.fill(r.x, r.y + r.h * (1 - frac), r.w, r.h * frac, rgba(color, 0.5))
      else g.fill(r.x, r.y, r.w, r.h * frac, rgba(color, 0.5))
    },
  )
}

// HUD frags grid: cols x rows cells.
function fragsImpl(defaultCols: number, teams: boolean): ElementImpl {
  const dims = (p: Params) => {
    const s = scaleOf(p)
    const cw = Math.min(128, Math.max(0, num(p.cell_width, 32) * s))
    const ch = Math.min(32, Math.max(7, num(p.cell_height, 8) * s))
    const sx = num(p.space_x, 1) * s
    const sy = num(p.space_y, 1) * s
    let rows = Math.max(1, int(p.rows, 1))
    let cols = Math.max(1, int(p.cols, defaultCols))
    const n = teams ? 2 : PLAYERS.length
    if (int(p.strip, 1)) {
      if (int(p.vertical)) rows = Math.min(rows, n)
      else cols = Math.min(cols, Math.ceil(n / rows))
    }
    const vertical = int(p.vertical) !== 0
    return { cw, ch, sx, sy, rows, cols, vertical, s }
  }
  return boxImpl(
    (p) => {
      const d = dims(p)
      return { w: d.cols * d.cw + (d.cols + 1) * d.sx, h: d.rows * d.ch + (d.rows + 1) * d.sy }
    },
    (g, p, ctx, r) => {
      const d = dims(p)
      const entries = teams
        ? [
            { color: '#d33', frags: ctx.preview.teamScore },
            { color: '#36c', frags: ctx.preview.enemyScore },
          ]
        : PLAYERS
      let i = 0
      for (let a = 0; a < (d.vertical ? d.cols : d.rows); a++) {
        for (let b = 0; b < (d.vertical ? d.rows : d.cols); b++) {
          const e = entries[i++]
          if (!e) return
          const col = d.vertical ? a : b
          const row = d.vertical ? b : a
          const x = r.x + d.sx + col * (d.cw + d.sx)
          const y = r.y + d.sy + row * (d.ch + d.sy)
          g.fill(x, y, d.cw, d.ch, e.color)
          const t = String(e.frags)
          g.text(t, x + (d.cw - t.length * 8 * d.s) / 2, y + (d.ch - 8 * d.s) / 2, d.s)
        }
      }
    },
  )
}

// SCR_HUD_DrawGroup (hud_groups.c). pic_scalemode: 0 top-left, 1 tile, 2 stretch, 3 grow, 4 centre.
const groupImpl = boxImpl(
  (p) => {
    let w = Math.min(99999, Math.max(1, int(p.width, 64)))
    let h = Math.min(99999, Math.max(1, int(p.height, 64)))
    const pic = findPicture(p.picture)
    if (pic && int(p.pic_scalemode) === 3) {
      w = Math.max(w, pic.w)
      h = Math.max(h, pic.h)
    }
    return { w, h }
  },
  (g, p, _ctx, r) => {
    const name = pictureName(p.picture)
    if (!name) return
    const pic = findPicture(name)
    if (!pic) {
      // Not available in the editor (listed under Issues); in game it would draw gfx/<name>.
      g.fill(r.x, r.y, r.w, r.h, 'rgba(255,255,255,0.08)')
      const s = Math.min(1, r.h / 8, r.w / Math.max(1, name.length * 8))
      if (s > 0.2) g.text(name, r.x + (r.w - name.length * 8 * s) / 2, r.y + (r.h - 8 * s) / 2, s, 'gold')
      return
    }
    const alpha = Math.min(1, num(p.pic_alpha, 1))
    const sub = (sx: number, sy: number, sw: number, sh: number, dx: number, dy: number) =>
      g.image(pic.url, sx, sy, sw, sh, dx, dy, sw, sh, alpha)
    switch (int(p.pic_scalemode)) {
      case 1:
        for (let cy = 0; cy < r.h; cy += pic.h)
          for (let cx = 0; cx < r.w; cx += pic.w) sub(0, 0, Math.min(pic.w, r.w - cx), Math.min(pic.h, r.h - cy), r.x + cx, r.y + cy)
        break
      case 2:
        g.image(pic.url, 0, 0, pic.w, pic.h, r.x, r.y, r.w, r.h, alpha)
        break
      case 4: {
        let px = r.x + Math.trunc((r.w - pic.w) / 2)
        let py = r.y + Math.trunc((r.h - pic.h) / 2)
        const sx = Math.max(0, r.x - px)
        const sy = Math.max(0, r.y - py)
        px = Math.max(px, r.x)
        py = Math.max(py, r.y)
        sub(sx, sy, Math.min(r.w, pic.w), Math.min(r.h, pic.h), px, py)
        break
      }
      default:
        sub(0, 0, Math.min(r.w, pic.w), Math.min(r.h, pic.h), r.x, r.y)
    }
  },
)

function mockBox(label: string, size: (p: Params, ctx: Ctx) => Size): ElementImpl {
  return boxImpl(size, (g, p, _ctx, r) => {
    g.fill(r.x, r.y, r.w, r.h, 'rgba(255,255,255,0.08)')
    const s = Math.min(1, scaleOf(p), r.h / 8, r.w / Math.max(1, label.length * 8))
    if (s > 0.2) g.text(label, r.x + (r.w - label.length * 8 * s) / 2, r.y + (r.h - 8 * s) / 2, s, 'gold')
  })
}

function percentOr(v: string | undefined, total: number, fallback: number): number {
  if (!v) return fallback
  return v.trim().endsWith('%') ? (num(v.replace('%', '')) / 100) * total : num(v, fallback)
}

const AMMO_PICS = ['sb_shells', 'sb_nails', 'sb_rocket', 'sb_cells']
const AMMO_LETTERS = 'snrc'
const AMMO_KEYS = ['shells', 'nails', 'rockets', 'cells'] as const
const ITEM_PICS: Record<string, [string, string]> = {
  key1: ['sb_key1', '1'],
  key2: ['sb_key2', '2'],
  ring: ['sb_invis', 'r'],
  pent: ['sb_invuln', 'p'],
  suit: ['sb_suit', 's'],
  quad: ['sb_quad', 'q'],
}

function faceIndex(health: number): number {
  return health >= 100 ? 1 : 5 - Math.max(0, Math.min(4, Math.floor(health / 20)))
}

const now = new Date()
const pad2 = (n: number) => String(n).padStart(2, '0')
const clockFormats = [
  () => `${pad2(now.getHours())}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())}`,
  () => `${pad2(now.getHours() % 12 || 12)}:${pad2(now.getMinutes())} ${now.getHours() < 12 ? 'AM' : 'PM'}`,
  () => `${pad2(now.getHours() % 12 || 12)}:${pad2(now.getMinutes())}:${pad2(now.getSeconds())} ${now.getHours() < 12 ? 'AM' : 'PM'}`,
  () => `${pad2(now.getHours())}:${pad2(now.getMinutes())}`,
]

export const IMPLS: Record<string, ElementImpl> = {
  face: picImpl((_p, c) => `face${faceIndex(c.preview.health)}`, 24, 24, () => 'f', () => true),
  health: numberImpl((c) => c.preview.health, (v) => v <= 25),
  armor: numberImpl((c) => c.preview.armor, (v) => v <= 25),
  iarmor: picImpl((_p, c) => `sb_armor${c.preview.armorType}`, 24, 24, (_p, c) => 'gyr'[c.preview.armorType - 1]),
  healthdamage: numberImpl(() => 12),
  armordamage: numberImpl(() => 24),
  bar_health: barImpl('health'),
  bar_armor: barImpl('armor'),

  ammo: numberImpl((c) => activeAmmo(c.preview), (v) => v <= 10),
  iammo: picImpl(
    (_p, c) => AMMO_PICS[Math.max(0, Math.floor((c.preview.activeWeapon - 2) / 2))],
    24,
    24,
    (_p, c) => AMMO_LETTERS[Math.max(0, Math.floor((c.preview.activeWeapon - 2) / 2))],
  ),
  ...Object.fromEntries(
    AMMO_KEYS.flatMap((k, i) => [
      [`ammo${i + 1}`, numberImpl((c) => c.preview[k], (v) => v <= 10)],
      [`iammo${i + 1}`, picImpl(() => AMMO_PICS[i], 24, 24, () => AMMO_LETTERS[i])],
    ]),
  ),

  gun: gunImpl((c) => c.preview.activeWeapon),
  ...Object.fromEntries([2, 3, 4, 5, 6, 7, 8].map((w) => [`gun${w}`, gunImpl(() => w)])),

  ...Object.fromEntries(Object.entries(ITEM_PICS).map(([n, [pic, letter]]) => [n, picImpl(() => pic, 16, 16, () => letter)])),
  ...Object.fromEntries([1, 2, 3, 4].map((i) => [`sigil${i}`, picImpl(() => `sb_sigil${i}`, 8, 16, () => String(i))])),
  itemsclock: textImpl(() => ['RL  0:12', 'QUAD 0:45', 'RA  0:03']),

  clock: clockImpl((p) => (clockFormats[int(p.format)] ?? clockFormats[0])(), 1),
  gameclock: clockImpl(() => '12:34', 1),
  democlock: clockImpl(() => '03:21', 0),
  scoreclock: textImpl(() => `${pad2(now.getDate())}-${pad2(now.getMonth() + 1)}-${now.getFullYear()} ${clockFormats[0]()}`),


  frags: fragsImpl(4, false),
  teamfrags: fragsImpl(2, true),
  ownfrags: textImpl(() => 'You fragged Grunt'),
  score_team: numberImpl((c) => c.preview.teamScore),
  score_enemy: numberImpl((c) => c.preview.enemyScore),
  score_difference: numberImpl((c) => c.preview.teamScore - c.preview.enemyScore),
  score_position: numberImpl(() => 1),
  score_bar: textImpl((p, c) =>
    int(p.style) === 1
      ? `${c.preview.teamScore}:${c.preview.enemyScore}`
      : `red:${c.preview.teamScore} blue:${c.preview.enemyScore} [+${c.preview.teamScore - c.preview.enemyScore}]`,
  ),
  tracker: textImpl(() => ['Ranger [rl] Grunt', 'Grunt [lg] Ogre', 'Fiend [gl] Ranger']),

  teaminfo: textImpl(() => [
    'Ranger  ra  150/100 rl',
    'Ogre    ya   80/ 72 lg',
    'Fiend   ga   30/ 45 sg',
    'Grunt        0/ 12 sg',
  ]),
  tracking: textImpl((p) => (p.format ?? 'Tracking %t %n, JUMP for next').replace('%t', 'red').replace('%n', 'Ranger')),
  radar: mockBox('radar', (p, c) => ({ w: percentOr(p.width, c.screenW, 200), h: percentOr(p.height, c.screenH, 150) })),
  gamesummary: mockBox('summary', (p) => {
    const icon = 8 * num(p.ratio, 4)
    const s = scaleOf(p)
    return { w: (p.format ?? 'RYM myr').length * icon * s, h: (icon + (int(p.style) ? 8 : 0)) * s }
  }),
  teamholdbar: mockBox('hold', (p) => ({ w: num(p.width, 200), h: num(p.height, 8) })),
  teamholdinfo: mockBox('hold info', (p) => ({ w: num(p.width, 200), h: num(p.height, 8) * 4 })),
  teamstackbar: mockBox('stack', (p) => ({ w: num(p.width, 200), h: num(p.height, 8) })),
  qtv_buffer: textImpl(() => '3.4s'),
  static_text: textImpl((p) => (p.text ?? '').split(/\\r|\r/)),

  fps: textImpl((p, c) => `${c.preview.fps}${int(p.title, 1) ? ' fps' : ''}`),
  frametime: textImpl((p) => `4.0${int(p.title, 1) ? ' ms' : ''}`),
  framestats: textImpl(() => ['frame 4.0ms', 'world 1.2ms', 'hud   0.3ms']),
  vidlag: textImpl(() => '8.3'),
  ping: textImpl((p, c) => `${c.preview.ping} ms${int(p.show_pl, 1) ? ' 0%' : ''}`),
  net: textImpl(() => ['latency  25 ms', 'packet loss  0%', 'in  10.2 kb/s', 'out  2.1 kb/s']),
  netgraph: mockBox('netgraph', (p) => ({ w: num(p.width, 256), h: num(p.height, 32) })),
  netproblem: picImpl(() => 'net', 32, 32, () => '!', () => true),

  notify: boxImpl(
    (p) => ({ w: 8 * num(p.cols, 30) * scaleOf(p), h: 8 * num(p.rows, 4) * scaleOf(p) }),
    (g, p, _c, r) => {
      const s = scaleOf(p)
      const lines = ['Ranger: gl hf', 'Ogre: rl in mega', 'Fiend: quad up']
      lines.slice(0, int(p.rows, 4)).forEach((l, i) => g.text(l.slice(0, int(p.cols, 30)), r.x, r.y + i * 8 * s, s))
    },
  ),
  centerprint: textImpl(() => 'Match begins in 3 seconds'),
  speed: boxImpl(
    (p) => ({ w: num(p.width, 160) * scaleOf(p), h: num(p.height, 15) * scaleOf(p) }),
    (g, _p, c, r) => {
      g.fill(r.x, r.y, r.w, r.h, 'rgba(0,0,0,0.3)')
      g.fill(r.x, r.y, (r.w * Math.min(c.preview.speed, 500)) / 500, r.h, 'rgba(100,200,100,0.6)')
    },
  ),
  speed2: mockBox('speed', (p) => {
    const rad = num(p.radius, 50) * scaleOf(p)
    return int(p.orientation) % 2 ? { w: rad, h: 2 * rad } : { w: 2 * rad, h: rad }
  }),
  weaponstats: textImpl(() => 'sg:45% ssg:30% rl:#12 lg:33%'),
  keys: textImpl(() => [' ^ ', '<v>']),

  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [`group${i}`, groupImpl]),
  ),
}

const NONE: ElementImpl = { size: () => null, draw: () => {} }
export function implFor(name: string): ElementImpl {
  return IMPLS[name] ?? NONE
}
