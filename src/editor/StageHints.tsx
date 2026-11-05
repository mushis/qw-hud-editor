import type { ReactNode } from 'react'
import type { ResizeBy } from '../hud/layout'

interface Props {
  selected: string | null
  parent: string | null // the element the selected one is placed on
  attached: number // how many are placed on the selected one
  resizable: ResizeBy
  keys: { ctrl: boolean; alt: boolean; shift: boolean }
  dragging: 'move' | 'resize' | null
}

const Key = ({ children }: { children: ReactNode }) => <kbd>{children}</kbd>
const placedOn = (n: number) => (n === 1 ? 'the 1 element placed on it' : `the ${n} elements placed on it`)

// What the mouse and keys do on the stage right now: shown at the bottom while the pointer is over it.
export function StageHints({ selected, parent, attached, resizable, keys, dragging }: Props) {
  const hints: ReactNode[] = []
  const size = resizable === 'scale' ? 'scale' : 'width and height'

  if (!selected) {
    hints.push(<>Click an element to select it</>, <>Right-click: move it to an edge, reset</>)
  } else if (dragging === 'resize' || keys.ctrl) {
    if (resizable) {
      hints.push(<>Drag a corner square to change the {size}; the opposite corner stays</>)
      if (resizable === 'scale') hints.push(<><Key>Shift</Key> finer steps</>)
      hints.push(<>Release <Key>Ctrl</Key> to move instead</>)
    } else {
      hints.push(<>{selected} has no scale or size to drag</>)
    }
  } else if (keys.alt && (parent || attached)) {
    if (parent) hints.push(<><Key>Alt</Key>+drag moves {parent} too, with everything placed on it</>)
    if (attached) hints.push(<><Key>Alt</Key>+drag leaves {placedOn(attached)} in place</>)
  } else {
    hints.push(<>Drag: move</>, <><Key>←↑↓→</Key> nudge (<Key>Shift</Key> 10)</>)
    if (resizable) hints.push(<><Key>Ctrl</Key>+drag a corner: {size}</>)
    if (parent) hints.push(<><Key>Alt</Key>+drag: move with {parent}</>)
    if (attached) hints.push(<><Key>Alt</Key>+drag: move without {placedOn(attached)}</>)
    hints.push(<>Click again: the element below</>, <>Right-click: menu</>)
  }

  return (
    <div className="stage-hints" aria-live="polite">
      {hints.map((h, i) => (
        <span key={i}>{h}</span>
      ))}
    </div>
  )
}
