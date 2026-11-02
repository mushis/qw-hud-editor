// Pictures for hud_group<N>_picture. ezQuake loads gfx/<name>; the editor has these, plus any the user dropped.
// Sizes are needed synchronously: pic_scalemode 3 grows the group to the picture size.
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

let custom: Record<string, Picture> = {}
export function setCustomPictures(pictures: Record<string, Picture>) {
  custom = pictures
}

export function findPicture(value: string | undefined): Picture | undefined {
  const name = pictureName(value)
  return custom[name] ?? PICTURES[name]
}
