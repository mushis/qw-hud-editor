import { useState } from 'react'
import { CATEGORY_LABELS, ELEMENTS, type Category, type Condition } from '../hud/catalog'
import { shouldShow } from '../hud/layout'
import { useStore } from '../store'
import { useHudLayout } from './useHudLayout'

const CATEGORIES = Object.keys(CATEGORY_LABELS) as Category[]

// Short tag shown next to elements that only appear in some situations.
const CONDITION_TAGS: Partial<Record<Condition, [string, string]>> = {
  spectator: ['spec', 'Only shown when spectating or watching a demo'],
  demo: ['demo', 'Only shown during demo / MVD / QTV playback'],
  intermission: ['score', 'Only shown on the scoreboard / intermission'],
}

function Item({ name, description, condition }: { name: string; description: string; condition: Condition }) {
  const params = useStore((s) => s.doc.elements[name])
  const selected = useStore((s) => s.selected === name)
  const { select, editParams } = useStore.getState()
  const { isActive } = useHudLayout()
  const shown = params ? shouldShow(params.show) : false
  const tag = CONDITION_TAGS[condition]
  const active = isActive(name)

  return (
    <div
      className={`palette-item${selected ? ' selected' : ''}${active ? '' : ' inactive'}`}
      title={active ? description : `${description}. Not visible in the current "View as" mode.`}
      onClick={() => params && select(name)}
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
      <span>{name}</span>
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
  const q = filter.trim().toLowerCase()
  const matches = ELEMENTS.filter((e) => !q || e.name.includes(q) || e.description.toLowerCase().includes(q))

  return (
    <nav className="palette">
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
      </div>
      {CATEGORIES.map((cat) => {
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
