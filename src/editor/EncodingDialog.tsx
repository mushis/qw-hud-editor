import { useEncodingPrompt } from './cfgFile'
import { Modal } from './Modal'

const FIXES = {
  utf16: 'Convert it to one byte per character, the way ezQuake reads it.',
  utf8: 'Turn each two-byte character back into the one Quake character it stands for.',
  lost: 'Turn the two-byte characters back into Quake ones, and drop the ones already lost.',
  bom: 'Remove the marker.',
}

// Asks what to do with a cfg whose encoding would garble HUD text.
export function EncodingDialog() {
  const prompt = useEncodingPrompt((s) => s.prompt)
  if (!prompt) return null
  const { name, issue, answer } = prompt
  const shown = issue.cvars.slice(0, 6)
  return (
    <Modal label="Encoding problem" onClose={() => answer('cancel')}>
      <h2>Encoding problem in {name}</h2>
      <p>{issue.message}</p>
      {shown.length > 0 && (
        <p>
          It changes {issue.cvars.length === 1 ? 'this HUD setting' : `${issue.cvars.length} HUD settings`}:{' '}
          {shown.map((c, i) => (
            <span key={c}>
              {i > 0 && ', '}
              <code>{c}</code>
            </span>
          ))}
          {issue.cvars.length > shown.length && '…'}.
        </p>
      )}
      <p className="dim">
        Fix: {FIXES[issue.kind]} Saving the cfg again from the editor (Export cfg) writes it the way ezQuake reads it.
      </p>
      <div className="setup-actions">
        <button onClick={() => answer('cancel')}>Cancel</button>
        <button onClick={() => answer('keep')} title="Import the bytes as they are, the way ezQuake would read this file">
          Import as is
        </button>
        <button className="primary" autoFocus onClick={() => answer('fix')}>
          Fix and import
        </button>
      </div>
    </Modal>
  )
}
