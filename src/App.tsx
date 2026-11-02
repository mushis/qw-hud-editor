import { useEffect, useLayoutEffect, useState } from 'react'
import { parseCfg } from './hud/cfg'
import { withDefaults } from './hud/defaults'
import { importCfg, loadTextureFiles } from './editor/actions'
import { fetchPreset, readFileText } from './editor/io'
import { Inspector } from './editor/Inspector'
import { Issues } from './editor/Issues'
import { Palette } from './editor/Palette'
import { Stage } from './editor/Stage'
import { Toolbar } from './editor/Toolbar'
import { useGallery } from './gallery/api'
import { droppedFiles, isTextureFile, loadCustomBackground, loadSavedTextures } from './render/textures'
import { hasSavedDoc, useStore } from './store'

function useKeyboard() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, select, textarea')) return
      const s = useStore.getState()
      const mod = e.ctrlKey || e.metaKey
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault()
        if (e.shiftKey) s.redo()
        else s.undo()
        return
      }
      if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault()
        s.redo()
        return
      }
      if (e.key === 'Escape') return s.select(null)
      const sel = s.selected
      if (!sel || !s.doc.elements[sel]) return
      const step = e.shiftKey ? 10 : 1
      const delta: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      }
      const d = delta[e.key]
      if (!d) return
      e.preventDefault()
      const p = s.doc.elements[sel]
      s.editParams(sel, {
        pos_x: String((parseFloat(p.pos_x ?? '0') || 0) + d[0]),
        pos_y: String((parseFloat(p.pos_y ?? '0') || 0) + d[1]),
      })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

// Files dropped anywhere on the page: cfg/txt files are imported, texture files loaded.
function useFileDrop(onMessage: (m: string) => void) {
  const [dragging, setDragging] = useState(false)
  useEffect(() => {
    let depth = 0 // dragenter/dragleave fire for every child element
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files')
    const enter = (e: DragEvent) => hasFiles(e) && ++depth && setDragging(true)
    const leave = (e: DragEvent) => hasFiles(e) && --depth <= 0 && setDragging(false)
    const over = (e: DragEvent) => hasFiles(e) && e.preventDefault()
    const drop = async (e: DragEvent) => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth = 0
      setDragging(false)
      // Folders are walked; a cfg only counts when dropped on its own, not from inside a folder.
      const files = await droppedFiles(e.dataTransfer!)
      const cfg = files.find((f) => !f.path.includes('/') && /\.(cfg|txt)$/i.test(f.path))
      const textures = files.filter((f) => isTextureFile(f.path))
      const messages: string[] = []
      if (cfg) messages.push(importCfg(cfg.file.name, await readFileText(cfg.file)))
      if (textures.length) messages.push(await loadTextureFiles(textures))
      if (!cfg && !textures.length) messages.push('Drop a .cfg file to import it, or textures (.png .tga .wad .zip .pk3, or a folder of them).')
      onMessage(messages.join(' '))
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragleave', leave)
    window.addEventListener('dragover', over)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('dragover', over)
      window.removeEventListener('drop', drop)
    }
  }, [onMessage])
  return dragging
}

export default function App() {
  const [message, setMessage] = useState('')
  useKeyboard()
  const dragging = useFileDrop(setMessage)
  const theme = useStore((s) => s.settings.theme)
  useLayoutEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    loadSavedTextures()
    loadCustomBackground()
    useGallery.getState().refresh()
  }, [])

  // First visit: start from the nQuake default HUD.
  useEffect(() => {
    if (hasSavedDoc()) return
    fetchPreset('nquake-default').then((text) => {
      useStore.setState({ doc: withDefaults(parseCfg(text).doc), past: [], future: [] })
    })
  }, [])

  useEffect(() => {
    if (!message) return
    const t = setTimeout(() => setMessage(''), 6000)
    return () => clearTimeout(t)
  }, [message])

  return (
    <div className="app">
      <Toolbar onMessage={setMessage} />
      <Palette />
      <main>
        <Stage />
        <Issues />
        {message && <div className="toast">{message}</div>}
      </main>
      <Inspector />
      {dragging && (
        <div className="drop-overlay">
          <div>
            Drop a <b>.cfg</b> to import the HUD
            <br />
            or textures: <b>.png .tga .wad .zip .pk3</b>
          </div>
        </div>
      )}
    </div>
  )
}
