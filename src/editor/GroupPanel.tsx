import { useEffect, useRef, useState } from 'react'
import { CATEGORY_LABELS, ELEMENTS } from '../hud/catalog'
import { shouldShow, wouldCycle } from '../hud/layout'
import { availablePictures, findPicture, pictureName } from '../hud/pictures'
import { useTextures } from '../render/textures'
import { useStore } from '../store'
import { useHudLayout } from './useHudLayout'
import { Combobox, type ComboOption } from './fields'
import { cvar, tip } from './tip'

const SCALEMODES = ['top-left', 'tile', 'stretch', 'grow', 'centre']

// The pictures a group can use, to pick one; opened from the picture box.
function PicturePicker({ current, onPick, onClose }: { current: string; onPick: (name: string) => void; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [filter, setFilter] = useState('')
  useEffect(() => {
    const outside = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const key = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      onClose()
    }
    window.addEventListener('pointerdown', outside, true)
    window.addEventListener('keydown', key, true)
    return () => {
      window.removeEventListener('pointerdown', outside, true)
      window.removeEventListener('keydown', key, true)
    }
  }, [onClose])
  const q = filter.trim().toLowerCase()
  const pictures = availablePictures().filter((p) => !q || p.name.includes(q))
  return (
    <div className="picture-picker" ref={ref}>
      <input autoFocus value={filter} placeholder="Filter pictures" onChange={(e) => setFilter(e.target.value)} />
      <div className="picture-grid">
        <button className={current ? undefined : 'active'} onClick={() => onPick('')} title="No picture">
          <span className="picture-thumb none">∅</span>
          <span>none</span>
        </button>
        {pictures.map((p) => (
          <button
            key={p.name}
            className={p.name === current ? 'active' : undefined}
            onClick={() => onPick(p.name)}
            title={`gfx/${p.name} · ${p.w}×${p.h}${p.own ? ' · the editor’s own' : ' · loaded by you'}`}
          >
            <span className="picture-thumb">
              <img src={p.url} alt="" />
            </span>
            <span>{p.name}</span>
          </button>
        ))}
      </div>
      {!pictures.length && q && <p className="hint">No picture matches "{filter}".</p>}
      <p className="hint">Add your own with Import setup or by dropping images on the page; the group shows gfx/&lt;name&gt;.</p>
    </div>
  )
}

// For a selected group: the elements placed on it (select, detach, attach another) and its picture.
export function GroupPanel({ group }: { group: string }) {
  const { doc, placed } = useHudLayout()
  useTextures((s) => s.version) // pictures loaded later show up here
  const { select, editParams } = useStore.getState()
  const [picking, setPicking] = useState(false)
  const [attachKey, setAttachKey] = useState(0) // clears the attach box after each pick
  const p = doc.elements[group] ?? {}

  const placedOn = (n: string) => (doc.elements[n]?.place ?? '').replace(/^@/, '') === group
  const attached = ELEMENTS.map((e) => e.name).filter((n) => n !== group && placedOn(n))
  // Anything else, unless placing it here would make a loop (the group is placed on it, directly or not).
  const candidates: ComboOption[] = ELEMENTS.filter((e) => e.name !== group && !placedOn(e.name) && !wouldCycle(doc, e.name, group)).map((e) => ({
    value: e.name,
    label: e.description,
    group: CATEGORY_LABELS[e.category],
  }))

  const picture = findPicture(p.picture)
  const alpha = Math.min(1, Math.max(0, parseFloat(p.pic_alpha ?? '1') || 0))
  const mode = parseInt(p.pic_scalemode ?? '0', 10) || 0

  // Why a chosen picture may not show on the stage: the same settings hide it in game.
  const box = placed.get(group)
  const w = parseInt(p.width ?? '64', 10) || 1
  const h = parseInt(p.height ?? '64', 10) || 1
  const why = !picture
    ? null
    : !shouldShow(p.show)
      ? `${group} is hidden (show ${p.show}), so its picture isn't drawn.`
      : !box
        ? `${group} isn't drawn: it is placed on a hidden element.`
        : !box.draw
          ? `${group} has draw 0, so its picture isn't drawn.`
          : !alpha
            ? 'pic_alpha is 0, so the picture is invisible.'
            : (mode === 0 || mode === 4) && (picture.w > w || picture.h > h)
              ? `${group} is ${w}×${h} and the picture ${picture.w}×${picture.h}: only ${mode === 4 ? 'its middle' : 'its top-left corner'} shows. pic_scalemode 2 stretches it to the group, 3 grows the group to it.`
              : null

  return (
    <section className="group-panel">
      <h3>Attached ({attached.length})</h3>
      {attached.length ? (
        <ul>
          {attached.map((n) => (
            <li key={n} className={shouldShow(doc.elements[n]?.show) ? undefined : 'off'} {...(shouldShow(doc.elements[n]?.show) ? {} : tip(cvar(n, 'show'), `${n} is hidden`))}>
              <button className="link" onClick={() => select(n)} {...tip(cvar(n), `Select ${n}`)}>
                {n}
              </button>
              <button onClick={() => editParams(n, { place: 'screen' })} {...tip(cvar(n, 'place'), `Set ${n}'s place to screen. You can undo this.`)}>
                Detach
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="hint">Nothing is placed on {group}.</p>
      )}
      <div {...tip(cvar('<element>', 'place'), `Set an element's place to ${group}; it then moves with it. You can undo this.`)}>
        <Combobox
          key={attachKey}
          value=""
          placeholder="Attach element… (type to search)"
          options={candidates}
          onChange={(name) => {
            if (candidates.some((c) => c.value === name)) editParams(name, { place: group })
            setAttachKey((k) => k + 1)
          }}
        />
      </div>

      <h3>Picture</h3>
      <div className="group-picture">
        <button className="group-picture-box" onClick={() => setPicking(!picking)} {...tip(cvar(group, 'picture'), 'Choose the picture from the ones loaded')}>
          {picture ? (
            <img src={picture.url} alt="" style={{ opacity: alpha }} />
          ) : (
            <span className="dim">{pictureName(p.picture) ? `gfx/${pictureName(p.picture)} isn't loaded` : 'no picture'}</span>
          )}
        </button>
        <dl>
          <dt>picture</dt>
          <dd>{p.picture ? `"${p.picture}"` : 'none'}</dd>
          <dt>pic_alpha</dt>
          <dd>{alpha}</dd>
          <dt>pic_scalemode</dt>
          <dd>
            {mode} ({SCALEMODES[mode] ?? 'top-left'})
          </dd>
          <dt>size</dt>
          <dd>
            {p.width ?? '?'}×{p.height ?? '?'}
          </dd>
        </dl>
      </div>
      {why && <p className="hint warn">{why}</p>}
      {picking && (
        <PicturePicker
          current={pictureName(p.picture)}
          onClose={() => setPicking(false)}
          onPick={(name) => {
            // A picked picture is stretched to the group, so all of it shows; none clears it.
            editParams(group, name ? { picture: name, pic_scalemode: '2' } : { picture: '' })
            setPicking(false)
          }}
        />
      )}
    </section>
  )
}
