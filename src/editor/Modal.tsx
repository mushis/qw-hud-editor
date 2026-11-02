import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

export function Modal({ label, onClose, wide, children }: { label: string; onClose: () => void; wide?: boolean; children: ReactNode }) {
  useEffect(() => {
    // Capture phase, so Escape closes the popup without also deselecting the element.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Rendered into <body> so it doesn't inherit the styles of where it is opened from (the toolbar).
  return createPortal(
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? '' : ' narrow'}`} role="dialog" aria-label={label}>
        <button className="modal-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
        {children}
      </div>
    </div>,
    document.body,
  )
}
