import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { offscreen } from '../hud/issues'
import type { HudDoc } from '../hud/cfg'
import { keepInPlace, resizeBy, type Corner, type Placed, type Rect } from '../hud/layout'
import { drawHud, setAssetListener } from '../render/renderer'
import { CUSTOM_BACKGROUND, useCustomBackground, useTextures } from '../render/textures'
import { useStore } from '../store'
import { StageHints } from './StageHints'
import { StageMenu } from './StageMenu'
import { cvar, tip } from './tip'
import { useHudLayout } from './useHudLayout'

interface Drag {
  mode: 'move' | 'resize'
  name: string
  startX: number
  startY: number
  moved: boolean
  stack: string[] | null // elements under the pointer when the click started on the selected one
  // move: pos_x / pos_y at the start of the element, the element it is placed on and the ones placed on it
  start: Record<string, { x: number; y: number }>
  parent: string | null
  children: string[]
  // resize: the corner dragged, the box and the size settings at the start
  corner?: Corner
  box?: Rect
  size?: { scale: number; width: number; height: number }
  doc?: HudDoc
}

const CORNERS: Corner[] = ['tl', 'tr', 'bl', 'br']
const opposite = (c: Corner) => `${c[0] === 't' ? 'b' : 't'}${c[1] === 'l' ? 'r' : 'l'}` as Corner
const num = (v: string | undefined) => parseFloat(v ?? '0') || 0
const SCROLL_KEY = 'qw-hud-editor:scroll'

const ZOOMS = [1, 2, 4] as const
const MIN_HIT = 4 // virtual px, so zero-sized elements can still be grabbed

// Arrow for an off-screen element's marker, keyed by its horizontal and vertical side.
const ARROWS: Record<string, string> = {
  'left,': '←',
  'right,': '→',
  ',top': '↑',
  ',bottom': '↓',
  'left,top': '↖',
  'right,top': '↗',
  'left,bottom': '↙',
  'right,bottom': '↘',
}

export function Stage() {
  const { doc, screen, ctx, sizer, placed, ordered, isActive } = useHudLayout()
  const settings = useStore((s) => s.settings)
  const selected = useStore((s) => s.selected)
  const customBackground = useCustomBackground((s) => s.url)
  const background = settings.background === CUSTOM_BACKGROUND ? customBackground : settings.background
  const backtile = useTextures((s) => s.textures.backtile?.url) ?? `${import.meta.env.BASE_URL}assets/wad/backtile.png`
  const { select, checkpoint, setParams, setMany, setSettings } = useStore.getState()

  const wrapRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drag = useRef<Drag | null>(null)
  const [fitWidth, setFitWidth] = useState(960)
  const hovered = useStore((s) => s.hovered)
  const setHovered = useStore((s) => s.hover)
  const [assetTick, setAssetTick] = useState(0)
  // Modifier keys held (Ctrl: resize handles, Alt: move with the parent / without the children), and whether the
  // pointer is over the stage, for the key hints.
  const [keys, setKeys] = useState({ ctrl: false, alt: false, shift: false })
  const [inside, setInside] = useState(false)
  const [dragging, setDragging] = useState<Drag['mode'] | null>(null)
  const insideRef = useRef(false)
  insideRef.current = inside

  useEffect(() => {
    const update = (e: KeyboardEvent | PointerEvent) => {
      const next = { ctrl: e.ctrlKey || e.metaKey, alt: e.altKey, shift: e.shiftKey }
      setKeys((k) => (k.ctrl === next.ctrl && k.alt === next.alt && k.shift === next.shift ? k : next))
    }
    const up = (e: KeyboardEvent) => {
      update(e)
      // Releasing Alt alone would move the focus to the browser's menu.
      if (e.key === 'Alt' && insideRef.current) e.preventDefault()
    }
    const blur = () => setKeys({ ctrl: false, alt: false, shift: false })
    window.addEventListener('keydown', update)
    window.addEventListener('keyup', up)
    window.addEventListener('pointermove', update)
    window.addEventListener('blur', blur)
    return () => {
      window.removeEventListener('keydown', update)
      window.removeEventListener('keyup', up)
      window.removeEventListener('pointermove', update)
      window.removeEventListener('blur', blur)
    }
  }, [])

  // Width that fits the game screen in the available space, keeping the aspect ratio.
  useLayoutEffect(() => {
    const el = wrapRef.current!
    const ro = new ResizeObserver(() => {
      const width = el.clientWidth - 32
      const height = el.clientHeight - 32
      setFitWidth(Math.max(200, Math.min(width, (height * settings.width) / settings.height)))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [settings.width, settings.height])

  useEffect(() => setAssetListener(() => setAssetTick((t) => t + 1)), [])

  useEffect(() => {
    const c = canvasRef.current!.getContext('2d')!
    drawHud(c, doc, ordered, ctx, settings.width / screen.width, settings.height / screen.height, isActive, settings.showInactive, screen.view, settings.crosshair)
  }, [doc, ordered, ctx, screen, settings.width, settings.height, settings.showInactive, settings.crosshair, isActive, assetTick])

  const zoom = ZOOMS.includes(settings.zoom as (typeof ZOOMS)[number]) ? settings.zoom : 1
  const cssWidth = fitWidth * zoom
  const cssHeight = (cssWidth * settings.height) / settings.width
  // CSS px per virtual px; x and y differ when conwidth/conheight don't match the window aspect.
  const kx = cssWidth / screen.width
  const ky = cssHeight / screen.height

  // The point of the screen in the middle of the view (0..1 of its width and height), kept across resizes and
  // reloads; a zoom change centres the view on the selected element (or the screen centre) instead.
  const centre = useRef<{ fx: number; fy: number }>({ fx: 0.5, fy: 0.5 })
  const restored = useRef(false)
  if (!restored.current) {
    restored.current = true
    try {
      const saved = JSON.parse(localStorage.getItem(SCROLL_KEY) ?? 'null')
      if (Number.isFinite(saved?.fx) && Number.isFinite(saved?.fy)) centre.current = saved
    } catch {
      // not remembered
    }
  }
  const onScroll = () => {
    const wrap = wrapRef.current!
    if (zoom === 1) return
    centre.current = { fx: (wrap.scrollLeft + wrap.clientWidth / 2 - 16) / cssWidth, fy: (wrap.scrollTop + wrap.clientHeight / 2 - 16) / cssHeight }
    try {
      localStorage.setItem(SCROLL_KEY, JSON.stringify(centre.current))
    } catch {
      // not remembered
    }
  }
  const lastZoom = useRef(zoom)
  useLayoutEffect(() => {
    if (lastZoom.current !== zoom) {
      lastZoom.current = zoom
      const box = selected ? placed.get(selected)?.outer : undefined
      centre.current = box ? { fx: (box.x + box.w / 2) / screen.width, fy: (box.y + box.h / 2) / screen.height } : { fx: 0.5, fy: 0.5 }
    }
    const wrap = wrapRef.current!
    const { fx, fy } = centre.current
    wrap.scrollTo({ left: fx * cssWidth + 16 - wrap.clientWidth / 2, top: fy * cssHeight + 16 - wrap.clientHeight / 2 })
    // when the stage size changes (zoom, window, resolution)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cssWidth, cssHeight])

  // Below viewsize 100 the 3D view is smaller and centred, with backtile around it (SCR_TileClear).
  const v = screen.view
  const smallView = v.w < screen.width || v.h < screen.height
  const viewBox = { left: v.x * kx, top: v.y * ky, width: v.w * kx, height: v.h * ky }

  const visible = ordered.filter((p) => settings.showInactive || isActive(p.name))

  // For the selected element: a link from the element it is placed on, and links to the elements placed on it
  // (those get a dotted outline). Each runs between box centres, from a ring on the parent to an arrow on the child.
  // Line, dashes and caps grow with the zoom, like the HUD.
  const parentOf = (name: string) => {
    const target = (doc.elements[name]?.place ?? '').replace(/^@/, '')
    return target !== name && doc.elements[target] ? target : null
  }
  const childrenOf = (name: string) => Object.keys(doc.elements).filter((n) => n !== name && parentOf(n) === name)
  const sel = selected ? placed.get(selected) : undefined
  const selParent = selected ? parentOf(selected) : null
  const resizable = sel ? resizeBy(doc.elements[sel.name]) : null
  const children = sel ? visible.filter((p) => p.name !== selected && parentOf(p.name) === selected) : []
  const childNames = new Set(children.map((p) => p.name))
  const middle = (p: Placed) => [(p.outer.x + p.outer.w / 2) * kx, (p.outer.y + p.outer.h / 2) * ky]
  const links: { from: Placed; to: Placed; key: string }[] = []
  if (sel && selParent && placed.get(selParent)) links.push({ from: placed.get(selParent)!, to: sel, key: 'parent' })
  for (const c of children) links.push({ from: sel!, to: c, key: c.name })

  // "Groups": each shown group as a labelled outline in its own colour, and the elements placed on it tinted
  // in that colour (a group placed on a group gets the colour of its own outline, and tints its parent's).
  const groups = settings.showGroups ? visible.filter((p) => /^group\d$/.test(p.name)) : []
  const groupColor = (name: string) => `hsl(${(Number(name.slice(5)) * 67 + 250) % 360} 65% 62%)`
  const members = groups.length ? visible.filter((p) => groups.some((g) => parentOf(p.name) === g.name)) : []
  const attached = (group: string) => Object.keys(doc.elements).filter((n) => parentOf(n) === group).length
  const status = new Map(visible.filter((p) => p.draw).map((p) => [p.name, offscreen(p, screen)]))

  // Off-screen elements get a marker on the nearest screen edge, pointing at them.
  const marker = (p: Placed) => {
    const o = p.outer
    const sx = o.x + o.w <= 0 ? 'left' : o.x >= screen.width ? 'right' : ''
    const sy = o.y + o.h <= 0 ? 'top' : o.y >= screen.height ? 'bottom' : ''
    const cx = Math.min(screen.width, Math.max(0, o.x + o.w / 2)) * kx
    const cy = Math.min(screen.height, Math.max(0, o.y + o.h / 2)) * ky
    const tx = sx === 'left' ? '0' : sx === 'right' ? '-100%' : '-50%'
    const ty = sy === 'top' ? '0' : sy === 'bottom' ? '-100%' : '-50%'
    return (
      <button
        key={`m-${p.name}`}
        className={`offscreen-marker${p.name === selected ? ' selected' : ''}`}
        style={{ left: cx, top: cy, transform: `translate(${tx}, ${ty})` }}
        {...tip(`${cvar(p.name, 'pos_x')}, ${cvar(p.name, 'pos_y')}`, `${p.name} is off-screen (x ${o.x}, y ${o.y})`)}
        onPointerDown={(e) => {
          e.stopPropagation()
          select(p.name)
        }}
      >
        {ARROWS[`${sx},${sy}`]} {p.name}
      </button>
    )
  }

  // Elements under the pointer, topmost (last drawn) first.
  const [menu, setMenu] = useState<{ name: string; x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  const hitStack = (e: { clientX: number; clientY: number }): string[] => {
    const r = overlayRef.current!.getBoundingClientRect()
    const x = (e.clientX - r.left) / kx
    const y = (e.clientY - r.top) / ky
    const inside = ({ outer: o }: Placed) => x >= o.x && y >= o.y && x <= o.x + Math.max(MIN_HIT, o.w) && y <= o.y + Math.max(MIN_HIT, o.h)
    return visible
      .filter(inside)
      .map((p) => p.name)
      .reverse()
  }

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const stack = hitStack(e)
    if (!stack.length) return select(null)
    // Pressing on the selected element keeps it (so it can be dragged even when covered);
    // a click without dragging then cycles to the next element underneath.
    const keep = selected !== null && stack.includes(selected)
    const name = keep ? selected : stack[0]
    select(name)
    const parent = parentOf(name)
    const kids = childrenOf(name)
    const start = Object.fromEntries(
      [name, ...(parent ? [parent] : []), ...kids].map((n) => [n, { x: num(doc.elements[n].pos_x), y: num(doc.elements[n].pos_y) }]),
    )
    drag.current = { mode: 'move', name, startX: e.clientX, startY: e.clientY, moved: false, stack: keep ? stack : null, start, parent, children: kids }
    overlayRef.current!.setPointerCapture(e.pointerId)
  }

  // Ctrl + a corner of the selected element: resize it from that corner, the opposite one staying put.
  const onCornerDown = (e: React.PointerEvent, corner: Corner) => {
    if (e.button !== 0 || !sel) return
    e.stopPropagation()
    const p = doc.elements[sel.name]
    drag.current = {
      mode: 'resize',
      name: sel.name,
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      stack: null,
      start: {},
      parent: null,
      children: [],
      corner,
      box: sel.outer,
      size: { scale: num(p.scale) || 1, width: num(p.width), height: num(p.height) },
      doc,
    }
    overlayRef.current!.setPointerCapture(e.pointerId)
  }

  const resize = (d: Drag, e: React.PointerEvent) => {
    const { box, corner, size } = d as Required<Drag>
    const dx = (e.clientX - d.startX) / kx
    const dy = (e.clientY - d.startY) / ky
    const sx = corner[1] === 'r' ? 1 : -1
    const sy = corner[0] === 'b' ? 1 : -1
    let values: Record<string, string>
    if (resizeBy(d.doc!.elements[d.name]) === 'scale') {
      // From the fixed corner to the dragged one, before and now: how far the pointer went along that diagonal,
      // as a factor of the box.
      const v0 = [sx * box.w, sy * box.h]
      const len = v0[0] ** 2 + v0[1] ** 2
      if (!len) return
      const r = ((v0[0] + dx) * v0[0] + (v0[1] + dy) * v0[1]) / len
      const step = e.shiftKey ? 100 : 20 // 0.01 with Shift, else 0.05
      values = { scale: String(Math.min(20, Math.max(1 / step, Math.round(size.scale * r * step) / step))) }
    } else {
      values = { width: String(Math.max(1, Math.round(size.width + sx * dx))), height: String(Math.max(1, Math.round(size.height + sy * dy))) }
    }
    setParams(d.name, keepInPlace(d.doc!, screen, sizer, d.name, values, opposite(corner)))
  }

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current
    if (!d) {
      setHovered(hitStack(e)[0] ?? null)
      return
    }
    const dx = Math.round((e.clientX - d.startX) / kx)
    const dy = Math.round((e.clientY - d.startY) / ky)
    if (!d.moved && !dx && !dy) return
    if (!d.moved) {
      checkpoint() // one undo step per drag
      setDragging(d.mode)
    }
    d.moved = true
    if (d.mode === 'resize') return resize(d, e)
    // Alt: the element it is placed on moves instead (taking it along), and the ones placed on it stay put.
    const changes: Record<string, Record<string, string>> = {}
    const shift = (n: string, x: number, y: number) => (changes[n] = { pos_x: String(d.start[n].x + x), pos_y: String(d.start[n].y + y) })
    if (e.altKey && d.parent) {
      shift(d.parent, dx, dy)
      shift(d.name, 0, 0)
    } else {
      shift(d.name, dx, dy)
      if (d.parent) shift(d.parent, 0, 0)
    }
    for (const c of d.children) shift(c, e.altKey ? -dx : 0, e.altKey ? -dy : 0)
    setMany(changes)
  }

  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    setDragging(null)
    if (d && !d.moved && d.stack && d.stack.length > 1) {
      select(d.stack[(d.stack.indexOf(d.name) + 1) % d.stack.length])
    }
  }

  return (
    <div className="stage-area">
      <div
        className={`stage-wrap${zoom > 1 ? ' zoomed' : ''}`}
        ref={wrapRef}
        onScroll={onScroll}
        onPointerEnter={() => setInside(true)}
        onPointerLeave={() => setInside(false)}
      >
        <div className="stage" style={{ width: cssWidth, height: cssHeight }}>
          {smallView && <div className="stage-backtile" style={{ backgroundImage: `url(${backtile})`, backgroundSize: `${64 * kx}px ${64 * ky}px` }} />}
          {smallView && <div className="stage-view" style={viewBox} />}
          {background && <img className="stage-bg" src={background} alt="" draggable={false} style={smallView ? viewBox : undefined} />}
          <canvas ref={canvasRef} width={settings.width} height={settings.height} />
          <div
            className={`stage-overlay${hovered ? ' over' : ''}`}
            ref={overlayRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => setHovered(null)}
            onContextMenu={(e) => {
              // Right click: offer moves for the selected element when it is under the pointer (even below
              // others), else for the top element there, which gets selected.
              e.preventDefault()
              const stack = hitStack(e)
              const name = selected && stack.includes(selected) ? selected : stack[0]
              if (!name) return setMenu(null)
              select(name)
              setMenu({ name, x: e.clientX, y: e.clientY })
            }}
          >
            {visible.map((p) => (
              <div
                key={p.name}
                className={`hit${p.name === selected ? ' selected' : ''}${childNames.has(p.name) ? ' child' : ''}${p.name === hovered ? ' hover' : ''}${p.draw ? '' : ' nodraw'}${status.get(p.name)?.edges.length ? ' clipped' : ''}`}
                style={{
                  left: p.outer.x * kx,
                  top: p.outer.y * ky,
                  width: Math.max(MIN_HIT, p.outer.w) * kx,
                  height: Math.max(MIN_HIT, p.outer.h) * ky,
                }}
              >
                {p.name === selected && (
                  <span className="hit-label">
                    {p.name} · {p.outer.w}×{p.outer.h}
                  </span>
                )}
              </div>
            ))}
            {members.map((p) => (
              <div
                key={`member-${p.name}`}
                className="group-member"
                style={{
                  left: p.outer.x * kx,
                  top: p.outer.y * ky,
                  width: Math.max(MIN_HIT, p.outer.w) * kx,
                  height: Math.max(MIN_HIT, p.outer.h) * ky,
                  ['--group' as string]: groupColor(parentOf(p.name)!),
                }}
              />
            ))}
            {groups.map((g) => (
              <div
                key={`group-${g.name}`}
                className="group-outline"
                style={{
                  left: g.outer.x * kx,
                  top: g.outer.y * ky,
                  width: Math.max(MIN_HIT, g.outer.w) * kx,
                  height: Math.max(MIN_HIT, g.outer.h) * ky,
                  ['--group' as string]: groupColor(g.name),
                }}
              >
                <span>
                  {g.name} · {attached(g.name) === 1 ? '1 attached' : `${attached(g.name)} attached`}
                </span>
              </div>
            ))}
            {links.length > 0 && (
              <svg className="place-links" width={cssWidth} height={cssHeight}>
                <defs>
                  <marker id="link-start" viewBox="0 0 10 10" refX="5" refY="5" markerUnits="userSpaceOnUse" markerWidth={10 * zoom} markerHeight={10 * zoom}>
                    <circle cx="5" cy="5" r="3.5" />
                  </marker>
                  <marker id="link-end" viewBox="0 0 10 10" refX="9" refY="5" markerUnits="userSpaceOnUse" markerWidth={10 * zoom} markerHeight={10 * zoom} orient="auto-start-reverse">
                    <path d="M1 1 L9 5 L1 9 z" />
                  </marker>
                </defs>
                {links.map(({ from, to, key }) => {
                  const [x1, y1] = middle(from)
                  const [x2, y2] = middle(to)
                  return (
                    <line
                      key={key}
                      x1={x1}
                      y1={y1}
                      x2={x2}
                      y2={y2}
                      strokeWidth={zoom}
                      strokeDasharray={(key === 'parent' ? [6, 4] : [2, 4]).map((d) => d * zoom).join(' ')}
                      markerStart="url(#link-start)"
                      markerEnd="url(#link-end)"
                    >
                      <title>{`${to.name} is placed on ${from.name}`}</title>
                    </line>
                  )
                })}
              </svg>
            )}
            {visible.filter((p) => status.get(p.name)?.hidden).map(marker)}
            {sel && resizable && (keys.ctrl || dragging === 'resize') &&
              CORNERS.map((c) => (
                <div
                  key={c}
                  className={`resize-handle ${c}`}
                  style={{ left: (c[1] === 'l' ? sel.outer.x : sel.outer.x + Math.max(MIN_HIT, sel.outer.w)) * kx, top: (c[0] === 't' ? sel.outer.y : sel.outer.y + Math.max(MIN_HIT, sel.outer.h)) * ky }}
                  onPointerDown={(e) => onCornerDown(e, c)}
                  {...(resizable === 'scale'
                    ? tip(cvar(sel.name, 'scale'), 'Drag to change the scale')
                    : tip(`${cvar(sel.name, 'width')}, ${cvar(sel.name, 'height')}`, 'Drag to change width and height'))}
                />
              ))}
          </div>
        </div>
      </div>
      <div className="stage-foot">
        <div className="zoom">
          <button
            className={settings.showGroups ? 'active' : undefined}
            onClick={() => setSettings({ showGroups: !settings.showGroups })}
            title="Outline every shown group, with what is placed on it"
          >
            Groups
          </button>
        </div>
        {inside || dragging ? (
          <StageHints
            selected={sel ? sel.name : null}
            parent={selParent}
            attached={selected ? childrenOf(selected).length : 0}
            resizable={resizable}
            keys={keys}
            dragging={dragging}
          />
        ) : (
          <div className="stage-hints idle">Point at the screen for what the mouse and keys do</div>
        )}
        <div className="zoom" title="Zoom">
          {ZOOMS.map((z) => (
            <button key={z} className={z === zoom ? 'active' : undefined} onClick={() => setSettings({ zoom: z })}>
              {z === 1 ? 'Fit' : `${z}×`}
            </button>
          ))}
        </div>
      </div>
      {menu && <StageMenu name={menu.name} x={menu.x} y={menu.y} onClose={closeMenu} />}
    </div>
  )
}
