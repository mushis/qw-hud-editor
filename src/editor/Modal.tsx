import { useEffect, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

// Without onClose the popup can't be dismissed (no ✕, Escape or click outside): it closes by an answer in it.
export function Modal({ label, onClose, wide, children }: { label: string; onClose?: () => void; wide?: boolean; children: ReactNode }) {
  const backdrop = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Capture phase, so Escape closes the popup without also deselecting the element. Only the topmost popup
    // answers it, so one opened over another doesn't close both.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      const all = document.querySelectorAll('.modal-backdrop')
      if (all[all.length - 1] !== backdrop.current) return
      e.stopPropagation()
      onClose?.()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [onClose])

  // Rendered into <body> so it doesn't inherit the styles of where it is opened from (the toolbar).
  return createPortal(
    <div className="modal-backdrop" ref={backdrop} onPointerDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal${wide ? '' : ' narrow'}`} role="dialog" aria-label={label}>
        {onClose && (
          <button className="modal-close" onClick={onClose} aria-label="Close">
            ✕
          </button>
        )}
        {children}
      </div>
    </div>,
    document.body,
  )
}
