import { useState } from 'react'

// Inline rename: applies on Enter or blur, reverts on Escape or when the name is taken.
export function NameField({
  name,
  maxLength,
  taken,
  onRename,
}: {
  name: string
  maxLength: number
  taken: (n: string) => boolean
  onRename: (n: string) => unknown
}) {
  const [draft, setDraft] = useState(name)
  const next = draft.trim()
  const clash = next.toLowerCase() !== name.toLowerCase() && taken(next)
  const commit = () => {
    if (next && next !== name && !clash) onRename(next)
    else setDraft(name)
  }
  return (
    <input
      value={draft}
      maxLength={maxLength}
      className={clash ? 'bad' : undefined}
      title={clash ? 'Another HUD has this name' : 'Rename: Enter or click elsewhere to apply'}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(name)
      }}
    />
  )
}
