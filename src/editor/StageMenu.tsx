import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { DEFAULTS_SOURCE, EZQUAKE_DEFAULTS } from '../hud/defaults'
import { useStore } from '../store'

// Moves that put the element on the screen at an edge or the centre: place screen, position 0, and the align that
// side needs. Top / center / bottom set align_y, left / right align_x; the other align stays.
const MOVES: { label: string; values: Record<string, string> }[] = [
  { label: 'Move to top', values: { align_y: 'top' } },
  { label: 'Move to center', values: { align_y: 'center' } },
  { label: 'Move to bottom', values: { align_y: 'bottom' } },
  { label: 'Move to left', values: { align_x: 'left' } },
  { label: 'Move to right', values: { align_x: 'right' } },
]

// Right-click menu for an element on the stage, at the pointer.
export function StageMenu({ name, x, y, onClose }: { name: string; x: number; y: number; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const outside = (e: Event) => !ref.current?.contains(e.target as Node) && onClose()
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('wheel', outside, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('wheel', outside, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('keydown', key, true)
    }
  }, [onClose])

  // Kept inside the window when opened near the right or bottom edge.
  const left = Math.min(x, window.innerWidth - 180)
  const top = Math.min(y, window.innerHeight - 30 * (MOVES.length + 1) - 44)
  return createPortal(
    <div className="stage-menu" ref={ref} style={{ left, top }} role="menu" onContextMenu={(e) => e.preventDefault()}>
      <div className="stage-menu-title">{name}</div>
      {MOVES.map(({ label, values }) => (
        <button
          key={label}
          role="menuitem"
          title={`place screen, pos_x 0, pos_y 0, ${Object.entries(values)
            .map(([k, v]) => `${k} ${v}`)
            .join(', ')}`}
          onClick={() => {
            useStore.getState().editParams(name, { place: 'screen', pos_x: '0', pos_y: '0', ...values })
            onClose()
          }}
        >
          {label}
        </button>
      ))}
      {EZQUAKE_DEFAULTS[name] && (
        <>
          <hr />
          <button
            role="menuitem"
            title={`Set every setting of ${name} back to the value a fresh ezQuake install uses. You can undo this.
(defaults from ${DEFAULTS_SOURCE})`}
            onClick={() => {
              useStore.getState().editParams(name, EZQUAKE_DEFAULTS[name])
              onClose()
            }}
          >
            Reset
          </button>
        </>
      )}
    </div>,
    document.body,
  )
}
