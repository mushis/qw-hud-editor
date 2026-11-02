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
}

export const SCREEN_AREAS = ['screen', 'top', 'view', 'sbar', 'ibar', 'hbar', 'sfree', 'ifree', 'hfree'] as const
export const ALIGN_X = ['left', 'center', 'right', 'before', 'after'] as const
export const ALIGN_Y = ['top', 'center', 'bottom', 'before', 'after', 'console'] as const

export function sbLinesForViewsize(viewsize: number): number {
  return viewsize < 110 ? 48 : viewsize < 120 ? 24 : 0
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
      return { x: 0, y: 0, w: W, h: H } // scr_vrect is full screen at viewsize >= 100
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
