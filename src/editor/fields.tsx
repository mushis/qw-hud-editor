import { useEffect, useRef, useState } from 'react'
import { parseRgb, type Rgba } from '../hud/colors'
import QUAKE_PALETTE from '../hud/quake-palette.json'

// Text field that commits on Enter / blur so each edit is one undo step.
// Remount it (via `key`) when the stored value changes from outside.
export function TextField({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
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

// Number with ▲▼ buttons; ArrowUp/ArrowDown in the box step too (Shift = ×10).
export function NumberField({ param, value, onCommit }: { param: string; value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  const step = stepFor(param)
  const commit = () => draft !== value && onCommit(draft)
  const bump = (dir: number, big = false) => onCommit(stepValue(value, big ? step * 10 : step, dir))
  return (
    <div className="num-field">
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

// Slider plus a small box; the box also takes values beyond the slider's range (scale 5).
export function SliderField({ value, min, max, step, onStart, onLive, onCommit }: SliderProps) {
  const pending = useRef(false)
  const n = parseFloat(value)
  return (
    <div className="slider-field">
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
      <TextField key={value} value={value} onCommit={onCommit} />
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
        <label key={`${c}${value}`} title={`${c} (0-255)`}>
          <span>{c}</span>
          <RgbBox value={parts ? String(Math.round(parts[i] ?? 0)) : ''} onCommit={(v) => commit(i, v)} />
        </label>
      ))}
    </div>
  )
}

function RgbBox({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
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
      {palette ? <TextField key={value} value={value} onCommit={onCommit} /> : <RgbFields value={value} onCommit={onCommit} />}
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
