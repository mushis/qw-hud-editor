import { useState } from 'react'
import { useStore } from '../store'
import { exportSetup, invalidName, setupFiles } from './exportSetup'
import { downloadBlob } from './io'
import { Modal } from './Modal'

const NAME_KEY = 'qw-hud-editor:setup-name'

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

// Explains what Export setup writes and where it goes, asks for a name, then downloads the zip.
export function ExportSetupDialog({ onClose, onMessage }: { onClose: () => void; onMessage: (m: string) => void }) {
  const exportClient = useStore((s) => s.settings.exportClient)
  const setSettings = useStore((s) => s.setSettings)
  const [name, setName] = useState(() => {
    try {
      return localStorage.getItem(NAME_KEY) ?? ''
    } catch {
      return ''
    }
  })
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string[] | null>(null)
  const [error, setError] = useState('')

  const problem = invalidName(name.trim())
  const shown = name.trim() && !problem ? name.trim() : 'myhud'
  const { files, unused } = setupFiles(shown)
  const pictures = files.filter((f) => f.url)
  const byWhat = (what: string) => pictures.filter((f) => f.what === what).length
  // The folders the zip writes pictures into: the ones to back up.
  const folders = [...new Set(pictures.map((f) => f.path.slice(0, f.path.lastIndexOf('/'))))]

  const run = async () => {
    if (problem) return
    setBusy(true)
    setError('')
    try {
      const { blob, paths } = await exportSetup(name.trim())
      downloadBlob(`${name.trim()}.zip`, blob)
      try {
        localStorage.setItem(NAME_KEY, name.trim())
      } catch {
        // not remembered
      }
      setDone(paths)
      onMessage(`Exported ${name.trim()}.zip: ${count(paths.length, 'file')}.`)
    } catch (e) {
      setError(`Couldn't export: ${(e as Error).message}`)
    }
    setBusy(false)
  }

  if (done) {
    return (
      <Modal label="Export setup" onClose={onClose} wide>
        <h2>Export setup</h2>
        <p className="setup-success">✓ Saved {name.trim()}.zip</p>
        <ul className="setup-result">
          {done.map((p) => (
            <li key={p} className="mono">
              qw/{p}
            </li>
          ))}
        </ul>
        <p>
          Extract it into your <code>qw</code> folder, then in ezQuake's console type <code>exec {name.trim()}.cfg</code>.
        </p>
        <div className="setup-actions">
          <button className="primary" autoFocus onClick={onClose}>
            Close
          </button>
        </div>
      </Modal>
    )
  }

  return (
    <Modal label="Export setup" onClose={onClose} wide>
      <h2>Export setup</h2>
      <p>Saves a zip with your HUD and the pictures the editor shows now, in the folders ezQuake reads them from:</p>
      <ul className="export-list">
        <li>
          <code>{shown}.cfg</code>: every HUD setting
          {exportClient && ', the resolution and virtual size'}
          {files[0].text?.includes('loadcharset') && ', loadcharset'}
          {files[0].text?.includes('crosshairimage') && ', crosshairimage'}
          {files[0].text?.includes('crosshairsize') && ', the crosshair settings'}
          {files[0].text?.includes('font_facepath') && ', font_facepath'}
        </li>
        {byWhat('HUD picture') > 0 && (
          <li>
            <code>textures/wad/</code>: {count(byWhat('HUD picture'), 'HUD picture')} (num_0, face1…)
          </li>
        )}
        {byWhat('charset') > 0 && (
          <li>
            <code>textures/charsets/{shown}.png</code>: the charset
          </li>
        )}
        {byWhat('crosshair') > 0 && (
          <li>
            <code>crosshairs/{shown}.png</code>: the crosshair image
          </li>
        )}
        {byWhat('group picture') > 0 && (
          <li>
            <code>gfx/</code>: {count(byWhat('group picture'), 'group picture')}
          </li>
        )}
      </ul>
      {!pictures.length && (
        <p className="dim">No pictures of your own are loaded, so the zip only holds the cfg. Import setup or Assets loads them.</p>
      )}
      {unused > 0 && (
        <p className="dim">
          {unused === 1 ? '1 loaded picture is left out: no HUD element or group uses it.' : `${unused} loaded pictures are left out: no HUD element or group uses them.`}
        </p>
      )}

      <label className="export-name">
        Name
        <input
          autoFocus
          value={name}
          placeholder="e.g. myhud"
          maxLength={32}
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && run()}
        />
        <span className="dim">.cfg</span>
      </label>
      <p className={name && problem ? 'hint warn' : 'hint'}>
        {name && problem
          ? problem
          : 'A name of its own, so the cfg (and the charset and crosshair files) don\u2019t replace ones you already have, like config.cfg.'}
      </p>
      <label className="export-check">
        <input type="checkbox" checked={exportClient} onChange={(e) => setSettings({ exportClient: e.target.checked })} />
        Include the resolution and virtual size (vid_width, vid_height, vid_conscale, vid_conwidth, vid_conheight, viewsize)
      </label>

      <div className="export-note">
        <p>
          <strong>Where it goes:</strong> extract the zip into your Quake folder's <code>qw</code> folder (for example{' '}
          <code>C:\Games\nQuake\qw</code>), letting it replace files. Then in ezQuake's console: <code>exec {shown}.cfg</code>.
        </p>
        {folders.length > 0 && (
          <p>
            <strong>Back up first</strong> {folders.map((f, i) => [i ? ', ' : '', <code key={f}>qw/{f}</code>])}, then move the
            pictures with the same names out of them: ezQuake prefers a <code>.tga</code> over the <code>.png</code> in the zip, so an old one would
            still show. Pictures inside a <code>.pk3</code> in <code>qw</code> win over loose files too.
          </p>
        )}
      </div>
      {error && <p className="hint warn">{error}</p>}
      <div className="setup-actions">
        <button onClick={onClose}>Cancel</button>
        <button className="primary" disabled={!!problem || busy} onClick={run}>
          {busy ? 'Exporting…' : 'Export now'}
        </button>
      </div>
    </Modal>
  )
}
