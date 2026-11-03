import { useRef, useState, type DragEvent } from 'react'
import { CHARSET, CROSSHAIR, droppedFiles, isTextureFile, removeAllTextures, removeTexture, removeTextureSet, texturesOf, useTextures, type PathFile, type TextureKind } from '../render/textures'
import { loadTextureFiles } from './actions'
import { Modal } from './Modal'

const ACCEPT = '.png,.tga,.jpg,.jpeg,.webp,.gif,.bmp,.pcx,.wad,.zip,.pk3'

const KIND_LABELS: Record<TextureKind, string> = { wad: 'HUD pictures', charset: 'Charset', crosshair: 'Crosshair' }
const label = (name: string) => (name === CHARSET ? 'charset' : name === CROSSHAIR ? 'crosshair' : name)

// Every loaded texture, by how it was loaded, with a preview; each one, each load or all of them can be deleted.
export function AssetsDialog({ onClose, onMessage }: { onClose: () => void; onMessage: (m: string) => void }) {
  const sets = useTextures((s) => s.sets)
  useTextures((s) => s.version)
  const total = sets.reduce((n, s) => n + s.names.length, 0)
  const files = useRef<HTMLInputElement>(null)
  const folder = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [over, setOver] = useState(false)
  const [result, setResult] = useState('')

  // A folder gives every file in it; only images, wads and archives are read.
  const load = async (list: PathFile[]) => {
    const picked = list.filter((f) => isTextureFile(f.path))
    if (!picked.length) return setResult('No .png, .tga, .jpg, .webp, .gif, .bmp, .pcx, .wad, .zip or .pk3 files there.')
    setBusy(true)
    const message = await loadTextureFiles(picked)
    setBusy(false)
    setResult(message)
    onMessage(message)
  }
  const fromInput = (list: FileList | null) => [...(list ?? [])].map((file) => ({ path: file.webkitRelativePath || file.name, file }))
  // Handled here, not by the page-wide drop.
  const drop = async (e: DragEvent) => {
    e.preventDefault()
    setOver(false)
    load(await droppedFiles(e.dataTransfer))
  }

  return (
    <Modal label="Assets" onClose={onClose} wide>
      <h2>{sets.length ? 'Loaded assets' : 'Load assets'}</h2>
      {sets.length ? (
        <p>
          {total} {total === 1 ? 'texture' : 'textures'} kept in this browser. They replace the editor's pictures by name and can be used as group pictures
          (<code>gfx/&lt;name&gt;</code>). Deleting one shows what it replaced again; you can't undo it.
        </p>
      ) : (
        <>
          <p>Load your own graphics; they replace the editor's pictures by name and can be used as group pictures:</p>
          <ul>
            <li>
              <strong>HUD pictures</strong>: images named like ezQuake's (<code>num_0</code>, <code>anum_5</code>, <code>sb_shells</code>, <code>face1</code>…),
              from <code>textures/wad</code> or <code>gfx</code>, or a whole <strong>gfx.wad</strong>
            </li>
            <li>
              <strong>Charset</strong>: an image from <code>textures/charsets</code>, or <code>conchars</code>
            </li>
            <li>
              <strong>Pictures</strong> for <code>hud_groupN_picture</code>: any image, used by its file name
            </li>
            <li>
              <strong>zip / pk3</strong> archives and <strong>folders</strong>: the HUD graphics inside them
            </li>
          </ul>
          <p className="dim">
            Formats: .png, .tga, .jpg, .webp, .gif, .bmp, .pcx. Files are only read by this browser and kept in it. For your whole Quake setup (config,
            charset, crosshair and HUD pictures) use Import setup.
          </p>
        </>
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
        ) : (
          <>
            <button className={sets.length ? undefined : 'primary'} onClick={() => files.current?.click()}>
              {sets.length ? 'Add files…' : 'Choose files…'}
            </button>
            <button onClick={() => folder.current?.click()}>Choose folder…</button>
            <span className="dim">or drop them here</span>
          </>
        )}
        <input
          ref={files}
          type="file"
          multiple
          accept={ACCEPT}
          hidden
          onChange={(e) => {
            load(fromInput(e.target.files))
            e.target.value = ''
          }}
        />
        <input
          ref={folder}
          type="file"
          // Non-standard but supported everywhere: pick a folder, get every file in it.
          {...{ webkitdirectory: '' }}
          hidden
          onChange={(e) => {
            load(fromInput(e.target.files))
            e.target.value = ''
          }}
        />
      </div>
      {result && <p className="hint">{result}</p>}
      {[...sets].reverse().map((set) => (
        <section key={set.id} className="asset-set">
          <div className="asset-set-head">
            <span>
              <strong>{set.kind ? KIND_LABELS[set.kind] : 'Textures'}</strong> · {set.label}{' '}
              <span className="dim">
                ({set.names.length}, {new Date(set.created).toLocaleDateString()})
              </span>
            </span>
            <button
              onClick={() => {
                removeTextureSet(set.id)
                onMessage(`Deleted the ${set.names.length} textures from "${set.label}".`)
              }}
            >
              Delete these
            </button>
          </div>
          <div className="asset-grid">
            {texturesOf(set).map((t) => (
              <div key={t.name} className={`asset${t.shown ? '' : ' replaced'}`} title={`${label(t.name)} · ${t.w}×${t.h}${t.shown ? '' : ' · replaced by a newer load'}`}>
                <span className="picture-thumb">
                  <img src={t.url} alt="" />
                </span>
                <span className="asset-name">{label(t.name)}</span>
                <button className="asset-delete" onClick={() => removeTexture(set.id, t.name)} title={`Delete ${label(t.name)}`} aria-label={`Delete ${label(t.name)}`}>
                  ✕
                </button>
              </div>
            ))}
          </div>
        </section>
      ))}
      <div className="setup-actions">
        {sets.length > 0 && (
          <button
            className="danger"
            onClick={() => {
              if (!window.confirm(`Delete all ${total} loaded textures? This can't be undone.`)) return
              removeAllTextures()
              onMessage('Deleted all loaded textures.')
            }}
          >
            Delete all
          </button>
        )}
        <button className="primary" onClick={onClose}>
          Close
        </button>
      </div>
    </Modal>
  )
}
