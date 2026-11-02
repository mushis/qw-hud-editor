import { ELEMENT_NAMES_BY_LENGTH } from './catalog'
import { EZQUAKE_DEFAULTS } from './defaults'

export type Params = Record<string, string>

export interface HudDoc {
  // element name -> param name -> raw cvar value
  elements: Record<string, Params>
  // hud-wide cvars that do not belong to an element (hud_planmode, hud_digits_trim, scr_newhud...)
  globals: Record<string, string>
}

export function emptyDoc(): HudDoc {
  return { elements: {}, globals: {} }
}

// Every element has these, so they reveal elements of other client versions (mp3_title, mouserate...).
// Those, and cvars a current element doesn't register (hud_group1_tile...), are dropped on import.
const COMMON_PARAMS = ['show', 'place', 'order', 'align_x', 'align_y', 'pos_x', 'pos_y', 'frame', 'frame_color', 'item_opacity', 'draw']
const COMMON_RE = new RegExp(`^hud_(.+)_(${COMMON_PARAMS.join('|')})$`)

// "hud_score_team_colorize" -> { element: "score_team", param: "colorize" }
// `names` must be sorted longest first so "score_team" wins over a shorter prefix.
export function splitCvar(cvar: string, names: string[] = ELEMENT_NAMES_BY_LENGTH): { element: string; param: string } | null {
  if (!cvar.startsWith('hud_')) return null
  const rest = cvar.slice(4)
  for (const name of names) {
    if (rest.startsWith(name + '_') && rest.length > name.length + 1) {
      return { element: name, param: rest.slice(name.length + 1) }
    }
  }
  return null
}

// Splits a cfg line into tokens the way the Quake command parser does:
// quoted strings, bare words, "//" comments, ";" command separators.
function tokenizeCommands(text: string): string[][] {
  const commands: string[][] = []
  let tokens: string[] = []
  let i = 0
  const flush = () => {
    if (tokens.length) commands.push(tokens)
    tokens = []
  }
  while (i < text.length) {
    const c = text[i]
    if (c === '\n' || c === ';') {
      flush()
      i++
    } else if (c === ' ' || c === '\t' || c === '\r') {
      i++
    } else if (c === '/' && text[i + 1] === '/') {
      while (i < text.length && text[i] !== '\n') i++
    } else if (c === '"') {
      const end = text.indexOf('"', i + 1)
      const lineEnd = text.indexOf('\n', i + 1)
      const stop = end === -1 || (lineEnd !== -1 && lineEnd < end) ? (lineEnd === -1 ? text.length : lineEnd) : end
      tokens.push(text.slice(i + 1, stop))
      i = stop === end ? end + 1 : stop
    } else {
      let j = i
      while (j < text.length && !' \t\r\n;"'.includes(text[j]) && !(text[j] === '/' && text[j + 1] === '/')) j++
      tokens.push(text.slice(i, j))
      i = j
    }
  }
  flush()
  return commands
}

// Client cvars that change the whole HUD. Not HUD cvars, but a cfg may carry them.
export interface ClientSettings {
  width: number // vid_width
  height: number // vid_height
  conscale: number // vid_conscale
  conwidth: number // vid_conwidth; 0 = derived from conscale
  conheight: number // vid_conheight
  viewsize: number
}

const CLIENT_CVARS: [keyof ClientSettings, string][] = [
  ['width', 'vid_width'],
  ['height', 'vid_height'],
  ['conscale', 'vid_conscale'],
  ['conwidth', 'vid_conwidth'],
  ['conheight', 'vid_conheight'],
  ['viewsize', 'viewsize'],
]

export interface ParseResult {
  doc: HudDoc
  ignored: number // non-HUD commands dropped
  dropped: string[] // HUD cvars ezQuake doesn't register (other client versions)
  client: Partial<ClientSettings> // the client cvars the cfg sets
}

// Keeps only HUD cvars; everything else in the cfg is dropped.
export function parseCfg(text: string): ParseResult {
  const commands = tokenizeCommands(text).map((tokens) => (/^(set|seta|setu)$/i.test(tokens[0]) ? tokens.slice(1) : tokens))

  const unknown = new Set<string>()
  for (const [name] of commands) {
    const m = name?.toLowerCase().match(COMMON_RE)
    if (m && !splitCvar(name.toLowerCase())) unknown.add(m[1])
  }
  const names = [...ELEMENT_NAMES_BY_LENGTH, ...unknown].sort((a, b) => b.length - a.length)

  const result: ParseResult = { doc: emptyDoc(), ignored: 0, dropped: [], client: {} }
  for (const [name, value] of commands) {
    if (!name || value === undefined) {
      if (name && name !== 'hud_recalculate') result.ignored++
      continue
    }
    const key = name.toLowerCase()
    const split = splitCvar(key, names)
    const client = CLIENT_CVARS.find(([, cvar]) => cvar === key)
    const n = parseFloat(value)
    if (split && EZQUAKE_DEFAULTS[split.element] && split.param in EZQUAKE_DEFAULTS[split.element]) {
      ;(result.doc.elements[split.element] ??= {})[split.param] = value
    } else if (split) {
      result.dropped.push(key)
    } else if (key.startsWith('hud_') || key === 'scr_newhud') {
      result.doc.globals[key] = value
    } else if (client && Number.isFinite(n) && n >= 0) {
      result.client[client[0]] = client[0] === 'viewsize' ? Math.min(120, Math.max(30, n)) : n // SCR_CalcRefdef bounds viewsize
    } else {
      result.ignored++
    }
  }
  return result
}

// The last value the cfg gives each command or cvar (lower-case name), e.g. loadcharset, crosshairimage.
// Keys are in the order of their last line, so of two that set the same thing the later one can be told apart.
export function lastValues(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const tokens of tokenizeCommands(text)) {
    const [name, value] = /^(set|seta|setu)$/i.test(tokens[0]) ? tokens.slice(1) : tokens
    if (!name || value === undefined) continue
    delete out[name.toLowerCase()]
    out[name.toLowerCase()] = value
  }
  return out
}

const PAD = 36

const pad2 = (n: number) => String(n).padStart(2, '0')
const stamp = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`

export interface SerializeOptions {
  date?: Date // written in the header
  client?: ClientSettings // also write the client cvars
}

// Same layout as ezQuake's DumpHUD: header, sorted padded cvars, hud_recalculate.
export function serializeCfg(doc: HudDoc, { date, client }: SerializeOptions = {}): string {
  const lines: [string, string][] = []
  for (const [element, params] of Object.entries(doc.elements)) {
    for (const [param, value] of Object.entries(params)) lines.push([`hud_${element}_${param}`, value])
  }
  const globals = { scr_newhud: '1', ...doc.globals }
  const newhud = globals.scr_newhud
  delete (globals as Record<string, string>).scr_newhud
  for (const [k, v] of Object.entries(globals)) lines.push([k, v])
  lines.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))

  const fmt = (k: string, v: string) => `${k.padEnd(PAD - 1)} "${v}"`
  return [
    '//',
    '// Head Up Display Configuration Dump',
    `// Generated by QuakeWorld HUD Editor${date ? ` on ${stamp(date)}` : ''}`,
    '//',
    '',
    ...(client
      ? [
          '// Client settings (vid_width / vid_height take effect after vid_restart)',
          ...CLIENT_CVARS.map(([k, cvar]) => fmt(cvar, String(client[k]))),
          '',
        ]
      : []),
    fmt('scr_newhud', newhud),
    ...lines.map(([k, v]) => fmt(k, v)),
    'hud_recalculate',
    '',
  ].join('\n')
}
