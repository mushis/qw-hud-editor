import { useRef, useState } from 'react'
import logo from '../assets/brand/logo-64.png'
import type { ViewMode } from '../hud/catalog'
import { CUSTOM_BACKGROUND, saveCustomBackground, useCustomBackground, useTextures } from '../render/textures'
import { useStore, virtualSize } from '../store'
import { nextTheme, themeOf } from '../themes'
import { fetchSharedCfg, galleryEnabled, openedFromSignInLink, useGallery } from '../gallery/api'
import { MyHuds } from '../gallery/MyHuds'
import { ShareDialog } from '../gallery/ShareDialog'
import { About } from './About'
import { AssetsDialog } from './AssetsDialog'
import { ProportionalDialog } from './ProportionalDialog'
import { SetupDialog } from './SetupDialog'
import { currentCfg, importCfg, loadEmptyHud } from './actions'
import { readCfgFile } from './cfgFile'
import { downloadText, fetchPreset, PRESETS } from './io'

const RESOLUTIONS: [number, number][] = [
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
  [1920, 1200],
  [1680, 1050],
  [1600, 900],
  [1280, 720],
  [1280, 1024],
  [1024, 768],
  [2560, 1080],
  [3440, 1440],
]
const VIEWSIZES = [85, 90, 95, 99, 100, 110, 120]

// In-game screenshots to place the HUD on.
const BACKGROUNDS: [string, string][] = [
  ['vanilla.webp', 'vanilla'],
  ['grey.jpg', 'grey'],
  ['flat.jpg', 'flat'],
  ['peppe.jpg', 'peppe'],
]
// Map screenshots from vikpe/quake-mapshots, named by their file.
const MAPS = ['anwalked', 'aztec', 'bravado', 'dm2', 'dm4', 'dm6', 'e3m7', 'schloss', 'ztndm3']

const icon = (d: string[]) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {d.map((p) => (
      <path key={p} d={p} />
    ))}
  </svg>
)
const UNDO = icon(['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'])
const REDO = icon(['m15 14 5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'])
const PALETTE = (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 22a10 10 0 1 1 10-10c0 2.8-2.2 4-4.5 4H15a2 2 0 0 0-1.5 3.3A1.7 1.7 0 0 1 12 22z" />
    <circle cx="7.5" cy="10.5" r="1" fill="currentColor" />
    <circle cx="10.5" cy="6.5" r="1" fill="currentColor" />
    <circle cx="15.5" cy="7.5" r="1" fill="currentColor" />
  </svg>
)

export function Toolbar({ onMessage }: { onMessage: (m: string) => void }) {
  const settings = useStore((s) => s.settings)
  const preview = useStore((s) => s.preview)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const { setSettings, setPreview, undo, redo } = useStore.getState()
  const gallery = useGallery()
  const textureSets = useTextures((s) => s.sets)
  const customBackground = useCustomBackground((s) => s.url)
  const cfgInput = useRef<HTMLInputElement>(null)
  const bgInput = useRef<HTMLInputElement>(null)
  const [dialog, setDialog] = useState<null | 'about' | 'admin' | 'share' | 'mine' | 'setup' | 'proportional' | 'assets'>(openedFromSignInLink ? 'admin' : null)
  const [lastName, setLastName] = useState('')
  const close = () => setDialog(null)

  const load = (name: string, text: string) => {
    setLastName(name.replace(/\.(cfg|txt)$/i, ''))
    onMessage(importCfg(name, text))
  }

  const onHudMenu = async (value: string) => {
    if (value === 'empty') return onMessage(loadEmptyHud())
    if (value === 'share' || value === 'mine') return setDialog(value)
    const [kind, id] = [value.slice(0, value.indexOf(':')), value.slice(value.indexOf(':') + 1)]
    if (kind === 'preset') load(id, await fetchPreset(id))
    if (kind === 'shared') {
      const hud = gallery.huds.find((h) => h.id === id)
      if (!hud) return
      try {
        load(hud.name, await fetchSharedCfg(id))
      } catch (e) {
        onMessage(`Couldn't load "${hud.name}": ${(e as Error).message}`)
      }
    }
  }

  const { width: conW, height: conH } = virtualSize(settings)
  const auto = !settings.conwidth && !settings.conheight
  const resolution = `${settings.width}x${settings.height}`
  const resolutions = RESOLUTIONS.some(([w, h]) => `${w}x${h}` === resolution) ? RESOLUTIONS : [[settings.width, settings.height], ...RESOLUTIONS]
  // A loaded cfg may set any value (ezQuake takes 30 to 120); it is listed in order.
  const viewsizes = VIEWSIZES.includes(settings.viewsize) ? VIEWSIZES : [...VIEWSIZES, settings.viewsize].sort((a, b) => a - b)

  return (
    <header className="toolbar">
      <button className="brand" onClick={() => setDialog('about')} title="About">
        <img src={logo} alt="" width={28} height={28} />
        <strong>QW HUD Editor</strong>
      </button>

      <div className="group">
        <button onClick={() => cfgInput.current?.click()} title="Open a HUD or config file (you can also drop it on the page)">
          Import cfg
        </button>
        <input
          ref={cfgInput}
          type="file"
          accept=".cfg,.txt"
          hidden
          onChange={async (e) => {
            const file = e.target.files?.[0]
            e.target.value = ''
            const text = file && (await readCfgFile(file))
            if (file && typeof text === 'string') load(file.name, text)
          }}
        />
        <button
          onClick={() => downloadText('hud.cfg', currentCfg(settings.exportClient))}
          title={settings.exportClient ? 'Save the HUD and the settings as a cfg' : 'Save the HUD as a cfg'}
        >
          Export cfg
        </button>
        <select
          value=""
          onChange={(e) => onHudMenu(e.target.value)}
          onFocus={() => galleryEnabled && gallery.refresh()}
          title="Load a preset or a shared HUD, or share the current one"
        >
          <option value="">Load / save HUD…</option>
          <optgroup label="Presets">
            <option value="empty">empty (everything hidden)</option>
            {PRESETS.map((p) => (
              <option key={p.id} value={`preset:${p.id}`}>
                {p.id}
              </option>
            ))}
          </optgroup>
          {galleryEnabled && (
            <optgroup label="Shared HUDs">
              {gallery.huds.map((h) => (
                <option key={h.id} value={`shared:${h.id}`}>
                  {h.name} — {h.author}
                  {gallery.mine.has(h.id) ? ' ★' : ''}
                </option>
              ))}
              {gallery.status === 'loading' && <option disabled>Loading…</option>}
              {gallery.status === 'error' && <option disabled>Couldn't reach the gallery</option>}
              {gallery.status === 'ok' && !gallery.huds.length && <option disabled>Nothing shared yet</option>}
              <option value="share">Share current HUD…</option>
              <option value="mine">My shared HUDs…</option>
            </optgroup>
          )}
        </select>
      </div>

      <fieldset className="group client" title="Game settings that change the whole HUD, not one element">
        <legend>Settings</legend>
        <select
          value={resolution}
          title="Game resolution (vid_width × vid_height)"
          onChange={(e) => {
            const [width, height] = e.target.value.split('x').map(Number)
            setSettings({ width, height })
          }}
        >
          {resolutions.map(([w, h]) => (
            <option key={`${w}x${h}`} value={`${w}x${h}`}>
              {w}×{h}
            </option>
          ))}
        </select>
        <label title="Divides the resolution to get the HUD's virtual size: 1920×1080 at conscale 2 is 960×540. Higher means fewer virtual pixels, so everything looks bigger. Only used while con W × H is on auto.">
          conscale
          <input
            type="number"
            min={0.5}
            max={8}
            step={0.25}
            disabled={!auto}
            value={settings.conscale}
            onChange={(e) => setSettings({ conscale: Math.max(0.5, parseFloat(e.target.value) || 2) })}
          />
        </label>
        <label title="Sets the HUD's virtual size directly (vid_conwidth × vid_conheight) and overrides conscale. If its proportions differ from the resolution's, the game stretches the HUD. Grey numbers show the size conscale gives right now.">
          con
          <input
            type="number"
            min={0}
            step={10}
            value={settings.conwidth || ''}
            placeholder={String(conW)}
            onChange={(e) => setSettings({ conwidth: Math.max(0, parseInt(e.target.value, 10) || 0) })}
          />
          ×
          <input
            type="number"
            min={0}
            step={10}
            value={settings.conheight || ''}
            placeholder={String(conH)}
            onChange={(e) => setSettings({ conheight: Math.max(0, parseInt(e.target.value, 10) || 0) })}
          />
          {!auto && (
            <button title="Clears con W × H so the virtual size comes from the resolution and conscale again." onClick={() => setSettings({ conwidth: 0, conheight: 0 })}>
              auto
            </button>
          )}
        </label>
        <label title="viewsize: below 100 the 3D view shrinks (the view place shrinks with it); 100, 110 and 120 set the status bar height used by the sbar/ibar/hbar places">
          viewsize
          <select value={settings.viewsize} onChange={(e) => setSettings({ viewsize: Number(e.target.value) })}>
            {viewsizes.map((v) => (
              <option key={v} value={v}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label title="Also write these settings (vid_width, vid_height, vid_conscale, vid_conwidth, vid_conheight, viewsize) when exporting">
          <input type="checkbox" checked={settings.exportClient} onChange={(e) => setSettings({ exportClient: e.target.checked })} />
          export
        </label>
      </fieldset>

      <div className="group">
        <label>
          View as
          <select value={preview.mode} onChange={(e) => setPreview({ mode: e.target.value as ViewMode })}>
            <option value="player">Player</option>
            <option value="spectator">Spectator</option>
            <option value="demo">Demo / MVD</option>
          </select>
        </label>
        <label title="Also show elements that would not be visible in this view">
          <input type="checkbox" checked={settings.showInactive} onChange={(e) => setSettings({ showInactive: e.target.checked })} />
          show hidden-in-view
        </label>
      </div>

      <fieldset className="group client" title="How the HUD looks in the editor: your Quake setup, background, text font and textures">
        <legend>HUD editor appearance</legend>
        <button
          onClick={() => setDialog('setup')}
          title="Choose your Quake folder (or a folder of HUD pictures): imports ezquake/configs/config.cfg with its charset, crosshair and HUD pictures"
        >
          Import setup
        </button>
        <select
          value={settings.background}
          onChange={(e) => (e.target.value === 'upload' ? bgInput.current?.click() : setSettings({ background: e.target.value }))}
        >
          {BACKGROUNDS.map(([file, name]) => (
            <option key={file} value={`assets/backgrounds/${file}`}>
              Background: {name}
            </option>
          ))}
          <optgroup label="Maps">
            {MAPS.map((name) => (
              <option key={name} value={`assets/backgrounds/maps/${name}.webp`}>
                Background: {name}
              </option>
            ))}
          </optgroup>
          <option value="">Background: none</option>
          {customBackground && <option value={CUSTOM_BACKGROUND}>Background: uploaded</option>}
          <option value="upload">Upload background…</option>
        </select>
        <input
          ref={bgInput}
          type="file"
          accept="image/*"
          hidden
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (!file) return
            e.target.value = ''
            saveCustomBackground(file).then(() => setSettings({ background: CUSTOM_BACKGROUND }))
          }}
        />
        <button onClick={() => setDialog('proportional')} title="Set proportional (TTF font text) on every element at once, and load the font">
          Proportional…
        </button>
        <button
          onClick={() => setDialog('assets')}
          title={textureSets.length ? 'See the loaded textures, charset and crosshair, add more or delete them' : 'Load your own HUD pictures, charset or wad'}
        >
          {textureSets.length ? `Assets (${textureSets.reduce((n, set) => n + set.names.length, 0)})…` : 'Assets…'}
        </button>
      </fieldset>

      <div className="group end">
        <button className="icon" disabled={!canUndo} onClick={undo} title="Undo (Ctrl+Z)" aria-label="Undo">
          {UNDO}
        </button>
        <button className="icon" disabled={!canRedo} onClick={redo} title="Redo (Ctrl+Y)" aria-label="Redo">
          {REDO}
        </button>
        <button className="icon help" onClick={() => setDialog('about')} title="About and help" aria-label="About and help">
          ?
        </button>
        <button
          className="icon theme"
          onClick={() => setSettings({ theme: nextTheme(settings.theme) })}
          title={`Theme: ${themeOf(settings.theme).name}. Click for the next one (${themeOf(nextTheme(settings.theme)).name}).`}
          aria-label="Change theme"
        >
          {PALETTE}
        </button>
      </div>
      {(dialog === 'about' || dialog === 'admin') && <About admin={dialog === 'admin'} onClose={close} />}
      {dialog === 'share' && <ShareDialog initialName={lastName} onClose={close} onMessage={onMessage} />}
      {dialog === 'mine' && <MyHuds onClose={close} onMessage={onMessage} />}
      {dialog === 'setup' && <SetupDialog onClose={close} onMessage={onMessage} />}
      {dialog === 'proportional' && <ProportionalDialog onClose={close} onMessage={onMessage} />}
      {dialog === 'assets' && <AssetsDialog onClose={close} onMessage={onMessage} />}
    </header>
  )
}
