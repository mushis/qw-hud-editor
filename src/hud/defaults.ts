import type { HudDoc, Params } from './cfg'
import generated from './ezquake-defaults.json'
import unezquake from './unezquake-defaults.json'

// Default value of every HUD cvar, generated from ezQuake's HUD_Register calls
// (scripts/gen-hud-defaults.mjs), plus the elements and settings only unezquake has.
export const EZQUAKE_DEFAULTS: Record<string, Params> = { ...generated.elements, ...unezquake.elements }
for (const [element, params] of Object.entries(unezquake.params)) {
  EZQUAKE_DEFAULTS[element] = { ...EZQUAKE_DEFAULTS[element], ...params }
}
export const DEFAULTS_SOURCE: string = generated.source
export const UNEZQUAKE_SOURCE: string = unezquake.source

// What only unezquake (dusty-qw/unezquake) draws: ezQuake ignores these cvars.
const UNEZQUAKE_ELEMENTS = new Set(Object.keys(unezquake.elements))
const UNEZQUAKE_PARAMS = new Set(Object.entries(unezquake.params).flatMap(([e, params]) => Object.keys(params).map((p) => `${e}.${p}`)))
export const isUnezquakeElement = (element: string) => UNEZQUAKE_ELEMENTS.has(element)
export const isUnezquakeParam = (element: string, param: string) => UNEZQUAKE_ELEMENTS.has(element) || UNEZQUAKE_PARAMS.has(`${element}.${param}`)

// What the client does when a cfg is exec'd on a fresh install: every cvar the
// cfg does not set keeps its built-in default. Cvars ezQuake doesn't register are dropped.
export function withDefaults(doc: HudDoc): HudDoc {
  const elements: Record<string, Params> = {}
  for (const [name, defaults] of Object.entries(EZQUAKE_DEFAULTS)) {
    const own = Object.entries(doc.elements[name] ?? {}).filter(([param]) => param in defaults)
    elements[name] = { ...defaults, ...Object.fromEntries(own) }
  }
  return { ...doc, elements }
}

export function defaultValue(element: string, param: string): string | undefined {
  return EZQUAKE_DEFAULTS[element]?.[param]
}
