import { useRef, useState } from 'react'
import { EZQUAKE_DEFAULTS } from '../hud/defaults'
import { removeHudFont, saveHudFont, useHudFont } from '../render/textures'
import { useStore } from '../store'
import { Modal } from './Modal'

// Elements that have a proportional setting.
const NAMES = Object.keys(EZQUAKE_DEFAULTS).filter((n) => 'proportional' in EZQUAKE_DEFAULTS[n])

// Sets proportional on every element at once, and loads the TTF font it draws with.
export function ProportionalDialog({ onClose, onMessage }: { onClose: () => void; onMessage: (m: string) => void }) {
  const doc = useStore((s) => s.doc)
  const facepath = useStore((s) => s.settings.fontFacepath)
  const font = useHudFont((s) => s.name)
  const fontInput = useRef<HTMLInputElement>(null)
  const [fontError, setFontError] = useState('')
  const on = NAMES.filter((n) => (parseInt(doc.elements[n]?.proportional ?? '0', 10) || 0) !== 0).length

  const apply = (value: '0' | '1') => {
    const { checkpoint, setParams } = useStore.getState()
    checkpoint() // one undo step for all of them
    for (const n of NAMES) setParams(n, { proportional: value })
    onMessage(`proportional ${value} on all ${NAMES.length} elements that have it. You can undo this.`)
    onClose()
  }

  const file = facepath ? (/\.\w+$/.test(facepath) ? facepath : `${facepath}.ttf`) : ''
  return (
    <Modal label="Proportional text" onClose={onClose}>
      <h2>Proportional text</h2>
      <p>
        Sets <code>proportional</code> on all {NAMES.length} elements that have it ({on} use it now). With <code>1</code>, ezQuake
        draws their text and numbers with a TTF font instead of the charset; with <code>0</code>, with the charset. You can undo
        this.
      </p>
      <h3>Font</h3>
      <p>
        ezQuake loads the font named by <code>font_facepath</code> (or <code>fontload</code>) from the system fonts folder,{' '}
        <code>C:\Windows\Fonts</code> on Windows.{' '}
        {file ? (
          <>
            Your config sets <code>font_facepath "{facepath}"</code>: choose <code>C:\Windows\Fonts\{file}</code>.
          </>
        ) : (
          <>No imported config set it yet.</>
        )}{' '}
        Characters the font doesn't have, like <code>$[</code> and <code>$]</code>, come from the charset, as in the game.
      </p>
      <p className="font-row">
        <span>
          Font: <strong>{font ?? 'none'}</strong>
          {!font && <span className="dim"> (a common sans-serif stands in)</span>}
        </span>
        <button onClick={() => fontInput.current?.click()}>Choose font file…</button>
        {font && (
          <button onClick={() => removeHudFont()} title="Forget this font">
            Remove
          </button>
        )}
        <input
          ref={fontInput}
          type="file"
          accept=".ttf,.otf"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0]
            e.target.value = ''
            if (f) setFontError((await saveHudFont(f)) ? '' : `${f.name} isn't a font this browser can read.`)
          }}
        />
      </p>
      {fontError && <p className="setup-result error">{fontError}</p>}
      <div className="setup-actions">
        <button onClick={onClose}>Cancel</button>
        <button onClick={() => apply('0')}>Set all to 0</button>
        <button className="primary" onClick={() => apply('1')}>
          Set all to 1
        </button>
      </div>
    </Modal>
  )
}
