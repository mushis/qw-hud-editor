import type { HudDoc, Params } from './cfg'
import generated from './ezquake-defaults.json'

// Default value of every HUD cvar, generated from ezQuake's HUD_Register calls
// (scripts/gen-hud-defaults.mjs).
export const EZQUAKE_DEFAULTS: Record<string, Params> = generated.elements
export const DEFAULTS_SOURCE: string = generated.source

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
