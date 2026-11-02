import type { ViewMode } from './catalog'

// Fake game state used to size and draw elements, like ezQuake's hud_planmode.
export interface Preview {
  mode: ViewMode
  health: number
  armor: number
  armorType: 1 | 2 | 3 // green, yellow, red
  shells: number
  nails: number
  rockets: number
  cells: number
  activeWeapon: number // 2..8 like gun2..gun8
  showItems: boolean // keys, powerups and runes held
  fps: number
  ping: number
  speed: number
  teamScore: number
  enemyScore: number
}

export const DEFAULT_PREVIEW: Preview = {
  mode: 'player',
  health: 100,
  armor: 150,
  armorType: 3,
  shells: 40,
  nails: 120,
  rockets: 25,
  cells: 60,
  activeWeapon: 7,
  showItems: true,
  fps: 250,
  ping: 25,
  speed: 320,
  teamScore: 54,
  enemyScore: 37,
}

export const WEAPON_AMMO = ['', '', 'shells', 'shells', 'nails', 'nails', 'rockets', 'rockets', 'cells'] as const

export function activeAmmo(p: Preview): number {
  const kind = WEAPON_AMMO[p.activeWeapon]
  return kind ? p[kind] : 0
}

export const PLAYERS = [
  { name: 'Ranger', team: 'red', frags: 31, color: '#d33' },
  { name: 'Ogre', team: 'blue', frags: 27, color: '#36c' },
  { name: 'Fiend', team: 'red', frags: 23, color: '#d33' },
  { name: 'Grunt', team: 'blue', frags: 10, color: '#36c' },
  { name: 'Shambler', team: 'red', frags: 0, color: '#d33' },
  { name: 'Zombie', team: 'blue', frags: -2, color: '#36c' },
]
