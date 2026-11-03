import { useState } from 'react'
import { CATEGORY_LABELS, ELEMENTS, type Category, type Condition } from '../hud/catalog'
import { isUnezquakeElement } from '../hud/defaults'
import { placeTree, shouldShow } from '../hud/layout'
import { useStore } from '../store'
import { useHudLayout } from './useHudLayout'

const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[]

// Short tag shown next to elements that only appear in some situations.
const CONDITION_TAGS: Partial<Record<Condition, [string, string]>> = {
  spectator: ['spec', 'Only shown when spectating or watching a demo'],
  demo: ['demo', 'Only shown during demo / MVD / QTV playback'],
  intermission: ['score', 'Only shown on the scoreboard / intermission'],
  vote: ['vote', 'Only shown for 10 seconds when a player suggests a map before a match'],
}

function Item({ name, description, condition, depth }: { name: string; description: string; condition: Condition; depth?: number }) {
  const params = useStore((s) => s.doc.elements[name])
  const selected = useStore((s) => s.selected === name)
  const { select, editParams, hover } = useStore.getState()
  const { isActive } = useHudLayout()
  const shown = params ? shouldShow(params.show) : false
  const tag = CONDITION_TAGS[condition]
  const active = isActive(name)

  return (
    <div
      className={`palette-item${selected ? ' selected' : ''}${active ? '' : ' inactive'}`}
      title={active ? description : `${description}. Not visible in the current "View as" mode.`}
      onClick={() => params && select(name)}
      onPointerEnter={() => hover(name)}
      onPointerLeave={() => hover(null)}
      style={depth ? { paddingLeft: 10 + depth * 14 } : undefined}
    >
      <input
        type="checkbox"
        checked={shown}
        disabled={!params}
        onClick={(ev) => ev.stopPropagation()}
        onChange={() => {
          editParams(name, { show: shown ? '0' : '1' })
          select(name)
        }}
      />
      <span>
        {depth ? <span className="tree-branch">└ </span> : null}
        {name}
      </span>
      {isUnezquakeElement(name) && (
        <em className="tag unez" title="Only in unezquake: ezQuake doesn't have this element and ignores its settings">
          unez
        </em>
      )}
      {tag && (
        <em className="tag" title={tag[1]}>
          {tag[0]}
        </em>
      )}
    </div>
  )
}

export function Palette() {
  const [filter, setFilter] = useState('')
  const doc = useStore((s) => s.doc)
  const tree = useStore((s) => s.settings.paletteTree)
  const collapsed = useStore((s) => s.settings.paletteCollapsed)
  const setSettings = useStore((s) => s.setSettings)
  const q = filter.trim().toLowerCase()
  const matches = ELEMENTS.filter((e) => !q || e.name.includes(q) || e.description.toLowerCase().includes(q))
  const info = new Map(ELEMENTS.map((e) => [e.name, e]))

  // With a filter, the tree keeps the matches and the elements they are placed on.
  const treeRows = () => {
    const rows = placeTree(
      doc,
      ELEMENTS.map((e) => e.name),
    )
    if (!q) return rows
    const keep = new Set<string>()
    const stack: string[] = []
    for (const row of rows) {
      stack.length = row.depth
      stack.push(row.name)
      if (matches.some((m) => m.name === row.name)) stack.forEach((n) => keep.add(n))
    }
    return rows.filter((r) => keep.has(r.name))
  }

  if (collapsed) {
    return (
      <nav className="palette collapsed">
        <button className="palette-expand" onClick={() => setSettings({ paletteCollapsed: false })} title="Show the element list" aria-label="Show the element list">
          <span>›</span>
          <span className="palette-expand-label">Elements</span>
        </button>
      </nav>
    )
  }

  return (
    <nav className="palette">
      <div className="palette-head">
        <div className="search">
          <input
            value={filter}
            placeholder="Filter elements"
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && setFilter('')}
          />
          {filter && (
            <button title="Clear filter" onClick={() => setFilter('')}>
              ✕
            </button>
          )}
          <button
            className="palette-collapse"
            onClick={() => setSettings({ paletteCollapsed: true })}
            title="Hide the element list (more room for the screen)"
            aria-label="Hide the element list"
          >
            ‹
          </button>
        </div>
        <label className="palette-tree" title="List each element under the element its place puts it on (place = an element name or @name).">
          <input
            type="checkbox"
            role="switch"
            className="switch"
            checked={tree}
            onChange={(e) => setSettings({ paletteTree: e.target.checked })}
          />
          View in hierarchy
        </label>
      </div>
      {tree && (
        <section>
          {treeRows().map(({ name, depth }) => (
            <Item key={name} name={name} description={info.get(name)!.description} condition={info.get(name)!.condition} depth={depth} />
          ))}
        </section>
      )}
      {!tree && CATEGORIES.map((cat) => {
        const items = matches.filter((e) => e.category === cat)
        return (
          items.length > 0 && (
            <section key={cat}>
              <h3>{CATEGORY_LABELS[cat]}</h3>
              {items.map((e) => (
                <Item key={e.name} name={e.name} description={e.description} condition={e.condition} />
              ))}
            </section>
          )
        )
      })}
      {!matches.length && <p className="hint palette-empty">No element matches "{filter}".</p>}
    </nav>
  )
}
