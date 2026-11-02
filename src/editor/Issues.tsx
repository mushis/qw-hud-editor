import { useMemo, useState } from 'react'
import { findIssues, type Severity } from '../hud/issues'
import { useStore } from '../store'
import { useHudLayout } from './useHudLayout'

const ICONS: Record<Severity, string> = { error: '●', warning: '▲', info: 'i' }

// Panel under the stage listing problems; clicking one selects its element.
export function Issues() {
  const { doc, placed, screen } = useHudLayout()
  const selected = useStore((s) => s.selected)
  const select = useStore((s) => s.select)
  const [open, setOpen] = useState(true)
  const issues = useMemo(() => findIssues(doc, placed, screen), [doc, placed, screen])
  const errors = issues.filter((i) => i.severity === 'error').length

  return (
    <section className={`issues${open ? ' open' : ''}`}>
      <button className="issues-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="chevron">{open ? '▾' : '▸'}</span>
        Issues
        <span className={`count${errors ? ' bad' : issues.length ? ' some' : ''}`}>{issues.length}</span>
      </button>
      {open && (
        <ul>
          {issues.map((issue, i) => (
            <li
              key={i}
              className={`${issue.severity}${issue.element === selected ? ' selected' : ''}`}
              onClick={() => select(issue.element)}
            >
              <span className="sev" title={issue.severity}>
                {ICONS[issue.severity]}
              </span>
              <span className="mono">{issue.element}</span>
              <span>{issue.message}</span>
            </li>
          ))}
          {!issues.length && <li className="none">No issues: every enabled element is drawn on screen.</li>}
        </ul>
      )}
    </section>
  )
}
