// Loading and saving whole HUDs. Every way in (import, presets, saved HUDs, drag and drop) goes through importCfg.
import { emptyDoc, lastValues, parseCfg, serializeCfg, type ClientSettings } from '../hud/cfg'
import { EZQUAKE_DEFAULTS } from '../hud/defaults'
import { groupPictures } from '../hud/pictures'
import { unusableResolution } from '../hud/issues'
import { useResolutionPrompt } from './resolutions'
import { importTextures, type PathFile } from '../render/textures'
import { useStore } from '../store'

const CLIENT_LABELS: Record<keyof ClientSettings, string> = {
  width: 'vid_width',
  height: 'vid_height',
  conscale: 'conscale',
  conwidth: 'conwidth',
  conheight: 'conheight',
  viewsize: 'viewsize',
}

// The charset and crosshair image a cfg names (loadcharset sets gl_consolefont, so whichever comes last wins),
// '' when it names none.
export function cfgPictures(text: string): { charset: string; crosshair: string } {
  const cvars = lastValues(text)
  const charsetCvar = Object.keys(cvars)
    .filter((k) => k === 'gl_consolefont' || k === 'loadcharset')
    .pop()
  return { charset: charsetCvar ? cvars[charsetCvar].trim() : '', crosshair: cvars.crosshairimage?.trim() ?? '' }
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
  const font = lastValues(text).font_facepath
  // A vid_width / vid_height the editor can't show (0 = the desktop resolution) is left out, and listed in Issues.
  const bad = unusableResolution(client)
  const usable = { ...client }
  if (bad) {
    delete usable.width
    delete usable.height
  }
  const { charset, crosshair } = cfgPictures(text)
  setSettings({
    conwidth: 0,
    conheight: 0,
    ...usable,
    cfgCharset: charset,
    cfgCrosshair: crosshair,
    cfgResolution: bad ? { width: client.width, height: client.height } : null,
    ...(font !== undefined && { fontFacepath: font.trim() }),
  })
  // 0 is the desktop resolution, which the editor can't know: the user is asked for theirs.
  if (client.width === 0 || client.height === 0) useResolutionPrompt.setState({ open: true })
  const set = Object.entries(usable).map(([k, v]) => `${CLIENT_LABELS[k as keyof ClientSettings]} ${v}`)
  const notes = [
    `${count} of ${Object.keys(EZQUAKE_DEFAULTS).length} elements set${count < Object.keys(EZQUAKE_DEFAULTS).length ? ', the rest at their defaults' : ''}`,
    set.length > 0 && `client settings: ${set.join(', ')}`,
    bad && 'its vid_width / vid_height not used (see Issues)',
    ignored > 0 && `${ignored} non-HUD lines ignored`,
    dropped.length > 0 && `${dropped.length} cvars ezQuake doesn't have dropped (${dropped.slice(0, 3).join(', ')}${dropped.length > 3 ? '…' : ''})`,
  ].filter(Boolean)
  return `Loaded ${name}: ${notes.join('; ')}.`
}

// Loads texture files (images, gfx.wad, zip/pk3, folders of them) and returns a summary.
export async function loadTextureFiles(files: PathFile[]): Promise<string> {
  const list = (items: string[]) => `${items.slice(0, 5).join(', ')}${items.length > 5 ? '…' : ''}`
  // The set is named after what was dropped or picked: a folder, a file, or "first +N".
  const tops = [...new Set(files.map((f) => f.path.split('/')[0]))]
  const label = tops.length === 1 ? tops[0] : `${tops[0]} +${tops.length - 1}`
  try {
    // From folders, besides the HUD pictures, only the pictures the HUD's groups show are taken.
    const { doc, settings } = useStore.getState()
    const { names, skipped, several } = await importTextures(files, label, groupPictures(doc), { charset: settings.cfgCharset, crosshair: settings.cfgCrosshair })
    const loaded = names.length
      ? `Loaded ${names.length} textures (${list(names)}). They are kept in this browser.`
      : 'No HUD textures found in those files: only the HUD pictures (num_0, face1, sb_shells…), a charset, a crosshair and the pictures your groups use are loaded.'
    const notes = [
      loaded,
      several.length > 0 &&
        `Found ${several.join(' and ')} and none is the one your config names (loadcharset, crosshairimage), so none of those was loaded: drop just the one you want (or pick a charset in Import setup).`,
      skipped.length > 0 && `Couldn't read ${skipped.length} files (${list(skipped)}).`,
    ]
    return notes.filter(Boolean).join(' ')
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
  setSettings({ conwidth: 0, conheight: 0, cfgResolution: null })
  return 'Loaded an empty HUD: every element hidden, every setting at its default.'
}

// The current HUD as a cfg; client settings are included when asked to (Export) or always (saved HUDs).
export function currentCfg(withClient: boolean): string {
  const { doc, settings } = useStore.getState()
  const { width, height, conscale, conwidth, conheight, viewsize } = settings
  return serializeCfg(doc, { date: new Date(), client: withClient ? { width, height, conscale, conwidth, conheight, viewsize } : undefined })
}
