import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

const DELAY = 400 // ms of hovering before it shows, like the browser's
const GAP = 14 // px between the pointer and the tooltip

interface Shown {
  cvar: string
  text: string
  x: number
  y: number
}

// The tooltip of elements with data-tip (see tip.ts): their cvar in bold, then the text. An element with a native
// title inside one keeps the browser's tooltip.
export function Tooltip() {
  const [shown, setShown] = useState<Shown | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const visible = useRef(false)
  useEffect(() => {
    visible.current = shown !== null
  }, [shown])

  useEffect(() => {
    let timer = 0
    let current: Element | null = null
    let pointer = { x: 0, y: 0 }
    const hide = () => {
      clearTimeout(timer)
      current = null
      setShown(null)
    }
    const show = (el: Element) => setShown({ cvar: el.getAttribute('data-cvar') ?? '', text: el.getAttribute('data-tip') ?? '', ...pointer })
    const over = (e: PointerEvent) => {
      pointer = { x: e.clientX, y: e.clientY }
      const el = (e.target as Element).closest?.('[data-tip], [title]') ?? null
      const target = el?.hasAttribute('data-tip') && (el.getAttribute('data-tip') || el.hasAttribute('data-cvar')) ? el : null
      if (target === current) return
      clearTimeout(timer)
      current = target
      if (!target) return setShown(null)
      // Moving from one to the next while one shows: no new wait.
      if (visible.current) show(target)
      else timer = window.setTimeout(() => current === target && show(target), DELAY)
    }
    const move = (e: PointerEvent) => (pointer = { x: e.clientX, y: e.clientY })
    window.addEventListener('pointerover', over)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerdown', hide, true)
    window.addEventListener('wheel', hide, true)
    window.addEventListener('keydown', hide, true)
    window.addEventListener('blur', hide)
    document.addEventListener('pointerleave', hide)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('pointerover', over)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerdown', hide, true)
      window.removeEventListener('wheel', hide, true)
      window.removeEventListener('keydown', hide, true)
      window.removeEventListener('blur', hide)
      document.removeEventListener('pointerleave', hide)
    }
  }, [])

  // Below and right of the pointer, moved inside the window when it would stick out.
  const [pos, setPos] = useState({ left: 0, top: 0 })
  useLayoutEffect(() => {
    if (!shown || !ref.current) return
    const { width, height } = ref.current.getBoundingClientRect()
    const left = Math.max(4, Math.min(shown.x + GAP, window.innerWidth - width - 4))
    const top = shown.y + GAP + height > window.innerHeight - 4 ? Math.max(4, shown.y - GAP - height) : shown.y + GAP
    setPos({ left, top })
  }, [shown])

  if (!shown) return null
  return createPortal(
    <div className="tooltip" ref={ref} role="tooltip" style={pos}>
      {shown.cvar && <b>{shown.cvar}</b>}
      {shown.text && <span>{shown.text}</span>}
    </div>,
    document.body,
  )
}
