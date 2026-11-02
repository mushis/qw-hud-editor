// Every HUD element registered by ezQuake (HUD_Register calls in src/hud*.c).

export type Category =
  | 'status'
  | 'inventory'
  | 'weapons'
  | 'items'
  | 'clocks'
  | 'scores'
  | 'team'
  | 'network'
  | 'misc'
  | 'groups'

// When an element actually draws in game. 'always' means no special condition.
export type Condition =
  | 'always'
  | 'player' // own stats: hidden for a free-flying spectator
  | 'spectator' // spectating or demo playback
  | 'demo' // demo (or MVD) playback only
  | 'intermission' // intermission / scoreboard only

export type ViewMode = 'player' | 'spectator' | 'demo'

export interface ElementDef {
  name: string
  category: Category
  description: string
  condition: Condition
  // HUD_INVENTORY / HUD_NO_GROW: frame does not add padding (except frame 2).
  noGrow?: boolean
}

const el = (
  name: string,
  category: Category,
  description: string,
  condition: Condition = 'always',
  noGrow = false,
): ElementDef => ({ name, category, description, condition, noGrow })

const range = (prefix: string, from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => `${prefix}${from + i}`)

const WEAPON_NAMES = ['shotgun', 'super shotgun', 'nailgun', 'super nailgun', 'grenade launcher', 'rocket launcher', 'lightning gun']
const AMMO_NAMES = ['shells', 'nails', 'rockets', 'cells']

export const CATEGORY_LABELS: Record<Category, string> = {
  status: 'Player status',
  inventory: 'Ammo',
  weapons: 'Weapons',
  items: 'Items & powerups',
  clocks: 'Clocks',
  scores: 'Scores & frags',
  team: 'Team & spectator',
  network: 'Network & performance',
  misc: 'Misc',
  groups: 'Groups',
}

export const ELEMENTS: ElementDef[] = [
  el('face', 'status', 'Your face (health picture)', 'player', true),
  el('health', 'status', 'Health level', 'player', true),
  el('armor', 'status', 'Armor level', 'player', true),
  el('iarmor', 'status', 'Armor icon', 'player', true),
  el('bar_health', 'status', 'Health bar', 'player'),
  el('bar_armor', 'status', 'Armor bar', 'player'),
  el('healthdamage', 'status', 'Health damage taken', 'player', true),
  el('armordamage', 'status', 'Armor damage taken', 'player', true),

  el('ammo', 'inventory', 'Ammo for the active weapon', 'player', true),
  el('iammo', 'inventory', 'Icon of the active ammo', 'player', true),
  ...AMMO_NAMES.map((a, i) => el(`ammo${i + 1}`, 'inventory', `Ammo: ${a}`, 'player', true)),
  ...AMMO_NAMES.map((a, i) => el(`iammo${i + 1}`, 'inventory', `Ammo icon: ${a}`, 'player', true)),

  el('gun', 'weapons', 'Active weapon', 'player', true),
  ...WEAPON_NAMES.map((w, i) => el(`gun${i + 2}`, 'weapons', `Weapon: ${w}`, 'player', true)),

  el('key1', 'items', 'Silver key', 'player', true),
  el('key2', 'items', 'Gold key', 'player', true),
  el('ring', 'items', 'Ring of shadows', 'player', true),
  el('pent', 'items', 'Pentagram of protection', 'player', true),
  el('suit', 'items', 'Biosuit', 'player', true),
  el('quad', 'items', 'Quad damage', 'player', true),
  ...range('sigil', 1, 4).map((n) => el(n, 'items', `Rune ${n.slice(-1)}`, 'player', true)),
  el('itemsclock', 'items', 'Item respawn timers', 'spectator'),

  el('clock', 'clocks', 'Local time'),
  el('gameclock', 'clocks', 'Match time'),
  el('democlock', 'clocks', 'Demo time', 'demo'),
  el('scoreclock', 'clocks', 'Date/time shown on the scoreboard', 'intermission'),

  el('frags', 'scores', 'Frags of all players'),
  el('teamfrags', 'scores', 'Team frags'),
  el('ownfrags', 'scores', 'Your last frag message'),
  el('score_team', 'scores', 'Your team score'),
  el('score_enemy', 'scores', 'Enemy team score'),
  el('score_difference', 'scores', 'Score difference'),
  el('score_position', 'scores', 'Your position'),
  el('score_bar', 'scores', 'Score bar (formatted)'),
  el('tracker', 'scores', 'Frag / death messages'),

  el('teaminfo', 'team', 'Teammate status overlay'),
  el('tracking', 'team', '"Tracking: player" message', 'spectator'),
  el('radar', 'team', 'Map radar with players', 'spectator'),
  el('gamesummary', 'team', 'Item pickup summary', 'demo'),
  el('teamholdbar', 'team', 'Team control bar', 'demo'),
  el('teamholdinfo', 'team', 'Team control of items', 'demo'),
  el('teamstackbar', 'team', 'Team stack bar', 'demo'),
  el('qtv_buffer', 'team', 'QTV / MVD buffer', 'demo'),
  el('static_text', 'team', 'Static text (demos only)', 'demo'),

  el('fps', 'network', 'Frames per second'),
  el('frametime', 'network', 'Frame time'),
  el('framestats', 'network', 'Frame statistics'),
  el('vidlag', 'network', 'Video lag'),
  el('ping', 'network', 'Ping and packet loss'),
  el('net', 'network', 'Network statistics'),
  el('netgraph', 'network', 'Network graph'),
  el('netproblem', 'network', 'Connection problem icon'),

  el('notify', 'misc', 'Chat / notify lines'),
  el('centerprint', 'misc', 'Centered server messages'),
  el('speed', 'misc', 'Speed bar'),
  el('speed2', 'misc', 'Speed gauge'),
  el('weaponstats', 'misc', 'Weapon accuracy'),
  el('keys', 'misc', 'Pressed movement keys'),

  ...range('group', 1, 9).map((n) => el(n, 'groups', `Group ${n.slice(-1)}: box/picture used as anchor or background`, 'always', true)),
]

export const ELEMENT_BY_NAME = new Map(ELEMENTS.map((e) => [e.name, e]))

// Longest names first so "score_team" wins over a hypothetical "score".
export const ELEMENT_NAMES_BY_LENGTH = ELEMENTS.map((e) => e.name).sort((a, b) => b.length - a.length)

export function isActiveIn(def: ElementDef, mode: ViewMode): boolean {
  switch (def.condition) {
    case 'always':
      return true
    case 'player':
      return true // a spectator tracking a player still sees these
    case 'spectator':
      return mode !== 'player'
    case 'demo':
      return mode === 'demo'
    case 'intermission':
      return false
  }
}
