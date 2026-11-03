// Size and draw functions per element, following the draw code in ezQuake's hud_*.c.
// Elements marked "mock" draw an approximation with a plausible size.

import type { Params } from './cfg'
import { parseRgb } from './colors'
import type { Rect, Size } from './layout'
import { findPicture, pictureName } from './pictures'
import { activeAmmo, PLAYERS, type Preview } from './preview'
import QUAKE_PALETTE from './quake-palette.json'
import { colorRuns, parseFunChars, TP_NAMES, visibleLength, type Run } from './text'

export type TextColor = 'white' | 'alt' | 'gold'

// Everything is in virtual console pixels; the renderer scales to the canvas.
export interface Gfx {
  pic(name: string, x: number, y: number, w: number, h: number): void
  text(s: string, x: number, y: number, scale: number, color?: TextColor | string): void // a string is a "#rgb" tint
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

// Draws text with &cRGB colours (fun chars already parsed); returns the width drawn.
function drawRuns(g: Gfx, runs: Run[], x: number, y: number, scale: number, base: TextColor = 'white'): number {
  let cx = x
  for (const run of runs) {
    g.text(run.text, cx, y, scale, run.color ?? base)
    cx += run.text.length * 8 * scale
  }
  return cx - x
}
const rich = (g: Gfx, s: string, x: number, y: number, scale: number, base?: TextColor) => drawRuns(g, colorRuns(s), x, y, scale, base)

// The first n visible characters.
function cutRuns(runs: Run[], n: number): Run[] {
  const out: Run[] = []
  for (const run of runs) {
    if (n <= 0) break
    out.push({ ...run, text: run.text.slice(0, n) })
    n -= run.text.length
  }
  return out
}

// Draw_SStringAligned: text in a box of `width` pixels from x, cut to fit.
function aligned(g: Gfx, s: string, x: number, y: number, scale: number, align: 'left' | 'center' | 'right', width: number) {
  const runs = cutRuns(colorRuns(s), Math.floor(width / (8 * scale) + 1e-6))
  const used = runs.reduce((n, r) => n + r.text.length, 0) * 8 * scale
  const dx = align === 'right' ? width - used : align === 'center' ? (width - used) / 2 : 0
  drawRuns(g, runs, x + dx, y, scale)
}

const textSize = (s: string, scale: number, lines = 1): Size => ({ w: s.length * 8 * scale, h: 8 * scale * lines })

function rgba(spec: string | undefined, alphaFallback = 1): string {
  const parts = (spec ?? '').trim().split(/\s+/).map(Number)
  if (parts.length < 3 || parts.some((n) => !Number.isFinite(n))) return `rgba(255,255,255,${alphaFallback})`
  const a = parts.length >= 4 ? parts[3] / 255 : alphaFallback
  return `rgba(${parts[0]},${parts[1]},${parts[2]},${a})`
}

// ---------------------------------------------------------------- numbers

// SCR_HUD_DrawNum: style 0/2 big 24px digits, 1 small text, 3 small golden digits.
// `color`: an own colour for the text styles (1 and 3), normal or low, as unezquake's text_color_* settings.
function numberImpl(
  value: (ctx: Ctx) => number,
  low: (v: number, ctx: Ctx) => boolean = () => false,
  color: (p: Params, ctx: Ctx, low: boolean) => string | null = () => null,
): ElementImpl {
  const layout = (p: Params, ctx: Ctx) => {
    const v = Math.trunc(value(ctx))
    const style = int(p.style)
    const big = style === 0 || style === 2
    const digits = int(p.digits, 3)
    let s = String(style === 2 || v >= 0 ? v : Math.abs(v))
    if (digits > 0 && s.length > digits) s = s.slice(-digits) // hud_digits_trim 1
    const cw = (big ? 24 : 8) * scaleOf(p)
    const boxChars = digits > 0 ? digits : s.length
    const isLow = low(v, ctx)
    return { s, big, style, cw, box: boxChars * cw, low: isLow, color: big ? null : color(p, ctx, isLow) }
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
          g.text(ch, x, r.y, scaleOf(p), l.color ?? (l.low ? 'alt' : l.style === 3 ? 'gold' : 'white'))
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

// Lines of text; &cRGB colours are drawn, fun chars ($[, $x10...) are parsed.
function textImpl(text: (p: Params, ctx: Ctx) => string | string[], color: TextColor = 'white'): ElementImpl {
  const lines = (p: Params, ctx: Ctx) => {
    const t = text(p, ctx)
    return (Array.isArray(t) ? t : [t]).map(parseFunChars)
  }
  return {
    size(p, ctx) {
      const l = lines(p, ctx)
      const longest = Math.max(0, ...l.map(visibleLength))
      return { w: longest * 8 * scaleOf(p), h: l.length * 8 * scaleOf(p) }
    },
    draw(g, p, ctx, r) {
      const s = scaleOf(p)
      lines(p, ctx).forEach((line, i) => rich(g, line, r.x, r.y + i * 8 * s, s, color))
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

// ---------------------------------------------------------------- formatted elements

const BEST_AMMO = ['', '', 'shells', 'shells', 'nails', 'nails', 'rockets', 'rockets', 'cells']

// Teammates shown by teaminfo.
interface Mate {
  name: string
  loc: string
  health: number
  armor: number
  armorType: 0 | 1 | 2 | 3
  weapons: number[] // 2..8
  ammo: Record<string, number>
  powerups: string[]
  frags: number
}
const MATES: Mate[] = [
  { name: 'Ranger', loc: 'ra', health: 150, armor: 200, armorType: 3, weapons: [7, 8], ammo: { cells: 60, rockets: 25 }, powerups: ['quad'], frags: 31 },
  { name: 'Fiend', loc: 'mega', health: 20, armor: 30, armorType: 1, weapons: [7], ammo: { rockets: 4 }, powerups: [], frags: 23 },
  { name: 'Shambler', loc: 'quad', health: 100, armor: 95, armorType: 2, weapons: [8], ammo: { cells: 80 }, powerups: ['ring'], frags: 0 },
  { name: 'Knight', loc: 'gl', health: 100, armor: 0, armorType: 0, weapons: [2], ammo: { shells: 25 }, powerups: [], frags: 4 },
]

// SCR_HudDrawTeamInfoPlayer (hud_teaminfo.c): parses the layout and draws one row; returns its width.
function teaminfoRow(g: Gfx | null, p: Params, m: Mate, index: number, x0: number, y: number, maxname: number, maxloc: number): number {
  const s = num(p.scale, 1)
  const fw = 8 * s
  const layout = parseFunChars(p.layout ?? '')
  const best = Math.max(...m.weapons)
  const ammo = m.ammo[BEST_AMMO[best]] ?? 0
  const weaponStyle = int(p.weapon_style)
  const showAmmo = int(p.show_ammo) !== 0
  const armorStyle = int(p.armor_style, 3)
  const powerupStyle = int(p.powerup_style, 1)
  let x = x0
  const put = (t: string, width: number, align: 'left' | 'right') => {
    if (g) aligned(g, t, x, y, s, align, width)
    x += width
  }
  for (let i = 0; i < layout.length; i++) {
    if (layout[i] !== '%') {
      if (g && layout[i] !== ' ') g.text(layout[i], x, y, s)
      x += fw
      continue
    }
    const code = layout[++i]
    switch (code) {
      case 'n':
        put(m.name, maxname * fw, 'right')
        break
      case 'w':
      case 'W':
        if (weaponStyle === 1) {
          const name = m.weapons.includes(7) && m.weapons.includes(8) ? TP_NAMES.rlg : TP_NAMES[WEAPON_TP[best]]
          put(name, 3 * fw, code === 'W' || showAmmo ? 'right' : 'left')
        } else {
          // the weapon's status bar picture at half size
          if (g) g.pic(`inv_${WEAPON_PICS[best]}`, x, y, 12 * s, 8 * s)
          x += 2 * fw
        }
        if (showAmmo) put(`:${ammo}`, 4 * fw, 'left')
        break
      case 'k':
      case 'K':
        put(String(ammo), 3 * fw, 'left')
        break
      case 'r':
      case 'R':
        x += 2 * fw // respawn time: nobody is dead
        break
      case 'h':
      case 'H':
        put(`${m.health < int(p.low_health, 25) ? '&cf00' : ''}${m.health}`, 3 * fw, code === 'h' ? 'right' : 'left')
        break
      case 'f':
      case 'F':
        put(String(m.frags), 3 * fw, code === 'f' ? 'right' : 'left')
        break
      case 'a':
      case 'A': {
        let color = ''
        if (armorStyle === 1) {
          if (g && m.armorType) g.pic(`sb_armor${m.armorType}`, x, y, 8 * s, 8 * s)
          x += fw
        } else if (armorStyle === 3) color = ['', '&c0f0', '&cff0', '&cf00'][m.armorType]
        else if (armorStyle === 4) {
          if (g && m.armorType) g.text('gyr'[m.armorType - 1], x, y, s)
          x += fw
        }
        put(`${color}${m.armor}`, 3 * fw, code === 'A' ? 'left' : 'right')
        break
      }
      case 'l':
        put(m.loc, maxloc * fw, 'right')
        break
      case 'p': {
        if (powerupStyle < 1 || powerupStyle > 3) break
        const pics = powerupStyle === 1 ? ['sb_quad', 'sb_invuln', 'sb_invis'] : ['face_quad', 'face_invul2', 'face_invis']
        ;['quad', 'pent', 'ring'].forEach((item, k) => {
          if (g && m.powerups.includes(item)) {
            if (powerupStyle === 3) rich(g, ['&c03fQ', '&cf00P', '&cff0R'][k], x, y, s)
            else g.pic(pics[k], x, y, 8 * s, 8 * s)
          }
          x += fw
        })
        break
      }
      case 't':
        put(String(index + 1), fw, 'left')
        break
      case 'c':
        x += fw // nobody carries a flag
        break
      case '%':
        put('%', fw, 'left')
        break
      default:
        put(`%${code ?? ''}`, (code ? 2 : 1) * fw, 'left')
    }
  }
  return x - x0
}

const teaminfoNames = (p: Params) => ({
  maxname: Math.max(0, Math.min(Math.max(...MATES.map((m) => m.name.length)), int(p.name_width, 6))),
  maxloc: Math.max(0, Math.min(100, int(p.loc_width, 5))),
})

const teaminfoImpl = boxImpl(
  (p) => {
    const { maxname, maxloc } = teaminfoNames(p)
    return { w: teaminfoRow(null, p, MATES[0], 0, 0, 0, maxname, maxloc), h: 8 * num(p.scale, 1) * MATES.length }
  },
  (g, p, _ctx, r) => {
    const { maxname, maxloc } = teaminfoNames(p)
    MATES.forEach((m, i) => teaminfoRow(g, p, m, i, r.x, r.y + i * 8 * num(p.scale, 1), maxname, maxloc))
  },
)

// MVD_ClockList_TopItems_Draw (mvd_utils.c). colored_name is the built-in colour (style 0); tp_name_* is style 1.
const CLOCK_ITEMS: [string, string, string][] = [
  ['rl', '&cf0frl&r', ' 3'],
  ['quad', '&c00fquad&r', ' up'],
  ['ra', '&cf00ra&r', ' 4'],
  ['lg', '&cf0flg&r', ' 2'],
]
const brown = (s: string) => [...s].map((c) => String.fromCharCode(c.charCodeAt(0) | 128)).join('')
const itemsclockImpl: ElementImpl = (() => {
  const lines = (p: Params) => {
    const style = int(p.style)
    return CLOCK_ITEMS.map(([name, colored, time]) => {
      const t = int(p.timelimit, 5) >= 10 ? time.replace(/^ (\d)$/, '  $1') : time
      if (style === 1) return TP_NAMES[name] + t
      if (style === 2) return brown(name) + t
      return colored + t
    })
  }
  return {
    size(p) {
      const s = scaleOf(p)
      const style = int(p.style)
      const chars = style === 1 ? Math.max(...CLOCK_ITEMS.map(([n]) => visibleLength(TP_NAMES[n]))) + 6 : style === 3 || style === 4 ? 8 : 10
      return { w: chars * 8 * s, h: CLOCK_ITEMS.length * 8 * s }
    },
    draw(g, p, _ctx, r) {
      const s = scaleOf(p)
      lines(p).forEach((line, i) => rich(g, line, r.x, r.y + i * 8 * s, s))
    },
  }
})()

// SCR_CreateWeaponStatsPlayerText: %N is weapon N's accuracy, #N its hits (2 sg ... 8 lg).
const WEAPON_STATS: Record<number, [number, number]> = { 1: [0, 0], 2: [45.2, 31], 3: [30, 22], 4: [21.5, 40], 5: [24.8, 55], 6: [18, 3], 7: [52.3, 12], 8: [33.1, 140] }
const weaponstatsText = (p: Params) =>
  parseFunChars(p.format ?? '').replace(/([%#])([\s\S])/g, (_all, kind: string, next: string) => {
    if (next === kind) return kind
    const stats = WEAPON_STATS[Number(next)]
    if (!stats) return ''
    return kind === '%' ? stats[0].toFixed(1) : String(stats[1])
  })

// SCR_HUD_DrawScoresBar (hud_scores.c), red against blue.
function scoreBarSmall(p: Params, c: Ctx): string {
  const team = c.preview.teamScore
  const enemy = c.preview.enemyScore
  const digits = Math.max(1, Math.min(int(p.frag_length), 4))
  const diff = team - enemy
  return parseFunChars(p.format_small ?? '').replace(/%([\s\S])/g, (_all, code: string) => {
    switch (code) {
      case '%': return '%'
      case 't': return String(team).padStart(digits)
      case 'e': return String(enemy).padStart(digits)
      case 'd': return String(diff)
      case 'p': return '1'
      case 'T': return 'red'
      case 'E': return 'blue'
      case 'D': return diff >= 0 ? `+${diff}` : String(diff)
      default: return `%${code}`
    }
  })
}
// Big style: only %codes and ": / - space" are kept; "c...r" turns the digits red (SCR_DrawWadString).
function scoreBarBig(p: Params, c: Ctx): string {
  const team = c.preview.teamScore
  const enemy = c.preview.enemyScore
  const diff = team - enemy
  let out = ''
  const f = parseFunChars(p.format_big ?? '')
  for (let i = 0; i < f.length; i++) {
    if (f[i] === '%' && i + 1 < f.length) {
      const code = f[++i]
      const v: Record<string, string> = {
        d: String(diff),
        D: `c${diff}r`,
        e: String(enemy),
        E: `c${enemy}r`,
        p: '1',
        t: String(team),
        T: `c${team}r`,
        z: diff >= 0 ? String(diff) : `c${-diff}r`,
        Z: diff >= 0 ? `c${diff}r` : String(-diff),
      }
      out += v[code] ?? ''
    } else if (': /-'.includes(f[i])) out += f[i]
  }
  return out
}
function wadString(g: Gfx | null, t: string, x0: number, y: number, s: number): number {
  let x = x0
  let red = false
  for (const ch of t) {
    const prefix = red ? 'anum' : 'num'
    if (ch >= '0' && ch <= '9') {
      g?.pic(`${prefix}_${ch}`, x, y, 24 * s, 24 * s)
      x += 24 * s
    } else if (ch === ':' || ch === '/') {
      g?.pic(`${prefix}_${ch === ':' ? 'colon' : 'slash'}`, x, y, 16 * s, 24 * s)
      x += 16 * s
    } else if (ch === '-') {
      x -= 12 * s
      g?.pic(`${prefix}_minus`, x, y, 24 * s, 24 * s)
      x += 28 * s
    } else if (ch === ' ') x += 16 * s
    else if (ch === 'c') red = true
    else if (ch === 'r') red = false
  }
  return x - x0
}
const scoreBarImpl: ElementImpl = {
  size(p, c) {
    const s = scaleOf(p)
    if (int(p.style) === 1) return { w: wadString(null, scoreBarBig(p, c), 0, 0, s), h: 24 * s }
    return { w: visibleLength(scoreBarSmall(p, c)) * 8 * s, h: 8 * s }
  },
  draw(g, p, c, r) {
    const s = scaleOf(p)
    if (int(p.style) === 1) wadString(g, scoreBarBig(p, c), r.x, r.y, s)
    else rich(g, scoreBarSmall(p, c), r.x, r.y, s)
  },
}

// strftime, for scoreclock.
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function strftime(format: string, d: Date): string {
  const v: Record<string, string> = {
    d: pad2(d.getDate()),
    m: pad2(d.getMonth() + 1),
    Y: String(d.getFullYear()),
    y: pad2(d.getFullYear() % 100),
    H: pad2(d.getHours()),
    I: pad2(d.getHours() % 12 || 12),
    M: pad2(d.getMinutes()),
    S: pad2(d.getSeconds()),
    p: d.getHours() < 12 ? 'AM' : 'PM',
    a: DAYS[d.getDay()],
    b: MONTHS[d.getMonth()],
    '%': '%',
  }
  return format.replace(/%([\s\S])/g, (all, code: string) => v[code] ?? all)
}

// SCR_DrawHUDSpeed (hud_speed.c). Colours are palette indexes; style 1 is the number only.
const palette = (index: string | undefined, fallback: number, alpha: number) => {
  const hex = QUAKE_PALETTE[int(index, fallback) & 255] ?? '#ffffff'
  return `rgba(${parseInt(hex.slice(1, 3), 16)},${parseInt(hex.slice(3, 5), 16)},${parseInt(hex.slice(5, 7), 16)},${alpha})`
}
const speedImpl = boxImpl(
  (p) => ({ w: Math.max(0, num(p.width, 160)) * scaleOf(p), h: Math.max(0, num(p.height, 15)) * scaleOf(p) }),
  (g, p, c, r) => {
    const s = scaleOf(p)
    const speed = Math.trunc(c.preview.speed)
    const style = int(p.style)
    const textOnly = (style & 1) === 1
    const vertical = int(p.vertical) !== 0
    const opacity = num(p.opacity, 1)
    const { x, y, w, h } = r
    const white = palette('10', 10, opacity)
    const offset = Math.trunc(((vertical ? h : w) * (speed % 500)) / 500)
    const colors = [
      [p.color_stopped, 52],
      [p.color_normal, 100],
      [p.color_fast, 72],
      [p.color_fastest, 216],
      [p.color_insane, 229],
    ] as const
    const band = Math.min(3, Math.trunc(speed / 500))
    const slow = palette(colors[band][0], colors[band][1], opacity)
    const fast = palette(colors[band + 1][0], colors[band + 1][1], opacity)
    if (!textOnly) {
      const tick = num(p.tick_spacing, 0.2)
      if (tick > 0)
        for (let f = tick; f < 1; f += tick) {
          if (vertical) {
            g.fill(x, y + Math.trunc(f * h), 2, 1, white)
            g.fill(x + w - 1, y + Math.trunc(f * h), 2, 1, white)
          } else {
            g.fill(x + Math.trunc(f * w), y, 1, 2, white)
            g.fill(x + Math.trunc(f * w), y + h - 1, 1, 2, white)
          }
        }
      if (vertical) {
        g.fill(x + 2, y, 1, h, white)
        g.fill(x + w - 2, y, 1, h, white)
        g.fill(x + 3, y, w - 6, h - offset, slow)
        g.fill(x + 3, y + h - offset, w - 6, offset, fast)
      } else {
        g.fill(x, y + 2, w, 1, white)
        g.fill(x, y + h - 2, w, 1, white)
        g.fill(x + offset, y + 3, w - offset, h - 6, slow)
        g.fill(x, y + 3, offset, h - 6, fast)
      }
    }
    const align = int(p.text_align, 1)
    if (align === 0) return
    const text = style === 2 || style === 3 ? `${String(speed).padStart(4)}${'0'.padStart(5)}${'0'.padStart(5)}` : String(speed).padStart(4)
    if (vertical && int(p.vertical_text, 1)) {
      let ty = align === 3 ? y + h - 32 : align === 2 ? Math.round(y + h / 2 - 16) : y
      for (const digit of String(speed)) {
        g.text(digit, Math.round(x + w / 2 - 4 * s), ty, s)
        ty += 8
      }
    } else {
      aligned(g, text, x, y + h / 2 - 4 * s, s, align === 3 ? 'right' : align === 2 ? 'center' : 'left', Math.max(w, text.length * 8 * s))
    }
  },
)

// unezquake's armor text_color_<type>_low / _normal (text_color_none without armor); empty means the usual colours.
function armorTextColor(p: Params, ctx: Ctx, low: boolean): string | null {
  const type = ctx.preview.armor > 0 ? ['ga', 'ya', 'ra'][ctx.preview.armorType - 1] : null
  const spec = type ? p[`text_color_${type}_${low ? 'low' : 'normal'}`] : p.text_color_none
  const rgb = spec ? parseRgb(spec) : null
  return rgb ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : null
}

// unezquake's total strength (SCR_HUD_TotalStrength): min(health / (1 - absorption), health + armor), red when
// health is low.
const ABSORPTION = [0, 0.3, 0.6, 0.8]
const totalStrength = (ctx: Ctx) => {
  const { health, armor, armorType } = ctx.preview
  return Math.max(0, Math.min(health / (1 - (armor > 0 ? ABSORPTION[armorType] : 0)), health + armor))
}

// unezquake's map vote (hud_mapvote.c): "map vote for <map>", "use /agree to vote" and a 200×112 picture of the
// map, in a box; ezQuake shows it for 10 s during a prewar vote. The map picture is a stand-in here.
const MAPVOTE: ElementImpl = (() => {
  const metrics = (p: Params) => {
    const s = Math.min(10, Math.max(0.1, scaleOf(p)))
    const text = Math.trunc(8 * s)
    const padX = Math.trunc(4 * s)
    const padY = Math.trunc(2 * s)
    return { s, text, padX, padY, w: 200 + padX * 2, h: text * 2 + padY * 2 + 112 }
  }
  return {
    size(p) {
      const m = metrics(p)
      return { w: m.w, h: m.h }
    },
    draw(g, p, _ctx, r) {
      const m = metrics(p)
      g.fill(r.x, r.y, m.w, m.h, 'rgba(10,10,10,0.63)') // scr_mapvote_frame_color "10 10 10 160"
      g.text('map vote for dm2', r.x + m.padX, r.y + m.padY, m.s)
      g.text('use /agree to vote', r.x + m.padX, r.y + m.padY + m.text, m.s)
      const top = r.y + m.padY + m.text * 2
      g.fill(r.x + m.padX, top, 200, 112, '#3b3227')
      g.text('dm2', r.x + m.padX + 100 - 12, top + 52, 1, 'alt')
    },
  }
})()

export const IMPLS: Record<string, ElementImpl> = {
  face: picImpl((_p, c) => `face${faceIndex(c.preview.health)}`, 24, 24, () => 'f', () => true),
  health: numberImpl((c) => c.preview.health, (v) => v <= 25),
  armor: numberImpl((c) => c.preview.armor, (v) => v <= 25, armorTextColor),
  totalstrength: numberImpl(totalStrength, (_v, c) => c.preview.health <= 25),
  mapvote: MAPVOTE,
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
  itemsclock: itemsclockImpl,

  clock: clockImpl((p) => (clockFormats[int(p.format)] ?? clockFormats[0])(), 1),
  gameclock: clockImpl(() => '12:34', 1),
  democlock: clockImpl(() => '03:21', 0),
  scoreclock: textImpl((p) => strftime(p.format ?? '%d-%m-%Y %H:%M:%S', now)),


  frags: fragsImpl(4, false),
  teamfrags: fragsImpl(2, true),
  ownfrags: textImpl(() => 'You fragged Grunt'),
  score_team: numberImpl((c) => c.preview.teamScore),
  score_enemy: numberImpl((c) => c.preview.enemyScore),
  score_difference: numberImpl((c) => c.preview.teamScore - c.preview.enemyScore),
  score_position: numberImpl(() => 1),
  score_bar: scoreBarImpl,
  // Weapons in the tp_name_* colours: rl red, lg blue.
  tracker: textImpl(() => [`Ranger ${TP_NAMES.rl} Grunt`, `Ogre ${TP_NAMES.lg} Fiend`, `Zombie ${TP_NAMES.gl} Shambler`]),

  teaminfo: teaminfoImpl,
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
  speed: speedImpl,
  speed2: mockBox('speed', (p) => {
    const rad = num(p.radius, 50) * scaleOf(p)
    return int(p.orientation) % 2 ? { w: rad, h: 2 * rad } : { w: 2 * rad, h: rad }
  }),
  weaponstats: textImpl((p) => weaponstatsText(p).split('\n')),
  keys: textImpl(() => [' ^ ', '<v>']),

  ...Object.fromEntries(
    [1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [`group${i}`, groupImpl]),
  ),
}

const NONE: ElementImpl = { size: () => null, draw: () => {} }
export function implFor(name: string): ElementImpl {
  return IMPLS[name] ?? NONE
}
