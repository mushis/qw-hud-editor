// Port of ezQuake's HUD placement (HUD_PrepareDraw / HUD_DrawObject in src/hud.c).
// All coordinates are virtual console pixels (conwidth x conheight).

import { ELEMENT_BY_NAME } from './catalog'
import type { HudDoc, Params } from './cfg'

export interface Size {
  w: number
  h: number
}

export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export interface Placed {
  name: string
  outer: Rect // including frame padding
  content: Rect // where the element draws itself
  order: number
  draw: boolean // false for draw 0: positioned (children work) but not rendered
}

export interface Screen {
  width: number // conwidth
  height: number // conheight
  sbLines: number // from viewsize: <110 = 48, <120 = 24, else 0
  view: Rect // the 3D view (scr_vrect): the whole screen at viewsize 100 and up, smaller and centred below
}

export const SCREEN_AREAS = ['screen', 'top', 'view', 'sbar', 'ibar', 'hbar', 'sfree', 'ifree', 'hfree'] as const
export const ALIGN_X = ['left', 'center', 'right', 'before', 'after'] as const
export const ALIGN_Y = ['top', 'center', 'bottom', 'before', 'after', 'console'] as const

export function sbLinesForViewsize(viewsize: number): number {
  return viewsize < 110 ? 48 : viewsize < 120 ? 24 : 0
}

// SCR_CalcRefdef (cl_screen.c), with cl_sbar 0. viewsize is bound to 30..120.
export function viewRect(W: number, H: number, viewsize: number): Rect {
  const size = Math.min(120, Math.max(30, viewsize))
  if (size >= 100) return { x: 0, y: 0, w: W, h: H }
  let f = size / 100
  let w = Math.trunc(W * f)
  if (w < 96) {
    f = 96 / w
    w = 96
  }
  const h = Math.min(Math.trunc(H * f), H - 48)
  return { x: Math.trunc((W - w) / 2), y: Math.trunc((H - 48 - h) / 2), w, h }
}

export function screenFor(width: number, height: number, viewsize: number): Screen {
  return { width, height, sbLines: sbLinesForViewsize(viewsize), view: viewRect(width, height, viewsize) }
}

const SBAR_WIDTH = 320

export function areaBounds(place: string, s: Screen): Rect {
  const { width: W, height: H, sbLines: sb } = s
  const hb = Math.min(24, sb)
  const ib = Math.max(sb - 24, 0)
  switch (place) {
    case 'top':
      return { x: 0, y: 0, w: W, h: H - sb }
    case 'view':
      return s.view
    case 'sbar':
      return { x: 0, y: H - sb, w: SBAR_WIDTH, h: sb }
    case 'ibar':
      return { x: 0, y: H - sb, w: SBAR_WIDTH, h: ib }
    case 'hbar':
      return { x: 0, y: H - hb, w: SBAR_WIDTH, h: hb }
    case 'sfree':
      return { x: SBAR_WIDTH, y: H - sb, w: W - SBAR_WIDTH, h: sb }
    case 'ifree':
      return { x: SBAR_WIDTH, y: H - sb, w: W - SBAR_WIDTH, h: ib }
    case 'hfree':
      return { x: SBAR_WIDTH, y: H - hb, w: W - SBAR_WIDTH, h: hb }
    default:
      return { x: 0, y: 0, w: W, h: H }
  }
}

export interface ParsedPlace {
  area: string | null // screen area, or null when placed on an element
  parent: string | null
  inside: boolean // "@name"
}

// HUD_FindPlace: screen areas are case-insensitive, element names are case-sensitive,
// unknown names fall back to "screen".
export function parsePlace(place: string | undefined, self: string, doc: HudDoc): ParsedPlace {
  const value = place ?? ''
  const lower = value.toLowerCase()
  if ((SCREEN_AREAS as readonly string[]).includes(lower)) return { area: lower, parent: null, inside: false }
  const inside = value.startsWith('@')
  const name = inside ? value.slice(1) : value
  if (name !== self && doc.elements[name]) return { area: null, parent: name, inside }
  return { area: 'screen', parent: null, inside: false }
}

const num = (v: string | undefined, fallback = 0) => {
  const n = parseFloat(v ?? '')
  return Number.isFinite(n) ? n : fallback
}

export interface FrameExtents {
  l: number
  r: number
  t: number
  b: number
}

// HUD_CalcFrameExtents
export function frameExtents(frame: number, w: number, h: number, noGrow: boolean): FrameExtents {
  if (noGrow && frame !== 2) return { l: 0, r: 0, t: 0, b: 0 }
  if (frame === 2) {
    const ax = w % 16
    const ay = h % 8
    return { l: 8 + Math.trunc(ax / 2), t: 8 + Math.trunc(ay / 2), r: 8 + ax - Math.trunc(ax / 2), b: 8 + ay - Math.trunc(ay / 2) }
  }
  if (frame > 0 && frame <= 1) {
    const fx = w > 8 ? 4 : 2
    const fy = h > 8 ? 4 : 2
    return { l: fx, r: fx, t: fy, b: fy }
  }
  return { l: 0, r: 0, t: 0, b: 0 }
}

// show/draw: 0 off, 1 on, 2 single player only, 3 multiplayer only (the editor previews multiplayer).
export function shouldShow(value: string | undefined): boolean {
  const v = Math.trunc(num(value, 1))
  return v === 1 || v === 3
}

export type Sizer = (name: string, params: Params) => Size | null

// Lays out every shown element. An element whose parent could not be placed
// (hidden, sizer returned null, or a placement loop) is not placed either, as in game.
export function layoutHud(doc: HudDoc, screen: Screen, sizer: Sizer): Map<string, Placed> {
  const placed = new Map<string, Placed>()
  const tried = new Set<string>()

  const place = (name: string): Placed | null => {
    if (tried.has(name)) return placed.get(name) ?? null
    tried.add(name)
    const p = doc.elements[name]
    if (!p || !shouldShow(p.show)) return null

    const where = parsePlace(p.place, name, doc)
    let area: Rect
    if (where.parent) {
      const parent = place(where.parent)
      if (!parent) return null
      area = where.inside ? parent.content : parent.outer
    } else {
      area = areaBounds(where.area!, screen)
    }

    const size = sizer(name, p)
    if (!size) return null
    let w = Math.trunc(size.w)
    let h = Math.trunc(size.h)
    const ext = frameExtents(num(p.frame), w, h, ELEMENT_BY_NAME.get(name)?.noGrow ?? false)
    w += ext.l + ext.r
    h += ext.t + ext.b

    let x: number
    switch ((p.align_x ?? '').toLowerCase()) {
      case 'center': x = area.x + Math.trunc((area.w - w) / 2); break
      case 'right': x = area.x + area.w - w; break
      case 'before': x = area.x - w; break
      case 'after': x = area.x + area.w; break
      default: x = area.x
    }
    let y: number
    switch ((p.align_y ?? '').toLowerCase()) {
      case 'center': y = area.y + Math.trunc((area.h - h) / 2); break
      case 'bottom': y = area.y + area.h - h; break
      case 'before': y = area.y - h; break
      case 'after': y = area.y + area.h; break
      case 'console': y = area.y; break // console closed
      default: y = area.y
    }
    x = Math.trunc(x + num(p.pos_x))
    y = Math.trunc(y + num(p.pos_y))

    const result: Placed = {
      name,
      outer: { x, y, w, h },
      content: { x: x + ext.l, y: y + ext.t, w: w - ext.l - ext.r, h: h - ext.t - ext.b },
      order: num(p.order),
      draw: shouldShow(p.draw),
    }
    placed.set(name, result)
    return result
  }

  for (const name of Object.keys(doc.elements)) place(name)
  return placed
}

export type Corner = 'tl' | 'tr' | 'bl' | 'br'

// What dragging a corner changes: scale when the element has it, else its width and height (groups, bars).
export type ResizeBy = 'scale' | 'size' | null
export const resizeBy = (params: Params | undefined): ResizeBy =>
  !params ? null : 'scale' in params ? 'scale' : 'width' in params && 'height' in params ? 'size' : null

// Changes to an element plus the pos_x / pos_y that keep its `corner` where it is now on the screen, e.g. after
// a new scale or place. pos is added to the aligned position, so the shift is exact.
export function keepInPlace(doc: HudDoc, screen: Screen, sizer: Sizer, name: string, changes: Params, corner: Corner = 'tl'): Params {
  const before = layoutHud(doc, screen, sizer).get(name)
  const next: HudDoc = { ...doc, elements: { ...doc.elements, [name]: { ...doc.elements[name], ...changes } } }
  const after = layoutHud(next, screen, sizer).get(name)
  if (!before || !after) return changes
  const at = (r: Rect) => [corner[1] === 'r' ? r.x + r.w : r.x, corner[0] === 'b' ? r.y + r.h : r.y]
  const [bx, by] = at(before.outer)
  const [ax, ay] = at(after.outer)
  const p = next.elements[name]
  return { ...changes, pos_x: String(num(p.pos_x) + bx - ax), pos_y: String(num(p.pos_y) + by - ay) }
}

// What puts an element placed on another one on the screen instead, where it is now. It is aligned to the
// nearest screen edge (or the centre), which keeps pos small and the element there at other resolutions.
export function unanchored(doc: HudDoc, screen: Screen, sizer: Sizer, name: string): Params {
  const box = layoutHud(doc, screen, sizer).get(name)?.outer
  const third = (at: number, size: number, sides: [string, string, string]) => sides[Math.min(2, Math.max(0, Math.floor((at / size) * 3)))]
  const align = box
    ? {
        align_x: third(box.x + box.w / 2, screen.width, ['left', 'center', 'right']),
        align_y: third(box.y + box.h / 2, screen.height, ['top', 'center', 'bottom']),
      }
    : { align_x: 'left', align_y: 'top' }
  return keepInPlace(doc, screen, sizer, name, { place: 'screen', ...align })
}

// Draw order: ascending "order", ties keep registration order (HUD_Sort).
export function drawOrder(placed: Map<string, Placed>, registration: string[]): Placed[] {
  const index = new Map(registration.map((n, i) => [n, i]))
  return [...placed.values()].sort((a, b) => a.order - b.order || (index.get(a.name) ?? 0) - (index.get(b.name) ?? 0))
}

// True if placing `child` on `parent` would create a loop.
export function wouldCycle(doc: HudDoc, child: string, parent: string): boolean {
  let cur: string | null = parent
  const seen = new Set<string>()
  while (cur && !seen.has(cur)) {
    if (cur === child) return true
    seen.add(cur)
    cur = parsePlace(doc.elements[cur]?.place, cur, doc).parent
  }
  return false
}

// Elements by place: each one under the element it is placed on, once. Elements in a placement loop,
// which ezQuake doesn't draw, are listed at the top level after the rest.
export function placeTree(doc: HudDoc, names: string[]): { name: string; depth: number }[] {
  const parentOf = (n: string) => {
    const target = (doc.elements[n]?.place ?? '').replace(/^@/, '')
    return target !== n && doc.elements[target] ? target : null
  }
  const children = new Map<string, string[]>()
  for (const n of names) {
    const p = parentOf(n)
    if (p) children.set(p, [...(children.get(p) ?? []), n])
  }
  const out: { name: string; depth: number }[] = []
  const seen = new Set<string>()
  const walk = (n: string, depth: number) => {
    if (seen.has(n)) return
    seen.add(n)
    out.push({ name: n, depth })
    for (const c of children.get(n) ?? []) walk(c, depth + 1)
  }
  for (const n of names) if (!parentOf(n)) walk(n, 0)
  for (const n of names) walk(n, 0)
  return out
}
