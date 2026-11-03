import { Fragment, useEffect, useRef, useState, type RefObject } from 'react'
import { parseRgb, type Rgba } from '../hud/colors'
import QUAKE_PALETTE from '../hud/quake-palette.json'

// What a box shows while it is edited. A new stored value (undo, a drag, a commit) replaces it during render,
// so the box keeps its focus instead of being remounted.
function useDraft(value: string): [string, (v: string) => void] {
  const [draft, setDraft] = useState(value)
  const [stored, setStored] = useState(value)
  if (stored !== value) {
    setStored(value)
    setDraft(value)
  }
  return [draft, setDraft]
}

// Text field that commits on Enter / blur so each edit is one undo step.
export function TextField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useDraft(value)
  const commit = () => draft !== value && onCommit(draft)
  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        if (e.key === 'Escape') setDraft(value)
      }}
    />
  )
}

export function Select({ value, options, onChange }: { value: string; options: [string, string][]; onChange: (v: string) => void }) {
  const known = options.some(([v]) => v === value)
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)}>
      {!known && <option value={value}>{value || '(empty)'}</option>}
      {options.map(([v, label]) => (
        <option key={v} value={v}>
          {label}
        </option>
      ))}
    </select>
  )
}

// ---------------------------------------------------------------- numbers

const FINE_STEP = /opacity|alpha|scale|^frame$|ratio|tick_spacing|duration|^time$|period|offset/

function stepFor(param: string): number {
  return FINE_STEP.test(param) ? 0.05 : 1
}

const decimals = (s: string) => (s.includes('.') ? s.split('.')[1].length : 0)

function stepValue(value: string, step: number, dir: number): string {
  const n = parseFloat(value) || 0
  const places = Math.max(decimals(String(step)), decimals(value))
  return String(parseFloat((n + dir * step).toFixed(places)))
}

// The mouse wheel over a field steps it (Shift = ×10) instead of scrolling the panel. A native listener, since
// React's wheel events can't stop the page scrolling.
function useWheelStep(ref: RefObject<HTMLDivElement | null>, onStep: (dir: number, big: boolean) => void) {
  const latest = useRef(onStep)
  useEffect(() => {
    latest.current = onStep
  })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      const delta = e.deltaY || e.deltaX // Shift+wheel scrolls sideways in some browsers
      if (!delta) return
      e.preventDefault()
      latest.current(delta < 0 ? 1 : -1, e.shiftKey)
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [ref])
}

// Number with ▲▼ buttons; ArrowUp/ArrowDown in the box and the mouse wheel step too (Shift = ×10). Values below min become min.
export function NumberField({ param, value, min = -Infinity, onCommit }: { param: string; value: string; min?: number; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useDraft(value)
  const step = stepFor(param)
  const clamp = (v: string) => (parseFloat(v) < min ? String(min) : v)
  const commit = () => {
    const v = clamp(draft)
    if (v !== draft) setDraft(v)
    if (v !== value) onCommit(v)
  }
  const bump = (dir: number, big = false) => {
    const v = clamp(stepValue(value, big ? step * 10 : step, dir))
    if (v !== value) onCommit(v)
  }
  const box = useRef<HTMLDivElement>(null)
  useWheelStep(box, bump)
  return (
    <div className="num-field" ref={box}>
      <input
        value={draft}
        inputMode="decimal"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit()
          else if (e.key === 'Escape') setDraft(value)
          else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
            e.preventDefault()
            bump(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey)
          }
        }}
      />
      <div className="spin">
        <button tabIndex={-1} title={`+${step} (Shift: +${step * 10})`} onClick={(e) => bump(1, e.shiftKey)}>
          ▲
        </button>
        <button tabIndex={-1} title={`-${step} (Shift: -${step * 10})`} onClick={(e) => bump(-1, e.shiftKey)}>
          ▼
        </button>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------- sliders

interface SliderProps {
  value: string
  min: number
  max: number
  step: number
  onStart: () => void // before the first live change of a drag or key press: one undo step each
  onLive: (v: string) => void
  onCommit: (v: string) => void
}

// Slider plus a small box; the box also takes values beyond the slider's range (scale 5). The wheel over it
// steps it within the slider's range.
export function SliderField({ value, min, max, step, onStart, onLive, onCommit }: SliderProps) {
  const pending = useRef(false)
  const n = parseFloat(value)
  const box = useRef<HTMLDivElement>(null)
  useWheelStep(box, (dir, big) => {
    const v = parseFloat(stepValue(Number.isFinite(n) ? String(n) : String(min), big ? step * 10 : step, dir))
    // A value already beyond the range (typed in the box) keeps stepping instead of jumping back to it.
    const next = String(n > max || n < min ? v : Math.min(max, Math.max(min, v)))
    if (next !== value) onCommit(next)
  })
  return (
    <div className="slider-field" ref={box}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min}
        onPointerDown={() => (pending.current = true)}
        onKeyDown={() => (pending.current = true)}
        onChange={(e) => {
          if (pending.current) onStart()
          pending.current = false
          onLive(e.target.value)
        }}
      />
      <TextField value={value} onCommit={onCommit} />
    </div>
  )
}

// ---------------------------------------------------------------- colours

// A small, harmonious set: neutrals plus a dimmed and a bright row of hues.
const SWATCHES = [
  '0 0 0', '20 20 20', '40 40 40', '64 64 64', '100 100 100', '128 128 128', '200 200 200', '255 255 255',
  '120 30 30', '130 70 20', '120 100 20', '30 90 40', '20 80 90', '30 50 120', '70 40 110', '110 30 80',
  '220 60 60', '255 130 40', '250 200 60', '80 200 100', '60 190 210', '70 120 240', '160 100 230', '230 90 160',
]

const toHex = ([r, g, b]: Rgba) => '#' + [r, g, b].map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')).join('')
const fromHex = (hex: string): [number, number, number] => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number]
const css = (c: Rgba | null) => (c ? `rgba(${c[0]},${c[1]},${c[2]},${(c[3] ?? 255) / 255})` : 'transparent')

const CHANNELS = ['R', 'G', 'B', 'A']

// One 0-255 box per channel (A only when the value has 4 parts). An empty value stays empty until edited.
function RgbFields({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const parts = parseRgb(value)
  const count = parts?.length === 4 ? 4 : 3
  const commit = (i: number, v: string) => {
    const next = Array.from({ length: count }, (_, k) => Math.round(parts?.[k] ?? (k === 3 ? 255 : 0)))
    next[i] = Math.max(0, Math.min(255, Math.round(parseFloat(v) || 0)))
    const text = next.join(' ')
    if (text !== value) onCommit(text)
  }
  return (
    <div className="rgb-fields">
      {CHANNELS.slice(0, count).map((c, i) => (
        <label key={c} title={`${c} (0-255)`}>
          <span>{c}</span>
          <RgbBox value={parts ? String(Math.round(parts[i] ?? 0)) : ''} onCommit={(v) => commit(i, v)} />
        </label>
      ))}
    </div>
  )
}

function RgbBox({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useDraft(value)
  const commit = () => draft !== value && onCommit(draft)
  return (
    <input
      value={draft}
      inputMode="numeric"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit()
        else if (e.key === 'Escape') setDraft(value)
        else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault()
          const step = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 10 : 1)
          onCommit(String((parseFloat(value) || 0) + step))
        }
      }}
    />
  )
}

interface ColorProps {
  value: string
  palette: boolean
  onOpen: () => void // start of an editing session: one undo step for everything until it closes
  onLive: (v: string) => void
  onCommit: (v: string) => void
}

export function ColorField({ value, palette, onOpen, onLive, onCommit }: ColorProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open])

  const rgb = palette ? null : parseRgb(value)
  const index = palette ? parseInt(value, 10) : NaN
  const swatch = palette ? (QUAKE_PALETTE[index] ?? 'transparent') : css(rgb)
  const hasAlpha = rgb?.length === 4

  const setRgb = (next: [number, number, number], alpha = rgb?.[3]) =>
    onLive(alpha === undefined || !hasAlpha ? next.join(' ') : [...next, alpha].join(' '))

  return (
    <div className="color-field" ref={ref}>
      <button
        className="swatch"
        title="Pick a colour"
        onClick={() => {
          if (!open) onOpen()
          setOpen(!open)
        }}
      >
        <span style={{ background: swatch }} />
      </button>
      {palette ? <TextField value={value} onCommit={onCommit} /> : <RgbFields value={value} onCommit={onCommit} />}
      {open && (
        <div className="color-pop">
          {palette ? (
            <>
              <p className="hint">Quake palette index</p>
              <div className="palette-grid">
                {QUAKE_PALETTE.map((hex: string, i: number) => (
                  <button
                    key={i}
                    className={i === index ? 'current' : undefined}
                    title={String(i)}
                    style={{ background: hex }}
                    onClick={() => onLive(String(i))}
                  />
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="color-row">
                <input type="color" value={toHex(rgb ?? [0, 0, 0])} onChange={(e) => setRgb(fromHex(e.target.value))} />
                {hasAlpha && (
                  <label className="alpha" title="Alpha (0-255)">
                    alpha
                    <input
                      type="range"
                      min={0}
                      max={255}
                      value={rgb![3]}
                      onChange={(e) => setRgb([rgb![0], rgb![1], rgb![2]], Number(e.target.value))}
                    />
                    <span className="mono">{rgb![3]}</span>
                  </label>
                )}
              </div>
              <div className="swatch-grid">
                {SWATCHES.map((s) => (
                  <button
                    key={s}
                    title={s}
                    style={{ background: `rgb(${s.split(' ').join(',')})` }}
                    onClick={() => setRgb(s.split(' ').map(Number) as [number, number, number])}
                  />
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- checkbox

// 0/1 setting.
export function Checkbox({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const on = (parseFloat(value) || 0) !== 0
  return <input type="checkbox" className="check-field" checked={on} onChange={(e) => onChange(e.target.checked ? '1' : '0')} />
}

// ---------------------------------------------------------------- combobox

export interface ComboOption {
  value: string
  label: string
  group: string
}

// Text box with a filtered list of suggestions. Typing filters by value or label; arrows move,
// Enter picks the highlighted one (or keeps what was typed), Escape gives up.
export function Combobox({
  value,
  options,
  onChange,
  placeholder,
}: {
  value: string
  options: ComboOption[]
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(value)
  const [active, setActive] = useState(0)
  const ref = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  // Show the new value when it changes from outside (undo, another element selected).
  const [shownValue, setShownValue] = useState(value)
  if (shownValue !== value) {
    setShownValue(value)
    setDraft(value)
  }
  useEffect(() => {
    if (!open) return
    const close = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return
      setOpen(false)
      setDraft(value)
    }
    window.addEventListener('pointerdown', close)
    return () => window.removeEventListener('pointerdown', close)
  }, [open, value])
  useEffect(() => {
    listRef.current?.querySelector('.active')?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  // The whole list while the box still shows the current value; a filter once something is typed.
  const q = draft === value ? '' : draft.trim().toLowerCase()
  const shown = q ? options.filter((o) => o.value.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)) : options
  const pick = (v: string) => {
    setOpen(false)
    setDraft(v)
    if (v !== value) onChange(v)
  }
  const show = () => {
    setOpen(true)
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
  }

  return (
    <div className="combo" ref={ref}>
      <input
        value={draft}
        placeholder={placeholder}
        onFocus={(e) => {
          e.target.select()
          show()
        }}
        onChange={(e) => {
          setDraft(e.target.value)
          setOpen(true)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            if (!open) return show()
            const n = shown.length
            if (n) setActive((a) => (a + (e.key === 'ArrowDown' ? 1 : -1) + n) % n)
          } else if (e.key === 'Enter') {
            pick(open && shown[active] ? shown[active].value : draft.trim())
          } else if (e.key === 'Escape') {
            e.stopPropagation()
            setOpen(false)
            setDraft(value)
          } else if (e.key === 'Tab') setOpen(false)
        }}
      />
      <button tabIndex={-1} className="combo-toggle" title="Show the choices" onClick={() => (open ? setOpen(false) : show())}>
        ▾
      </button>
      {open && (
        <ul className="combo-list" ref={listRef}>
          {shown.map((o, i) => (
            <Fragment key={o.value}>
              {(i === 0 || shown[i - 1].group !== o.group) && <li className="combo-group">{o.group}</li>}
              <li
                className={i === active ? 'active' : o.value === value ? 'current' : undefined}
                title={o.label}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => pick(o.value)}
                onPointerEnter={() => setActive(i)}
              >
                {o.value}
              </li>
            </Fragment>
          ))}
          {!shown.length && <li className="none">No match. Enter keeps “{draft.trim()}”.</li>}
        </ul>
      )}
    </div>
  )
}
