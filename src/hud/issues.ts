// Problems in a HUD that make an enabled element look different from what its cvars suggest.
// Only elements with show on are checked: a hidden element has no visible problem.

import { ELEMENTS } from './catalog'
import type { HudDoc } from './cfg'
import { ALIGN_X, ALIGN_Y, SCREEN_AREAS, shouldShow, wouldCycle, type Placed, type Screen } from './layout'
import { findPicture, pictureName } from './pictures'

export type Severity = 'error' | 'warning' | 'info'

export interface Issue {
  element: string
  severity: Severity
  message: string
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

const isOneOf = (list: readonly string[], value: string) => list.includes(value.toLowerCase())

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
      return isOneOf(ALIGN_X, value) ? null : `align_x "${value}" is not valid: the game uses "left".`
    case 'align_y':
      return isOneOf(ALIGN_Y, value) ? null : `align_y "${value}" is not valid: the game uses "top".`
  }
  return null
}

export function findIssues(doc: HudDoc, placed: Map<string, Placed>, screen: Screen): Issue[] {
  const issues: Issue[] = []
  for (const { name } of ELEMENTS) {
    const p = doc.elements[name]
    if (!p || !shouldShow(p.show)) continue
    const add = (severity: Severity, message: string) => issues.push({ element: name, severity, message })

    for (const param of ['place', 'align_x', 'align_y']) {
      const reason = invalidReason(doc, name, param)
      if (reason) add('warning', reason)
    }
    const parent = (p.place ?? '').replace(/^@/, '')
    const isElement = parent !== name && !!doc.elements[parent]

    const box = placed.get(name)
    if (!box) {
      if (isElement && wouldCycle(doc, name, parent)) add('error', `Placement loop with ${parent}: neither is drawn.`)
      else if (isElement && !placed.has(parent)) add('warning', `Not drawn: it is placed on ${parent}, which is hidden.`)
      continue
    }

    if (box.draw) {
      const { edges, hidden } = offscreen(box, screen)
      if (hidden) add('error', `Off-screen at ${box.outer.x}, ${box.outer.y}: not visible at ${screen.width}×${screen.height}.`)
      else if (edges.length) add('warning', `Partly off-screen: cut off at the ${edges.join(' and ')} edge.`)
    }

    if (name.startsWith('group') && pictureName(p.picture) && !findPicture(p.picture)) {
      add('info', `picture "${p.picture}" (gfx/${pictureName(p.picture)}) isn't available in the editor: drop the image file onto the editor to show it.`)
    }
  }
  return issues
}
