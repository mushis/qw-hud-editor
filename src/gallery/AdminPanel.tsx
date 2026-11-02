import { useEffect, useState } from 'react'
import { adminDeleteAll, adminDeleteAuthor, adminEmail, adminSendLink, adminSignOut, deleteHud, isAdmin, LIMITS, updateHud, useGallery } from './api'
import { NameField } from './NameField'

type State = { kind: 'checking' } | { kind: 'signed-out' } | { kind: 'sent'; email: string } | { kind: 'not-admin'; email: string } | { kind: 'admin'; email: string }

// Manage every shared HUD. The database only accepts these changes from the admin account.
export function AdminPanel() {
  const { huds } = useGallery()
  const [state, setState] = useState<State>({ kind: 'checking' })
  const [email, setEmail] = useState('')
  const [error, setError] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    ;(async () => {
      const signedIn = await adminEmail()
      if (!signedIn) return setState({ kind: 'signed-out' })
      setState({ kind: (await isAdmin().catch(() => false)) ? 'admin' : 'not-admin', email: signedIn })
    })()
  }, [])

  // Runs an action, showing `done` (if given) or the error. Returns whether it worked.
  const run = async (action: () => Promise<unknown>, done: string) => {
    setError('')
    try {
      await action()
      if (done) setNote(done)
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }

  if (state.kind === 'checking') return <div className="admin dim">Checking sign-in…</div>

  if (state.kind === 'signed-out' || state.kind === 'sent') {
    return (
      <form
        className="admin admin-gate"
        onSubmit={(e) => {
          e.preventDefault()
          run(() => adminSendLink(email.trim()), '').then((ok) => ok && setState({ kind: 'sent', email: email.trim() }))
        }}
      >
        {state.kind === 'sent' ? (
          <p>
            If <b>{state.email}</b> is the admin address, a sign-in link is on its way. Open it in this browser.
          </p>
        ) : (
          <>
            <input type="email" autoFocus required placeholder="Admin e-mail" value={email} onChange={(e) => setEmail(e.target.value)} />
            <button type="submit">Send sign-in link</button>
          </>
        )}
        {error && <span className="warn">{error}</span>}
      </form>
    )
  }

  const signOut = async () => {
    await adminSignOut()
    setState({ kind: 'signed-out' })
  }

  if (state.kind === 'not-admin') {
    return (
      <div className="admin">
        <p>
          Signed in as {state.email}, which is not the admin account. <button onClick={signOut}>Sign out</button>
        </p>
      </div>
    )
  }

  return (
    <div className="admin">
      <h2>Manage shared HUDs</h2>
      <p className="dim">
        Signed in as {state.email}. <button onClick={signOut}>Sign out</button>
      </p>
      {huds.length ? (
        <table className="hud-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Author</th>
              <th>Updated</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {huds.map((h) => (
              <tr key={h.id}>
                <td>
                  <NameField
                    key={h.name}
                    name={h.name}
                    maxLength={LIMITS.name}
                    taken={(n) => huds.some((o) => o.id !== h.id && o.name.toLowerCase() === n.toLowerCase())}
                    onRename={(n) => run(() => updateHud(h.id, { name: n }), `Renamed "${h.name}" to "${n}".`)}
                  />
                </td>
                <td>{h.author}</td>
                <td className="dim">{new Date(h.updated_at).toLocaleString()}</td>
                <td className="actions">
                  <button onClick={() => window.confirm(`Delete "${h.name}"?`) && run(() => deleteHud(h.id), `Deleted "${h.name}".`)}>Delete</button>
                  <button
                    title={`Delete every HUD by ${h.author}`}
                    onClick={() =>
                      window.confirm(`Delete every HUD by "${h.author}"?`) &&
                      run(async () => setNote(`Deleted ${await adminDeleteAuthor(h.author)} HUDs by ${h.author}.`), '')
                    }
                  >
                    All by author
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p>No shared HUDs.</p>
      )}
      {(note || error) && <p className={error ? 'warn' : 'dim'}>{error || note}</p>}
      <button
        className="danger"
        disabled={!huds.length}
        onClick={() =>
          window.confirm(`Delete all ${huds.length} shared HUDs? This can't be undone.`) &&
          run(async () => setNote(`Deleted ${await adminDeleteAll()} HUDs.`), '')
        }
      >
        Delete all
      </button>
    </div>
  )
}
