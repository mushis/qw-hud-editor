import { useState } from 'react'
import { currentCfg } from '../editor/actions'
import { Modal } from '../editor/Modal'
import { getNick, getSecret, LIMITS, setNick, shareHud, updateHud, useGallery } from './api'
import { RecoveryCode } from './RecoveryCode'

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

// Shares the current HUD (with its settings) under a name and nick. A name you already
// shared from this browser updates that HUD instead.
export function ShareDialog({ initialName, onClose, onMessage }: { initialName: string; onClose: () => void; onMessage: (m: string) => void }) {
  const { huds, mine } = useGallery()
  const [name, setName] = useState(initialName)
  const [author, setAuthor] = useState(getNick())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [newCode, setNewCode] = useState<string | null>(null) // shown after the first share from this browser

  const existing = huds.find((h) => same(h.name, name))
  const own = existing && mine.has(existing.id)
  const taken = existing && !own
  const valid = name.trim() && author.trim() && !taken

  const submit = async () => {
    setBusy(true)
    setError('')
    const firstShare = !getSecret()
    try {
      if (own) {
        await updateHud(existing.id, { name: name.trim(), author: author.trim(), cfg: currentCfg(true) })
        setNick(author.trim())
        onMessage(`Updated "${name.trim()}" in the shared gallery.`)
        onClose()
      } else {
        await shareHud(name.trim(), author.trim(), currentCfg(true))
        onMessage(`Shared "${name.trim()}": everyone can load it now.`)
        if (firstShare) setNewCode(getSecret())
        else onClose()
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal label="Share HUD" onClose={onClose}>
      <h2>Share current HUD</h2>
      {newCode ? (
        <>
          <p>Your HUD is public now. You can update or delete it later from this browser.</p>
          <RecoveryCode code={newCode} />
          <div className="dialog-buttons">
            <button onClick={onClose}>Done</button>
          </div>
        </>
      ) : (
        <form
          className="dialog-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (valid && !busy) submit()
          }}
        >
          <p className="dim">Everyone visiting the editor will see it in "Load / save HUD…", with its settings (resolution, conscale…).</p>
          <label>
            HUD name
            <input autoFocus value={name} maxLength={LIMITS.name} onChange={(e) => setName(e.target.value)} />
          </label>
          {taken && <p className="warn">Someone else already shared a HUD called "{existing.name}". Choose another name.</p>}
          {own && <p className="dim">You shared "{existing.name}" before: this replaces it with the current HUD.</p>}
          <label>
            Your nick
            <input value={author} maxLength={LIMITS.author} onChange={(e) => setAuthor(e.target.value)} />
          </label>
          {error && <p className="warn">{error}</p>}
          <div className="dialog-buttons">
            <button type="button" onClick={onClose}>
              Cancel
            </button>
            <button type="submit" className="primary" disabled={!valid || busy}>
              {busy ? 'Sharing…' : own ? 'Update' : 'Share'}
            </button>
          </div>
        </form>
      )}
    </Modal>
  )
}
