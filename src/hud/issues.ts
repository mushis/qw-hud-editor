// Problems in a HUD that make an enabled element look different from what its cvars suggest.
// Only elements with show on are checked: a hidden element has no visible problem.

import { ELEMENTS } from './catalog'
import type { ClientSettings, HudDoc } from './cfg'
import { ALIGN_X, ALIGN_Y, SCREEN_AREAS, shouldShow, wouldCycle, type Placed, type Screen } from './layout'
import { findPicture, pictureName } from './pictures'

export type Severity = 'error' | 'warning' | 'info'

export interface Issue {
  element: string
  severity: Severity
  message: string
  params: string[] // the settings at fault, which Reset puts back to their defaults
}

export type Edge = 'left' | 'right' | 'top' | 'bottom'

// Edges of the screen the box crosses, and whether nothing of it is on screen.
export function offscreen({ outer: o }: Placed, screen: Screen): { edges: Edge[]; hidden: boolean } {
  const edges: Edge[] = []
  if (o.x < 0) edges.push('left')
  if (o.x + o.w > screen.width) edges.push('right')
  if (o.y < 0) edges.push('top')
  if (o.y + o.h > screen.height) edges.push('bottom')
  const hidden = o.x + o.w <= 0 || o.y + o.h <= 0 || o.x >= screen.width || o.y >= screen.height
  return { edges, hidden }
}

// Settings ezQuake takes below 0: positions, draw order, the game clock offset, the frags cell spacing and
// fps drop (only fps has it).
// Everything else is a size, count, style or colour.
const NEGATIVE_OK = new Set(['pos_x', 'pos_y', 'order', 'offset', 'space_x', 'space_y', 'drop'])
// Values that look numeric but are free text.
export const TEXT_PARAMS = /format|layout|text$|filter|^name$|picture/
const NUMBER = /^\s*-?(\d+\.?\d*|\.\d+)\s*$/

// Lowest value a setting takes (-Infinity when it may be negative).
export const minValue = (param: string) => (NEGATIVE_OK.has(param) || TEXT_PARAMS.test(param) ? -Infinity : 0)

const isOneOf = (list: readonly string[], value: string) => list.includes(value.toLowerCase())

// An invalid align that lands where its word says anyway: ezQuake falls back to left for align_x and top for
// align_y, so align_x "top" and align_y "left" look the same as a valid value would.
export const harmlessAlign = (param: string, value: string) =>
  (param === 'align_x' && value.trim().toLowerCase() === 'top') || (param === 'align_y' && value.trim().toLowerCase() === 'left')

// Why a place / align_x / align_y value is invalid, or null. ezQuake (HUD_FindPlace, HUD_FindAlignX/Y)
// silently falls back on a bad value. Screen areas and aligns ignore case; element names don't.
export function invalidReason(doc: HudDoc, element: string, param: string): string | null {
  const value = doc.elements[element]?.[param]
  if (value === undefined) return null
  switch (param) {
    case 'place': {
      const target = value.replace(/^@/, '')
      if (!value || isOneOf(SCREEN_AREAS, value) || (target !== element && doc.elements[target])) return null
      return target === element
        ? `place can't be the element itself: the game uses "screen".`
        : `place "${value}" is not a screen area or element: the game uses "screen".`
    }
    case 'align_x':
      if (isOneOf(ALIGN_X, value)) return null
      return harmlessAlign(param, value)
        ? `align_x "${value}" is not a valid value: the game uses "left", which is the same here.`
        : `align_x "${value}" is not valid: the game uses "left".`
    case 'align_y':
      if (isOneOf(ALIGN_Y, value)) return null
      return harmlessAlign(param, value)
        ? `align_y "${value}" is not a valid value: the game uses "top", which is the same here.`
        : `align_y "${value}" is not valid: the game uses "top".`
  }
  if (NUMBER.test(value) && parseFloat(value) < minValue(param)) return `${param} can't be negative.`
  return null
}

export function findIssues(doc: HudDoc, placed: Map<string, Placed>, screen: Screen): Issue[] {
  const issues: Issue[] = []
  for (const { name } of ELEMENTS) {
    const p = doc.elements[name]
    if (!p || !shouldShow(p.show)) continue
    const add = (severity: Severity, message: string, params: string[] = []) => issues.push({ element: name, severity, message, params })

    for (const param of Object.keys(p)) {
      const reason = invalidReason(doc, name, param)
      if (reason) add(harmlessAlign(param, p[param]) ? 'info' : 'warning', reason, [param])
    }
    const parent = (p.place ?? '').replace(/^@/, '')
    const isElement = parent !== name && !!doc.elements[parent]

    const box = placed.get(name)
    if (!box) {
      if (isElement && wouldCycle(doc, name, parent)) add('error', `Placement loop with ${parent}: neither is drawn.`, ['place'])
      else if (isElement && !placed.has(parent)) add('warning', `Not drawn: it is placed on ${parent}, which is hidden.`, ['place'])
      continue
    }

    if (box.draw) {
      const { edges, hidden } = offscreen(box, screen)
      if (hidden) add('error', `Off-screen at ${box.outer.x}, ${box.outer.y}: not visible at ${screen.width}×${screen.height}.`, ['pos_x', 'pos_y'])
      else if (edges.length) add('warning', `Partly off-screen: cut off at the ${edges.join(' and ')} edge.`, ['pos_x', 'pos_y'])
    }

    if (name.startsWith('group') && pictureName(p.picture) && !findPicture(p.picture)) {
      add('info', `picture "${p.picture}" (gfx/${pictureName(p.picture)}) isn't available in the editor: drop the image file onto the editor to show it.`)
    }
  }
  return issues
}

// ---------------------------------------------------------------- client settings

// A problem with the resolution or the HUD's virtual size, and what fixes it.
export interface ClientIssue {
  cvar: string
  severity: Severity
  message: string
  fix?: { label: string; title: string; settings: Partial<ClientSettings> & { cfgResolution?: null } }
}

const MAX_SIDE = 16384

// A vid_width / vid_height from a cfg the editor can't show: 0 (ezQuake then uses the desktop resolution), below
// the 320×200 ezQuake allows, or bigger than any screen.
export function unusableResolution({ width, height }: Partial<ClientSettings>): boolean {
  const bad = (v: number | undefined, min: number) => v !== undefined && (v < min || v > MAX_SIDE)
  return bad(width, 320) || bad(height, 200)
}

const ratio = (w: number, h: number) => (h ? w / h : 0)

// Checks the client settings, and the resolution the last cfg set but the editor didn't use.
export function clientIssues(s: ClientSettings, fromCfg: { width?: number; height?: number } | null): ClientIssue[] {
  const issues: ClientIssue[] = []
  const here = `${s.width}×${s.height}`
  if (fromCfg) {
    const { width: w, height: h } = fromCfg
    const set = [w !== undefined && `vid_width ${w}`, h !== undefined && `vid_height ${h}`].filter(Boolean).join(' and ')
    const why =
      w === 0 || h === 0
        ? 'With 0, ezQuake uses your desktop resolution (vid_usedesktopres 1, its default), or 1024×768 when that is off'
        : (w !== undefined && w > MAX_SIDE) || (h !== undefined && h > MAX_SIDE)
          ? "That is bigger than any screen ezQuake can open"
          : 'ezQuake uses at least 320×200'
    issues.push({
      cvar: w !== undefined ? 'vid_width' : 'vid_height',
      severity: 'warning',
      message: `The config sets ${set}. ${why}. The editor kept ${here}: pick your resolution at the top.`,
      // 0 has to be answered in the resolution dialog; the other values can be left as they are.
      ...(w === 0 || h === 0 ? {} : { fix: { label: 'Dismiss', title: `Keep ${here} and hide this.`, settings: { cfgResolution: null } } }),
    })
  }
  const r = ratio(s.width, s.height)
  if (r > 4 || r < 1) {
    issues.push({
      cvar: 'vid_width',
      severity: 'info',
      message: `${here} is an unusual shape for a screen (${r < 1 ? 'taller than wide' : `${r.toFixed(1)} times wider than tall`}): check vid_width and vid_height.`,
      fix: { label: 'Use 1920×1080', title: 'Set the resolution to 1920×1080.', settings: { width: 1920, height: 1080, cfgResolution: null } },
    })
  }
  if (!s.conwidth && !s.conheight && s.conscale <= 0) {
    issues.push({
      cvar: 'vid_conscale',
      severity: 'warning',
      message: `vid_conscale ${s.conscale}: ezQuake then makes the HUD's virtual size the full resolution, so everything is tiny.`,
      fix: { label: 'Use 2', title: 'Set vid_conscale to 2, its default.', settings: { conscale: 2 } },
    })
  }
  const sides: [keyof ClientSettings, string, number, number, string][] = [
    ['conwidth', 'vid_conwidth', s.width, 320, 'vid_width'],
    ['conheight', 'vid_conheight', s.height, 200, 'vid_height'],
  ]
  for (const [key, cvar, max, min, of] of sides) {
    const v = s[key]
    if (!v) continue
    if (v > max) {
      issues.push({
        cvar,
        severity: 'info',
        message: `${cvar} ${v} is more than ${of} ${max}: ezQuake uses ${max}.`,
        fix: { label: `Use ${max}`, title: `Set ${cvar} to ${max}.`, settings: { [key]: max } },
      })
    } else if (v < min) {
      issues.push({
        cvar,
        severity: 'info',
        message: `${cvar} ${v} is below ${min}: ezQuake uses ${min}.`,
        fix: { label: `Use ${min}`, title: `Set ${cvar} to ${min}.`, settings: { [key]: min } },
      })
    }
  }
  return issues
}
