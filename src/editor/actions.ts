// Loading and saving whole HUDs. Every way in (import, presets, saved HUDs, drag and drop) goes through importCfg.
import { emptyDoc, parseCfg, serializeCfg, type ClientSettings } from '../hud/cfg'
import { EZQUAKE_DEFAULTS } from '../hud/defaults'
import { importTextures } from '../render/textures'
import { useStore } from '../store'

const CLIENT_LABELS: Record<keyof ClientSettings, string> = {
  width: 'vid_width',
  height: 'vid_height',
  conscale: 'conscale',
  conwidth: 'conwidth',
  conheight: 'conheight',
  viewsize: 'viewsize',
}

// Loads a cfg like exec'ing it on a fresh client: cvars it doesn't set get their ezQuake defaults.
// vid_conwidth/conheight belong to the HUD they came with, so they go back to auto when the cfg doesn't set them.
// Returns a one-line summary for a toast.
export function importCfg(name: string, text: string): string {
  const { doc, ignored, dropped, client } = parseCfg(text)
  const count = Object.keys(doc.elements).length
  if (!count) return `${name}: no HUD settings found.`
  const { loadDoc, setSettings } = useStore.getState()
  loadDoc(doc)
  setSettings({ conwidth: 0, conheight: 0, ...client })
  const set = Object.entries(client).map(([k, v]) => `${CLIENT_LABELS[k as keyof ClientSettings]} ${v}`)
  const notes = [
    `${count} of ${Object.keys(EZQUAKE_DEFAULTS).length} elements set${count < Object.keys(EZQUAKE_DEFAULTS).length ? ', the rest at their defaults' : ''}`,
    set.length > 0 && `client settings: ${set.join(', ')}`,
    ignored > 0 && `${ignored} non-HUD lines ignored`,
    dropped.length > 0 && `${dropped.length} cvars ezQuake doesn't have dropped (${dropped.slice(0, 3).join(', ')}${dropped.length > 3 ? '…' : ''})`,
  ].filter(Boolean)
  return `Loaded ${name}: ${notes.join('; ')}.`
}

// Loads texture files (images, gfx.wad, zip/pk3) and returns a summary.
export async function loadTextureFiles(files: File[]): Promise<string> {
  try {
    const names = await importTextures(files)
    return names.length
      ? `Loaded ${names.length} textures (${names.slice(0, 5).join(', ')}${names.length > 5 ? '…' : ''}). They are kept in this browser.`
      : 'No HUD textures found in those files.'
  } catch (e) {
    return `Couldn't read textures: ${(e as Error).message}`
  }
}

// Every element hidden, every setting at its ezQuake default.
export function loadEmptyHud(): string {
  const { loadDoc, setSettings } = useStore.getState()
  const doc = emptyDoc()
  for (const name of Object.keys(EZQUAKE_DEFAULTS)) doc.elements[name] = { show: '0' }
  loadDoc(doc)
  setSettings({ conwidth: 0, conheight: 0 })
  return 'Loaded an empty HUD: every element hidden, every setting at its default.'
}

// The current HUD as a cfg; client settings are included when asked to (Export) or always (saved HUDs).
export function currentCfg(withClient: boolean): string {
  const { doc, settings } = useStore.getState()
  const { width, height, conscale, conwidth, conheight, viewsize } = settings
  return serializeCfg(doc, { date: new Date(), client: withClient ? { width, height, conscale, conwidth, conheight, viewsize } : undefined })
}
