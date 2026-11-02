import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { offscreen } from '../hud/issues'
import type { Placed } from '../hud/layout'
import { drawHud, setAssetListener } from '../render/renderer'
import { useStore } from '../store'
import { useHudLayout } from './useHudLayout'

interface Drag {
  name: string
  startX: number
  startY: number
  posX: number
  posY: number
  moved: boolean
  stack: string[] | null // elements under the pointer when the click started on the selected one
}

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
  const { doc, screen, ctx, placed, ordered, isActive } = useHudLayout()
  const settings = useStore((s) => s.settings)
  const selected = useStore((s) => s.selected)
  const { select, checkpoint, setParams, setSettings } = useStore.getState()

  const wrapRef = useRef<HTMLDivElement>(null)
  const overlayRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drag = useRef<Drag | null>(null)
  const [fitWidth, setFitWidth] = useState(960)
  const [hovered, setHovered] = useState<string | null>(null)
  const [assetTick, setAssetTick] = useState(0)

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
    drawHud(c, doc, ordered, ctx, settings.width / screen.width, settings.height / screen.height, isActive, settings.showInactive)
  }, [doc, ordered, ctx, screen, settings.width, settings.height, settings.showInactive, isActive, assetTick])

  const zoom = ZOOMS.includes(settings.zoom as (typeof ZOOMS)[number]) ? settings.zoom : 1
  const cssWidth = fitWidth * zoom
  const cssHeight = (cssWidth * settings.height) / settings.width
  // CSS px per virtual px; x and y differ when conwidth/conheight don't match the window aspect.
  const kx = cssWidth / screen.width
  const ky = cssHeight / screen.height

  // After a zoom change, centre the view on the selected element (or the screen centre).
  useLayoutEffect(() => {
    const wrap = wrapRef.current!
    const box = selected ? placed.get(selected)?.outer : undefined
    const cx = box ? (box.x + box.w / 2) * kx : cssWidth / 2
    const cy = box ? (box.y + box.h / 2) * ky : cssHeight / 2
    wrap.scrollTo({ left: cx + 16 - wrap.clientWidth / 2, top: cy + 16 - wrap.clientHeight / 2 })
    // only when the zoom level changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zoom])

  const visible = ordered.filter((p) => settings.showInactive || isActive(p.name))
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
        title={`${p.name} is off-screen (x ${o.x}, y ${o.y})`}
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
  const hitStack = (e: React.PointerEvent): string[] => {
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
    const p = doc.elements[name]
    drag.current = {
      name,
      startX: e.clientX,
      startY: e.clientY,
      posX: parseFloat(p.pos_x ?? '0') || 0,
      posY: parseFloat(p.pos_y ?? '0') || 0,
      moved: false,
      stack: keep ? stack : null,
    }
    overlayRef.current!.setPointerCapture(e.pointerId)
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
    if (!d.moved) checkpoint() // one undo step per drag
    d.moved = true
    setParams(d.name, { pos_x: String(d.posX + dx), pos_y: String(d.posY + dy) })
  }

  const onPointerUp = () => {
    const d = drag.current
    drag.current = null
    if (d && !d.moved && d.stack && d.stack.length > 1) {
      select(d.stack[(d.stack.indexOf(d.name) + 1) % d.stack.length])
    }
  }

  return (
    <div className="stage-area">
      <div className={`stage-wrap${zoom > 1 ? ' zoomed' : ''}`} ref={wrapRef}>
        <div className="stage" style={{ width: cssWidth, height: cssHeight }}>
          {settings.background && <img className="stage-bg" src={settings.background} alt="" draggable={false} />}
          <canvas ref={canvasRef} width={settings.width} height={settings.height} />
          <div
            className={`stage-overlay${hovered ? ' over' : ''}`}
            ref={overlayRef}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerLeave={() => setHovered(null)}
          >
            {visible.map((p) => (
              <div
                key={p.name}
                className={`hit${p.name === selected ? ' selected' : ''}${p.name === hovered ? ' hover' : ''}${p.draw ? '' : ' nodraw'}${status.get(p.name)?.edges.length ? ' clipped' : ''}`}
                style={{
                  left: p.outer.x * kx,
                  top: p.outer.y * ky,
                  width: Math.max(MIN_HIT, p.outer.w) * kx,
                  height: Math.max(MIN_HIT, p.outer.h) * ky,
                }}
              >
                {p.name === selected && <span className="hit-label">{p.name}</span>}
              </div>
            ))}
            {visible.filter((p) => status.get(p.name)?.hidden).map(marker)}
          </div>
        </div>
      </div>
      <div className="zoom" title="Zoom">
        {ZOOMS.map((z) => (
          <button key={z} className={z === zoom ? 'active' : undefined} onClick={() => setSettings({ zoom: z })}>
            {z === 1 ? 'Fit' : `${z}×`}
          </button>
        ))}
      </div>
    </div>
  )
}
