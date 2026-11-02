import { useState } from 'react'
import { currentCfg } from '../editor/actions'
import { Modal } from '../editor/Modal'
import { deleteHud, getSecret, LIMITS, recover, updateHud, useGallery } from './api'
import { NameField } from './NameField'
import { RecoveryCode } from './RecoveryCode'

// The HUDs shared from this browser: rename, replace with the current HUD, delete; recovery code.
export function MyHuds({ onClose, onMessage }: { onClose: () => void; onMessage: (m: string) => void }) {
  const { huds, mine } = useGallery()
  const own = huds.filter((h) => mine.has(h.id))
  const [error, setError] = useState('')
  const [code, setCode] = useState('')
  const secret = getSecret()

  const run = async (action: () => Promise<unknown>, done: string) => {
    setError('')
    try {
      await action()
      onMessage(done)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <Modal label="My shared HUDs" onClose={onClose}>
      <h2>My shared HUDs</h2>
      {own.length ? (
        <table className="hud-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {own.map((h) => (
              <tr key={h.id}>
                <td>
                  <NameField
                    key={h.name}
                    name={h.name}
                    maxLength={LIMITS.name}
                    taken={(n) => huds.some((o) => o.id !== h.id && o.name.toLowerCase() === n.toLowerCase())}
                    onRename={(n) => run(() => updateHud(h.id, { name: n }), `Renamed to "${n}".`)}
                  />
                </td>
                <td className="dim">{new Date(h.updated_at).toLocaleString()}</td>
                <td className="actions">
                  <button
                    title="Replace this shared HUD with the one in the editor"
                    onClick={() =>
                      window.confirm(`Replace "${h.name}" with the HUD in the editor?`) &&
                      run(() => updateHud(h.id, { cfg: currentCfg(true) }), `Updated "${h.name}".`)
                    }
                  >
                    Update
                  </button>
                  <button onClick={() => window.confirm(`Delete "${h.name}" from the gallery?`) && run(() => deleteHud(h.id), `Deleted "${h.name}".`)}>
                    Delete
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="dim">You haven't shared any HUD from this browser.</p>
      )}
      {error && <p className="warn">{error}</p>}

      {secret && own.length > 0 && <RecoveryCode code={secret} />}

      <form
        className="recover-form"
        onSubmit={async (e) => {
          e.preventDefault()
          setError('')
          if (own.length && !window.confirm('This browser will use the new code, and you will need the current one to manage the HUDs listed above. Continue?')) return
          try {
            const n = await recover(code)
            if (n) {
              setCode('')
              onMessage(`Recovered ${n} shared HUD${n === 1 ? '' : 's'}.`)
            } else setError('No shared HUDs belong to that code.')
          } catch (err) {
            setError((err as Error).message)
          }
        }}
      >
        <label>
          Shared from another browser? Enter its recovery code:
          <span>
            <input value={code} onChange={(e) => setCode(e.target.value)} placeholder="Recovery code" />
            <button type="submit" disabled={!code.trim()}>
              Recover
            </button>
          </span>
        </label>
      </form>
    </Modal>
  )
}
