// Colour themes for the editor UI (not the HUD). Colours live in index.css under :root[data-theme].
export const THEMES = [
  { id: 'rust', name: 'Rust' },
  { id: 'slime', name: 'Slime' },
  { id: 'lava', name: 'Lava' },
  { id: 'teleport', name: 'Teleport' },
  { id: 'daylight', name: 'Daylight' },
] as const

export type ThemeId = (typeof THEMES)[number]['id']

export const themeOf = (id: string) => THEMES.find((t) => t.id === id) ?? THEMES[0]

export const nextTheme = (id: string): ThemeId => THEMES[(THEMES.indexOf(themeOf(id)) + 1) % THEMES.length].id
