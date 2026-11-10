import { create } from 'zustand'
import { useStore } from '../store'

// Common game resolutions, most used first (Steam's hardware survey), plus the 4:3 ones QuakeWorld players
// still stretch to a wide screen.
export const RESOLUTIONS: [number, number][] = [
  [1920, 1080],
  [2560, 1440],
  [3840, 2160],
  [1366, 768],
  [1920, 1200],
  [2560, 1600],
  [3440, 1440],
  [2560, 1080],
  [1600, 900],
  [1680, 1050],
  [1280, 720],
  [1280, 1024],
  [1440, 1080],
  [1280, 960],
  [1024, 768],
]

// This screen in device pixels: what ezQuake takes as the desktop resolution (with Windows scaling, an estimate).
export const screenResolution = (): [number, number] => [
  Math.round(window.screen.width * window.devicePixelRatio),
  Math.round(window.screen.height * window.devicePixelRatio),
]

// Open while a cfg that sets vid_width / vid_height 0 asks which resolution the game is played at (ResolutionDialog);
// still open after a reload when the question wasn't answered.
const pending = () => {
  const from = useStore.getState().settings.cfgResolution
  return from?.width === 0 || from?.height === 0
}
export const useResolutionPrompt = create<{ open: boolean }>(() => ({ open: pending() }))
