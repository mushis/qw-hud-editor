import { useRef, useState } from 'react'
import logo from '../assets/brand/logo-64.png'
import type { ViewMode } from '../hud/catalog'
import { clearTextures, useTextures } from '../render/textures'
import { useStore, virtualSize } from '../store'
import { fetchSharedCfg, galleryEnabled, openedFromSignInLink, useGallery } from '../gallery/api'
import { MyHuds } from '../gallery/MyHuds'
import { ShareDialog } from '../gallery/ShareDialog'
import { About } from './About'
import { currentCfg, importCfg, loadEmptyHud, loadTextureFiles } from './actions'
import { downloadText, fetchPreset, PRESETS, readFileText } from './io'

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
const VIEWSIZES = [100, 110, 120]

const icon = (d: string[]) => (
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    {d.map((p) => (
      <path key={p} d={p} />
    ))}
  </svg>
)
const UNDO = icon(['M9 14 4 9l5-5', 'M4 9h10.5a5.5 5.5 0 0 1 0 11H11'])
const REDO = icon(['m15 14 5-5-5-5', 'M20 9H9.5a5.5 5.5 0 0 0 0 11H13'])

export function Toolbar({ onMessage }: { onMessage: (m: string) => void }) {
  const settings = useStore((s) => s.settings)
  const preview = useStore((s) => s.preview)
  const canUndo = useStore((s) => s.past.length > 0)
  const canRedo = useStore((s) => s.future.length > 0)
  const { setSettings, setPreview, undo, redo } = useStore.getState()
  const gallery = useGallery()
  const textureCount = useTextures((s) => Object.keys(s.textures).length)
  const cfgInput = useRef<HTMLInputElement>(null)
  const bgInput = useRef<HTMLInputElement>(null)
  const texInput = useRef<HTMLInputElement>(null)
  const [dialog, setDialog] = useState<null | 'about' | 'admin' | 'share' | 'mine'>(openedFromSignInLink ? 'admin' : null)
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
  const viewsizes = VIEWSIZES.includes(settings.viewsize) ? VIEWSIZES : [settings.viewsize, ...VIEWSIZES]

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
            if (file) load(file.name, await readFileText(file))
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
        <label title="vid_conscale: the HUD is drawn at resolution / conscale (when conwidth/conheight are 0)">
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
        <label title="vid_conwidth × vid_conheight: the virtual HUD size. Empty = derived from conscale.">
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
            <button title="Back to conscale" onClick={() => setSettings({ conwidth: 0, conheight: 0 })}>
              auto
            </button>
          )}
        </label>
        <label title="viewsize sets the status bar height used by the sbar/ibar/hbar places">
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

      <div className="group">
        <select
          value={settings.background.startsWith('data:') ? 'custom' : settings.background}
          onChange={(e) => (e.target.value === 'upload' ? bgInput.current?.click() : setSettings({ background: e.target.value }))}
        >
          <option value="assets/backgrounds/default.webp">Background: screenshot</option>
          <option value="">Background: none</option>
          {settings.background.startsWith('data:') && <option value="custom">Background: custom</option>}
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
            const reader = new FileReader()
            reader.onload = () => setSettings({ background: String(reader.result) })
            reader.readAsDataURL(file)
          }}
        />
        <button
          onClick={() => texInput.current?.click()}
          title="Load custom HUD textures: images (num_0.png, sb_shells.tga…), gfx.wad, or a zip/pk3. You can also drop them on the page."
        >
          Textures…
        </button>
        <input
          ref={texInput}
          type="file"
          multiple
          accept=".png,.tga,.jpg,.jpeg,.webp,.wad,.zip,.pk3"
          hidden
          onChange={(e) => {
            const files = [...(e.target.files ?? [])]
            e.target.value = ''
            if (files.length) loadTextureFiles(files).then(onMessage)
          }}
        />
        {textureCount > 0 && (
          <button
            title="Remove all custom textures and go back to the nQuake ones"
            onClick={() => {
              if (!window.confirm(`Remove all ${textureCount} custom textures?`)) return
              clearTextures()
              onMessage('Custom textures removed.')
            }}
          >
            {textureCount} custom ✕
          </button>
        )}
      </div>

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
      </div>
      {(dialog === 'about' || dialog === 'admin') && <About admin={dialog === 'admin'} onClose={close} />}
      {dialog === 'share' && <ShareDialog initialName={lastName} onClose={close} onMessage={onMessage} />}
      {dialog === 'mine' && <MyHuds onClose={close} onMessage={onMessage} />}
    </header>
  )
}
