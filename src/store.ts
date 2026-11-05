import { create } from 'zustand'
import type { ClientSettings, HudDoc } from './hud/cfg'
import { emptyDoc } from './hud/cfg'
import { withDefaults } from './hud/defaults'
import { DEFAULT_PREVIEW, type Preview } from './hud/preview'
import { DEFAULT_CROSSHAIR, type Crosshair } from './render/crosshair'
import type { ThemeId } from './themes'

// Client settings (resolution, conscale, conwidth/conheight, viewsize) plus editor preferences.
export interface Settings extends ClientSettings {
  exportClient: boolean // also write the client settings when exporting
  background: string // url, '' for none
  showInactive: boolean // draw elements that would not show in the current view mode
  zoom: number // 1 = fit the window, 2 and 4 = magnified (scrollable)
  theme: ThemeId // editor colours
  crosshair: Crosshair // the crosshair cvars, from Import setup
  paletteTree: boolean // element list by place (who is placed on whom) instead of by category
  fontFacepath: string // font_facepath from the last cfg that set it: the TTF proportional text uses
  showGroups: boolean // outline the groups on the stage, with the elements placed on them
  paletteCollapsed: boolean // element list folded to a thin strip
  cfgResolution: { width?: number; height?: number } | null // vid_width / vid_height from the last cfg when unusable (e.g. 0), so not applied
  cfgCharset: string // loadcharset / gl_consolefont of the last cfg ('' when it sets none): picks the charset file to load
  cfgCrosshair: string // crosshairimage of the last cfg ('' when it sets none): picks the crosshair file to load
}

export const DEFAULT_SETTINGS: Settings = {
  width: 1920,
  height: 1080,
  conscale: 2,
  conwidth: 0,
  conheight: 0,
  viewsize: 100,
  exportClient: false,
  background: 'assets/backgrounds/vanilla.webp',
  showInactive: false,
  zoom: 1,
  theme: 'rust',
  crosshair: DEFAULT_CROSSHAIR,
  paletteTree: false,
  fontFacepath: '',
  showGroups: false,
  paletteCollapsed: false,
  cfgResolution: null,
  cfgCharset: '',
  cfgCrosshair: '',
}

const HISTORY_LIMIT = 200
const STORAGE_KEY = 'qw-hud-editor:v1'

interface State {
  doc: HudDoc
  selected: string | null
  hovered: string | null // under the pointer, on the stage or in the element list
  preview: Preview
  settings: Settings
  past: HudDoc[]
  future: HudDoc[]

  // Loads a parsed cfg; cvars it does not set get their ezQuake defaults.
  loadDoc(doc: HudDoc): void
  select(name: string | null): void
  hover(name: string | null): void
  // Pushes the current doc onto the undo stack; call once before a group of live edits (e.g. a drag).
  checkpoint(): void
  // Edits without touching history (use after checkpoint()).
  setParams(element: string, values: Record<string, string>): void
  // Single undoable edit.
  editParams(element: string, values: Record<string, string>): void
  // Several elements at once, without touching history (use after checkpoint()).
  setMany(changes: Record<string, Record<string, string>>): void
  // Several elements as one undoable edit.
  editMany(changes: Record<string, Record<string, string>>): void
  undo(): void
  redo(): void
  setPreview(p: Partial<Preview>): void
  setSettings(s: Partial<Settings>): void
}

function loadSaved(): Partial<Pick<State, 'doc' | 'settings' | 'preview'>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

const saved = loadSaved()

// The first background was saved as default.webp before it was renamed.
function migrateSettings(s: Settings): Settings {
  return s.background === 'assets/backgrounds/default.webp' ? { ...s, background: DEFAULT_SETTINGS.background } : s
}

export const useStore = create<State>((set, get) => ({
  doc: saved.doc ? withDefaults(saved.doc) : emptyDoc(),
  selected: null,
  hovered: null,
  // The view mode always starts as player.
  preview: { ...DEFAULT_PREVIEW, ...saved.preview, mode: DEFAULT_PREVIEW.mode },
  settings: migrateSettings({ ...DEFAULT_SETTINGS, ...saved.settings }),
  past: [],
  future: [],

  loadDoc(doc) {
    get().checkpoint()
    set({ doc: withDefaults(doc), selected: null })
  },
  select(selected) {
    set({ selected })
  },
  hover(hovered) {
    if (get().hovered !== hovered) set({ hovered })
  },
  checkpoint() {
    const { doc, past } = get()
    set({ past: [...past.slice(-HISTORY_LIMIT + 1), doc], future: [] })
  },
  setParams(element, values) {
    const { doc } = get()
    set({
      doc: { ...doc, elements: { ...doc.elements, [element]: { ...doc.elements[element], ...values } } },
    })
  },
  editParams(element, values) {
    get().checkpoint()
    get().setParams(element, values)
  },
  setMany(changes) {
    const { doc } = get()
    const elements = { ...doc.elements }
    for (const [element, values] of Object.entries(changes)) elements[element] = { ...elements[element], ...values }
    set({ doc: { ...doc, elements } })
  },
  editMany(changes) {
    get().checkpoint()
    get().setMany(changes)
  },
  undo() {
    const { past, future, doc } = get()
    if (!past.length) return
    set({ doc: past[past.length - 1], past: past.slice(0, -1), future: [doc, ...future] })
  },
  redo() {
    const { past, future, doc } = get()
    if (!future.length) return
    set({ doc: future[0], future: future.slice(1), past: [...past, doc] })
  },
  setPreview(p) {
    set({ preview: { ...get().preview, ...p } })
  },
  setSettings(s) {
    set({ settings: { ...get().settings, ...s } })
  },
}))

export const hasSavedDoc = () => saved.doc !== undefined

useStore.subscribe((s) => {
  try {
    const settings = s.settings
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ doc: s.doc, settings, preview: s.preview }))
  } catch {
    // storage unavailable or full: editing still works, it just isn't remembered
  }
})

// Virtual HUD size the way ezQuake derives vid.conwidth/conheight (vid_sdl2.c).
export function virtualSize(s: Settings): { width: number; height: number } {
  let w = s.conwidth
  let h = s.conheight
  if (!w && !h) {
    w = s.width / s.conscale
    h = s.height / s.conscale
  } else if (!w) {
    w = (h * s.width) / s.height
  } else if (!h) {
    h = (w * s.height) / s.width
  }
  return {
    width: Math.round(Math.min(s.width, Math.max(320, w))),
    height: Math.round(Math.min(s.height, Math.max(200, h))),
  }
}
