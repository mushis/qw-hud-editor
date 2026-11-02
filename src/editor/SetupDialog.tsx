import { useRef, useState, type DragEvent } from 'react'
import { Modal } from './Modal'
import { entryFolder, handleFolder, importSetup, type Folder, type SetupResult } from './setup'

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { id?: string; mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
  }
}

// Chrome, Edge and Opera can pick a folder and read only the files needed; other browsers take a dropped folder.
const canPick = typeof window.showDirectoryPicker === 'function'

export function SetupDialog({ onClose, onMessage }: { onClose: () => void; onMessage: (m: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [result, setResult] = useState<SetupResult | null>(null)
  // The last folder, to finish with a cfg picked on its own when the folder can't give it.
  const [chosen, setChosen] = useState<{ folder: Folder; name: string } | null>(null)
  const cfgInput = useRef<HTMLInputElement>(null)

  const run = async (folder: Folder, name: string, config?: File) => {
    setBusy(true)
    setResult(null)
    setChosen({ folder, name })
    try {
      const r = await importSetup(folder, name, config)
      setResult(r)
      if (r.ok) onMessage(r.lines.find((l) => l.startsWith('Loaded')) ?? r.lines[0])
    } catch (e) {
      setResult({ ok: false, lines: [`Couldn't read the folder: ${(e as Error).message}`] })
    }
    setBusy(false)
  }

  const pick = async () => {
    try {
      const dir = await window.showDirectoryPicker!({ id: 'quake', mode: 'read' })
      run(handleFolder(dir), dir.name)
    } catch {
      // picker closed
    }
  }

  // Handled here, not by the page-wide drop, which reads every file of a dropped folder.
  const drop = (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    const entry = e.dataTransfer.items[0]?.webkitGetAsEntry?.()
    if (entry?.isDirectory) run(entryFolder(entry as FileSystemDirectoryEntry), entry.name)
    else setResult({ ok: false, lines: ['Drop the Quake folder itself, not a file.'] })
  }

  return (
    <Modal label="Import setup" onClose={onClose}>
      <h2>Import setup</h2>
      {result?.ok ? (
        <>
          <p className="setup-success">✓ Setup imported.</p>
          <ul className="setup-result">
            {result.lines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <div className="setup-actions">
            <button className="primary" autoFocus onClick={onClose}>
              Close
            </button>
          </div>
        </>
      ) : (
        <>
          <p>
            Choose your <strong>Quake folder</strong>: the one with the <code>id1</code> and <code>qw</code> folders inside (a folder that holds it works too). The editor then:
          </p>
          <ul>
            <li>
              imports the HUD and screen settings from <code>ezquake/configs/config.cfg</code>
            </li>
            <li>
              loads the charset named by <code>gl_consolefont</code> (or <code>loadcharset</code>), from <code>textures/charsets</code>; when
              neither is set, ezQuake's own (povo5)
            </li>
            <li>
              loads the crosshair named by <code>crosshairimage</code>, from <code>crosshairs</code> or <code>textures/crosshairs</code>; when
              it isn't set, ezQuake's own one picked by <code>crosshair</code>, sized and coloured by <code>crosshairsize</code>,{' '}
              <code>crosshaircolor</code> and <code>crosshairscale</code>
            </li>
            <li>
              loads the HUD pictures (numbers, faces, icons…) from <code>textures/wad</code>
            </li>
          </ul>
          <p className="dim">
            It looks in <code>ezquake</code> first, then <code>qw</code>, the same as the game. Files that aren't there are skipped, and the textures you have now stay.
            Nothing is uploaded: the files are only read by this browser, and kept in it until you remove them. Importing a cfg later keeps these textures.
          </p>
          {result?.needConfig && (
            <ul className="setup-result">
              {result.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
          <div
            data-own-drop
            className={`setup-drop${over ? ' over' : ''}`}
            onDragOver={(e) => {
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={drop}
          >
            {busy ? (
              'Reading…'
            ) : result?.needConfig && chosen ? (
              <>
                <button className="primary" autoFocus onClick={() => cfgInput.current?.click()}>
                  Choose config.cfg…
                </button>
                <span className="dim">or drop the Quake folder here</span>
                <input
                  ref={cfgInput}
                  type="file"
                  accept=".cfg,.txt"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    e.target.value = ''
                    if (file) run(chosen.folder, chosen.name, file)
                  }}
                />
              </>
            ) : canPick ? (
              <>
                <button className="primary" onClick={pick}>
                  Choose Quake folder…
                </button>
                <span className="dim">or drop it here</span>
              </>
            ) : (
              'Drop your Quake folder here'
            )}
          </div>
          {result && !result.needConfig && (
            <ul className="setup-result error">
              {result.lines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          )}
        </>
      )}
    </Modal>
  )
}
