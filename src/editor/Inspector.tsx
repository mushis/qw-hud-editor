import { useState } from 'react'
import { ELEMENT_BY_NAME, ELEMENTS } from '../hud/catalog'
import { DEFAULTS_SOURCE, defaultValue, EZQUAKE_DEFAULTS } from '../hud/defaults'
import { isColorParam, isPaletteColor } from '../hud/colors'
import { invalidReason, minValue, TEXT_PARAMS } from '../hud/issues'
import { ALIGN_X, ALIGN_Y, SCREEN_AREAS, wouldCycle } from '../hud/layout'
import { useStore } from '../store'
import { CopyFrom } from './CopyFrom'
import { Checkbox, ColorField, Combobox, NumberField, Select, SliderField, TextField, type ComboOption } from './fields'
import { useHudLayout } from './useHudLayout'

const COMMON = ['show', 'draw', 'place', 'align_x', 'align_y', 'pos_x', 'pos_y', 'order', 'frame', 'frame_color', 'item_opacity']

const NUMERIC = /^-?(\d+\.?\d*|\.\d+)$/

// Digit alignment inside a number element's box.
const NUMBER_ALIGN: [string, string][] = [
  ['left', 'left'],
  ['center', 'center'],
  ['right', 'right'],
]

// [min, max, step] of the slider; the box next to it accepts any value.
const SLIDERS: Record<string, [number, number, number]> = {
  item_opacity: [0, 1, 0.01],
  pic_alpha: [0, 1, 0.01],
  scale: [0, 3, 0.05],
}

const PIC_SCALEMODES: [string, string][] = [
  ['0', 'top-left, cropped'],
  ['1', 'tile'],
  ['2', 'stretch'],
  ['3', 'grow the group'],
  ['4', 'centre'],
]

const SHOW_OPTIONS: [string, string][] = [
  ['0', 'off'],
  ['1', 'on'],
  ['2', 'single player only'],
  ['3', 'multiplayer only'],
]

export function Inspector() {
  const selected = useStore((s) => s.selected)
  const doc = useStore((s) => s.doc)
  const { editParams, checkpoint, setParams } = useStore.getState()
  const { placed } = useHudLayout()
  // Result of the last action on this element (refused placement, copy), cleared on selection change.
  const [note, setNote] = useState({ element: '', message: '', bad: false })
  const message = note.element === selected ? note : null
  const setError = (text: string) => setNote({ element: selected ?? '', message: text, bad: true })

  if (!selected || !doc.elements[selected]) {
    return (
      <aside className="inspector">
        <p className="hint">Select an element on the screen or in the list.</p>
        <p className="hint">Drag to move (edits pos_x / pos_y). Arrow keys nudge by 1, Shift+arrow by 10. Ctrl+Z / Ctrl+Y undo and redo.</p>
      </aside>
    )
  }

  const params = doc.elements[selected]
  const def = ELEMENT_BY_NAME.get(selected)
  const box = placed.get(selected)
  const set = (param: string, value: string) => editParams(selected, { [param]: value })

  const others = ELEMENTS.map((e) => e.name)
    .filter((n) => n !== selected && doc.elements[n])
    .sort()
  const placeOptions: ComboOption[] = [
    ...SCREEN_AREAS.map((a) => ({ value: a, label: `screen area: ${a}`, group: 'Screen areas' })),
    ...others.map((n) => ({ value: n, label: `next to ${n} (align before/after to sit beside it)`, group: 'Next to an element' })),
    ...others.map((n) => ({ value: `@${n}`, label: `inside ${n}`, group: 'Inside an element (@)' })),
  ]
  // A place that would point at the element itself or make a loop (both disappear in game).
  const placeProblem = (value: string) => {
    const target = value.replace(/^@/, '')
    if (target === selected) return `Can't place ${selected} on itself.`
    if (ELEMENT_BY_NAME.has(target) && wouldCycle(doc, selected, target))
      return `Can't place on ${target}: it is already placed on ${selected} (in game both would disappear).`
    return null
  }
  const onPlace = (value: string) => {
    const problem = placeProblem(value)
    if (problem) {
      setError(problem)
      return
    }
    setError('')
    set('place', value)
  }
  // Copies every setting both elements have, except visibility (show, draw) and the group label;
  // keeps place when it would be invalid here.
  const NOT_COPIED = ['show', 'draw', 'name']
  const copyFrom = (source: string) => {
    const values: Record<string, string> = {}
    for (const [k, v] of Object.entries(doc.elements[source])) if (k in params && !NOT_COPIED.includes(k)) values[k] = v
    const keptPlace = values.place !== undefined && placeProblem(values.place) !== null
    if (keptPlace) delete values.place
    editParams(selected, values)
    setNote({
      element: selected,
      message: `Copied ${Object.keys(values).length} settings from ${source}${keptPlace ? ` (kept place: "${doc.elements[source].place}" would be invalid here)` : ''}.`,
      bad: false,
    })
  }
  const editor = (param: string) => {
    const value = params[param] ?? ''
    switch (param) {
      case 'show':
      case 'draw':
        return <Select value={value} options={SHOW_OPTIONS} onChange={(v) => set(param, v)} />
      case 'place':
        return <Combobox value={value} options={placeOptions} onChange={onPlace} />
      case 'proportional':
        return <Checkbox value={value} onChange={(v) => set(param, v)} />
      case 'align_x':
        return <Select value={value} options={ALIGN_X.map((a) => [a, a])} onChange={(v) => set(param, v)} />
      case 'align_y':
        return <Select value={value} options={ALIGN_Y.map((a) => [a, a])} onChange={(v) => set(param, v)} />
      case 'align':
        return <Select value={value} options={NUMBER_ALIGN} onChange={(v) => set(param, v)} />
      case 'pic_scalemode':
        return <Select value={value} options={PIC_SCALEMODES} onChange={(v) => set(param, v)} />
    }
    if (SLIDERS[param]) {
      const [min, max, step] = SLIDERS[param]
      return (
        <SliderField
          value={value}
          min={min}
          max={max}
          step={step}
          onStart={checkpoint}
          onLive={(v) => setParams(selected, { [param]: v })}
          onCommit={(v) => set(param, String(Math.max(min, parseFloat(v) || 0)))}
        />
      )
    }
    const key = `${selected}.${param}=${value}`
    if (isColorParam(param)) {
      return (
        <ColorField
          key={`${selected}.${param}`}
          value={value}
          palette={isPaletteColor(selected, param)}
          onOpen={checkpoint}
          onLive={(v) => setParams(selected, { [param]: v })}
          onCommit={(v) => set(param, v)}
        />
      )
    }
    if (NUMERIC.test(value) && !TEXT_PARAMS.test(param)) {
      return <NumberField key={key} param={param} value={value} min={minValue(param)} onCommit={(v) => set(param, v)} />
    }
    return <TextField key={key} value={value} onCommit={(v) => set(param, v)} />
  }

  // Highlights values that differ from the ezQuake default and offers a reset.
  const row = (p: string) => {
    const fallback = defaultValue(selected, p)
    const changed = fallback !== undefined && params[p] !== fallback
    const invalid = invalidReason(doc, selected, p)
    return (
      <tr key={p} className={[changed && 'changed', invalid && 'invalid'].filter(Boolean).join(' ') || undefined}>
        <th title={invalid ?? (fallback !== undefined ? `default: "${fallback}"` : 'not an ezQuake default cvar')}>{p}</th>
        <td>
          {editor(p)}
          {invalid && <div className="row-error">{invalid}</div>}
        </td>
        <td className="reset">
          {changed && (
            <button title={`Reset to default "${fallback}"`} onClick={() => (p === 'place' ? onPlace(fallback) : set(p, fallback))}>
              ↺
            </button>
          )}
        </td>
      </tr>
    )
  }
  const defaults = EZQUAKE_DEFAULTS[selected]

  const extra = Object.keys(params)
    .filter((p) => !COMMON.includes(p))
    .sort()

  return (
    <aside className="inspector">
      <h2>{selected}</h2>
      {def && <p className="hint">{def.description}</p>}
      {box ? (
        <p className="hint mono">
          x {box.outer.x} y {box.outer.y} · {box.outer.w}×{box.outer.h}
        </p>
      ) : (
        <p className="hint warn">Not placed: hidden, or its parent is hidden.</p>
      )}
      <div className="element-actions">
        {defaults && (
          <button
            onClick={() => {
              editParams(selected, defaults)
              setNote({ element: selected, message: `${selected} is back to the ezQuake defaults.`, bad: false })
            }}
            title={`Set every setting of ${selected} back to the value a fresh ezQuake install uses. You can undo this.
(defaults from ${DEFAULTS_SOURCE})`}
          >
            Reset
          </button>
        )}
        <CopyFrom names={Object.keys(doc.elements).filter((n) => n !== selected)} onPick={copyFrom} />
      </div>
      {message?.message && <p className={`hint${message.bad ? ' warn' : ''}`}>{message.message}</p>}
      <table className="params">
        <tbody>
          {COMMON.filter((p) => p in params).map(row)}
          {extra.length > 0 && (
            <tr>
              <td colSpan={3} className="params-sep">
                {selected} settings
              </td>
            </tr>
          )}
          {extra.map(row)}
        </tbody>
      </table>
    </aside>
  )
}
