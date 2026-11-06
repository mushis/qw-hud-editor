import { useMemo, useState } from 'react'
import { DEFAULTS_SOURCE, defaultValue } from '../hud/defaults'
import { clientIssues, findIssues, type Issue, type Severity } from '../hud/issues'
import { useStore } from '../store'
import { cvar, tip } from './tip'
import { useHudLayout } from './useHudLayout'

const ICONS: Record<Severity, string> = { error: '●', warning: '▲', info: 'i' }

// Panel under the stage listing problems; clicking one selects its element, Reset puts the settings at fault back to their defaults.
export function Issues() {
  const { doc, placed, screen } = useHudLayout()
  const selected = useStore((s) => s.selected)
  const select = useStore((s) => s.select)
  const editParams = useStore((s) => s.editParams)
  // The defaults of the settings at fault, for the ones ezQuake has a default for.
  const defaultsFor = (issue: Issue) =>
    Object.fromEntries(issue.params.flatMap((p) => (defaultValue(issue.element, p) === undefined ? [] : [[p, defaultValue(issue.element, p)!]])))
  const reset = (issue: Issue) => {
    editParams(issue.element, defaultsFor(issue))
    select(issue.element)
  }
  const [open, setOpen] = useState(true)
  const issues = useMemo(() => findIssues(doc, placed, screen), [doc, placed, screen])
  // The resolution and virtual size, which aren't part of any element, come first.
  const settings = useStore((s) => s.settings)
  const client = useMemo(() => clientIssues(settings, settings.cfgResolution), [settings])
  const setSettings = useStore((s) => s.setSettings)
  const count = client.length + issues.length
  const errors = issues.filter((i) => i.severity === 'error').length

  return (
    <section className={`issues${open ? ' open' : ''}`}>
      <button className="issues-head" onClick={() => setOpen(!open)} aria-expanded={open}>
        <span className="chevron">{open ? '▾' : '▸'}</span>
        Issues
        <span className={`count${errors ? ' bad' : count ? ' some' : ''}`}>{count}</span>
      </button>
      {open && (
        <ul>
          {client.map((issue) => (
            <li key={issue.cvar + issue.message} className={issue.severity}>
              <span className="sev" title={issue.severity}>
                {ICONS[issue.severity]}
              </span>
              <span className="mono">{issue.cvar}</span>
              <span className="message">{issue.message}</span>
              {issue.fix ? (
                <button className="issue-reset" onClick={() => setSettings(issue.fix!.settings)} {...tip(issue.cvar, issue.fix.title)}>
                  {issue.fix.label}
                </button>
              ) : (
                <span className="issue-reset-none" />
              )}
            </li>
          ))}
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
              {Object.keys(defaultsFor(issue)).length > 0 ? (
                <button
                  className="issue-reset"
                  onClick={(e) => {
                    e.stopPropagation()
                    reset(issue)
                  }}
                  {...tip(
                    Object.keys(defaultsFor(issue))
                      .map((p) => cvar(issue.element, p))
                      .join(', '),
                    `Back to the ezQuake default (${Object.entries(defaultsFor(issue))
                      .map(([p, v]) => `${p} "${v}"`)
                      .join(', ')}), and select ${issue.element}. This often fixes the issue. You can undo this.
(defaults from ${DEFAULTS_SOURCE})`,
                  )}
                >
                  Reset property
                </button>
              ) : (
                <span className="issue-reset-none" />
              )}
            </li>
          ))}
          {!count && <li className="none">No issues: every enabled element is drawn on screen.</li>}
        </ul>
      )}
    </section>
  )
}
