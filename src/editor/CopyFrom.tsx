import { useEffect, useRef, useState } from 'react'

// Button with a filterable list of elements; picking one calls onPick.
export function CopyFrom({ names, onPick }: { names: string[]; onPick: (name: string) => void }) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const q = filter.trim().toLowerCase()
  const shown = [...names].sort().filter((n) => n.includes(q))
  const pick = (name: string) => {
    setOpen(false)
    onPick(name)
  }

  return (
    <div className="copy-from" ref={ref}>
      <button
        title="Copy the settings this element shares with another one (place, position, frame, scale, colours…), but not whether it is shown. You can undo this."
        onClick={() => {
          setFilter('')
          setOpen(!open)
        }}
      >
        Copy from…
      </button>
      {open && (
        <div className="copy-pop">
          <input
            autoFocus
            value={filter}
            placeholder="Filter elements"
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false)
              if (e.key === 'Enter' && shown.length === 1) pick(shown[0])
            }}
          />
          <ul>
            {shown.map((n) => (
              <li key={n} onClick={() => pick(n)}>
                {n}
              </li>
            ))}
            {!shown.length && <li className="none">No match</li>}
          </ul>
        </div>
      )}
    </div>
  )
}
