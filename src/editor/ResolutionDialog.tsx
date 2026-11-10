import { useState } from 'react'
import { useStore } from '../store'
import { Modal } from './Modal'
import { RESOLUTIONS, screenResolution, useResolutionPrompt } from './resolutions'

const MIN = [320, 200]
const MAX = 16384

// A cfg with vid_width / vid_height 0 leaves the resolution to the desktop's: asks which one the game is played at.
export function ResolutionDialog() {
  const open = useResolutionPrompt((s) => s.open)
  return open ? <Ask /> : null
}

function Ask() {
  const from = useStore((s) => s.settings.cfgResolution)
  const setSettings = useStore((s) => s.setSettings)
  const desktop = screenResolution()
  const [w, setW] = useState(String(desktop[0]))
  const [h, setH] = useState(String(desktop[1]))

  const width = Number(w)
  const height = Number(h)
  const valid = Number.isInteger(width) && Number.isInteger(height) && width >= MIN[0] && height >= MIN[1] && width <= MAX && height <= MAX
  // This screen is marked where it is in the list, or comes first when it isn't a common one.
  const isDesktop = ([a, b]: [number, number]) => a === desktop[0] && b === desktop[1]
  const picks = RESOLUTIONS.some(isDesktop) ? RESOLUTIONS : [desktop, ...RESOLUTIONS]
  const use = () => {
    if (!valid) return
    setSettings({ width, height, cfgResolution: null })
    useResolutionPrompt.setState({ open: false })
  }

  // 0 isn't a resolution the editor can show, so there is no way out without choosing one.
  return (
    <Modal label="Game resolution">
      <h2>Which resolution do you play at?</h2>
      <p>
        This config sets{' '}
        {[from?.width !== undefined && <code key="w">vid_width {from.width}</code>, from?.height !== undefined && <code key="h">vid_height {from.height}</code>]
          .filter(Boolean)
          .flatMap((c, i) => (i ? [' and ', c] : [c]))}
        . With 0, ezQuake uses your desktop resolution (<code>vid_usedesktopres 1</code>, its default), or 1024×768 when that is off. Where the
        HUD's elements end up depends on it, so choose the one you play at.
      </p>
      <div className="resolution-picks">
        {picks.map(([a, b]) => (
          <button
            key={`${a}x${b}`}
            className={a === width && b === height ? 'active' : undefined}
            onClick={() => {
              setW(String(a))
              setH(String(b))
            }}
          >
            {a}×{b}
            {isDesktop([a, b]) && <span className="dim"> this screen</span>}
          </button>
        ))}
      </div>
      <label className="resolution-typed">
        Or type it:
        <input type="number" min={MIN[0]} max={MAX} value={w} onChange={(e) => setW(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && use()} aria-label="vid_width" />
        ×
        <input type="number" min={MIN[1]} max={MAX} value={h} onChange={(e) => setH(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && use()} aria-label="vid_height" />
      </label>
      {!valid && <p className="hint warn">ezQuake opens at least 320×200 and at most {MAX}×{MAX}, in whole pixels.</p>}
      <div className="setup-actions">
        <button className="primary" disabled={!valid} onClick={use}>
          Use {valid ? `${width}×${height}` : 'it'}
        </button>
      </div>
    </Modal>
  )
}
