import react from '@vitejs/plugin-react'
import { execSync } from 'node:child_process'
import { defineConfig } from 'vite'

// The version is the month and year of the latest commit (the build date when git isn't there), e.g. "November 2026".
function versionDate(): string {
  let date = new Date()
  try {
    date = new Date(execSync('git log -1 --format=%cI', { encoding: 'utf8' }).trim())
  } catch {
    // not a git checkout
  }
  return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

// Relative base so the build works under any GitHub Pages sub-path.
export default defineConfig({
  base: './',
  plugins: [react()],
  define: { __VERSION_DATE__: JSON.stringify(versionDate()) },
})
