// Pictures for hud_group<N>_picture. ezQuake loads gfx/<name>; the editor has these, plus any the user dropped.
// Sizes are needed synchronously: pic_scalemode 3 grows the group to the picture size.
import type { HudDoc } from './cfg'
import clock from '../assets/gfx/clock.png'
import scoregra from '../assets/gfx/scoregra.png'

export interface Picture {
  url: string
  w: number
  h: number
}

const PICTURES: Record<string, Picture> = {
  clock: { url: clock, w: 128, h: 128 }, // carapace
  scoregra: { url: scoregra, w: 72, h: 22 }, // mille
}

// "Clock", "clock.png" and "gfx/clock" all name the same file, as on a case-insensitive file system.
export const pictureName = (value: string | undefined) =>
  (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/^gfx\//, '')
    .replace(/\.(png|tga|jpg|pcx|lmp)$/, '')

// The pictures the HUD's groups show, by name.
export const groupPictures = (doc: HudDoc) =>
  new Set(Object.entries(doc.elements).flatMap(([name, p]) => (/^group[0-9]$/.test(name) && pictureName(p.picture) ? [pictureName(p.picture)] : [])))

let custom: Record<string, Picture> = {}
export function setCustomPictures(pictures: Record<string, Picture>) {
  custom = pictures
}

// Every picture a group can show now: the editor's own, then the ones the user loaded (later ones win).
export function availablePictures(): (Picture & { name: string; own: boolean })[] {
  const own = Object.entries(PICTURES).filter(([name]) => !custom[name])
  return [
    ...own.map(([name, p]) => ({ ...p, name, own: true })),
    ...Object.entries(custom)
      .filter(([name]) => !name.startsWith('#')) // the charset and crosshair aren't gfx pictures
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, p]) => ({ ...p, name, own: false })),
  ]
}

export function findPicture(value: string | undefined): Picture | undefined {
  const name = pictureName(value)
  return custom[name] ?? PICTURES[name]
}
