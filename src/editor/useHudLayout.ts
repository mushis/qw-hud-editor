import { useMemo } from 'react'
import { ELEMENT_BY_NAME, ELEMENTS, isActiveIn } from '../hud/catalog'
import { implFor, type Ctx } from '../hud/elements'
import { drawOrder, layoutHud, screenFor } from '../hud/layout'
import { useTextures } from '../render/textures'
import { useStore, virtualSize } from '../store'

const REGISTRATION = ELEMENTS.map((e) => e.name)

export function useHudLayout() {
  const doc = useStore((s) => s.doc)
  const preview = useStore((s) => s.preview)
  const settings = useStore((s) => s.settings)
  const textures = useTextures((s) => s.version) // group pictures can change sizes (pic_scalemode 3)

  return useMemo(() => {
    const { width, height } = virtualSize(settings)
    const screen = screenFor(width, height, settings.viewsize)
    const ctx: Ctx = { preview, screenW: screen.width, screenH: screen.height }
    const placed = layoutHud(doc, screen, (name, p) => implFor(name).size(p, ctx))
    const ordered = drawOrder(placed, REGISTRATION)
    const isActive = (name: string) => {
      const def = ELEMENT_BY_NAME.get(name)
      return def ? isActiveIn(def, preview.mode) : true
    }
    return { doc, screen, ctx, placed, ordered, isActive }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc, preview, settings, textures])
}
