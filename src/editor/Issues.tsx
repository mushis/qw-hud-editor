import { useMemo, useState } from 'react'
import { DEFAULTS_SOURCE, EZQUAKE_DEFAULTS } from '../hud/defaults'
import { findIssues, type Severity } from '../hud/issues'
import { useStore } from '../store'
import { useHudLayout } from './useHudLayout'

const ICONS: Record<Severity, string> = { error: '●', warning: '▲', info: 'i' }

// Panel under the stage listing problems; clicking one selects its element, Reset puts it back to the defaults.
export function Issues() {
  const { doc, placed, screen } = useHudLayout()
  const selected = useStore((s) => s.selected)
  const select = useStore((s) => s.select)
  const editParams = useStore((s) => s.editParams)
  // Keeps show, so the element stays on screen at its default place and size.
  const reset = (element: string) => {
    editParams(element, { ...EZQUAKE_DEFAULTS[element], show: doc.elements[element]?.show ?? '1' })
    select(element)
  }
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
              <span className="message">{issue.message}</span>
              {EZQUAKE_DEFAULTS[issue.element] && (
                <button
                  className="issue-reset"
                  onClick={(e) => {
                    e.stopPropagation()
                    reset(issue.element)
                  }}
                  title={`Set every setting of ${issue.element} back to the ezQuake default, except show, and select it. This often fixes the issue. You can undo this.
(defaults from ${DEFAULTS_SOURCE})`}
                >
                  Reset
                </button>
              )}
            </li>
          ))}
          {!issues.length && <li className="none">No issues: every enabled element is drawn on screen.</li>}
        </ul>
      )}
    </section>
  )
}
