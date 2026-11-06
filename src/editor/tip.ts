// Props for the editor's own tooltip (Tooltip.tsx), used instead of title where a tooltip is about HUD cvars:
// the cvar names come first, in bold, then the text.
export const tip = (cvar: string | undefined, text = '') => ({ 'data-tip': text, ...(cvar ? { 'data-cvar': cvar } : {}) })

// The cvar of an element's setting, e.g. hud_face_show; hud_face_* for all of them.
export const cvar = (element: string, param = '*') => `hud_${element}_${param}`
