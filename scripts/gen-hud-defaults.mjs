// Generates src/hud/ezquake-defaults.json: the default value of every HUD cvar,
// read from the HUD_Register(...) calls in ezQuake's source.
// Run with: npm run gen-defaults [-- <git ref>]   (default: master)
import { writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gunzipSync } from 'node:zlib'
import { parseRegisterCalls } from './hud-defaults-parse.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src/hud/ezquake-defaults.json')
const REPO = 'QW-Group/ezquake-source'
const ref = process.argv[2] ?? 'master'

const commit = (await (await fetch(`https://api.github.com/repos/${REPO}/commits/${ref}`)).json()).sha
if (!commit) throw new Error(`cannot resolve ${ref}`)
const tgz = Buffer.from(await (await fetch(`https://codeload.github.com/${REPO}/tar.gz/${commit}`)).arrayBuffer())

// Minimal tar reader: returns src/*.c and src/*.h as text.
function readSources(tar) {
  const files = new Map()
  let longName = null
  for (let p = 0; p + 512 <= tar.length; ) {
    const header = tar.subarray(p, p + 512)
    if (header.every((b) => b === 0)) break
    let name = longName ?? header.toString('latin1', 0, 100).replace(/\0.*$/s, '')
    const prefix = header.toString('latin1', 345, 500).replace(/\0.*$/s, '')
    if (prefix && !longName) name = `${prefix}/${name}`
    longName = null
    const size = parseInt(header.toString('latin1', 124, 136).replace(/\0.*$/s, '').trim() || '0', 8)
    const type = String.fromCharCode(header[156])
    const body = tar.subarray(p + 512, p + 512 + size)
    if (type === 'L') longName = body.toString('latin1').replace(/\0.*$/s, '')
    else if (type === 'x' || type === 'g') {
      const path = body.toString('latin1').match(/\d+ path=([^\n]*)\n/)
      if (path) longName = path[1]
    } else if (/\/src\/[^/]+\.[ch]$/.test(name)) files.set(name.split('/').pop(), body.toString('latin1'))
    p += 512 + Math.ceil(size / 512) * 512
  }
  return files
}

const sources = readSources(gunzipSync(tgz))

// #define NAME "literal" (possibly via other macros), for arguments like SPEED_GREEN.
const defines = new Map()
for (const text of sources.values()) {
  for (const m of text.matchAll(/^[ \t]*#define[ \t]+(\w+)[ \t]+([^\n]+)/gm)) defines.set(m[1], m[2].replace(/\/\/.*$|\/\*.*?\*\//g, '').trim())
}
function resolve(expr, depth = 0) {
  if (depth > 10) return null
  const lit = expr.match(/^("(?:\\.|[^"\\])*"\s*)+$/)
  if (lit) return [...expr.matchAll(/"((?:\\.|[^"\\])*)"/g)].map((x) => x[1]).join('')
  if (/^-?\d+$/.test(expr)) return expr
  return defines.has(expr) ? resolve(defines.get(expr), depth + 1) : null
}
const value = (arg, what) => {
  if (arg.null) return null
  if (arg.str !== undefined) return arg.str
  const v = resolve(arg.expr)
  if (v === null) throw new Error(`cannot resolve ${what}: ${arg.expr}`)
  return v
}

const elements = {}
for (const [file, text] of [...sources].sort()) {
  for (const { line, args } of parseRegisterCalls(text)) {
    const name = value(args[0], 'name')
    const at = `${file}:${line} ${name}`
    const [show, place, alignX, alignY, posX, posY, frame, frameColor, opacity] = args.slice(7, 16).map((a, i) => value(a, `${at} arg ${7 + i}`))
    const params = { order: value(args[5], `${at} order`) }
    if (show !== null) params.show = show
    params.place = place ?? ''
    if (posX !== null && alignX !== null) Object.assign(params, { pos_x: posX, align_x: alignX })
    if (posY !== null && alignY !== null) Object.assign(params, { pos_y: posY, align_y: alignY })
    if (frame !== null) Object.assign(params, { frame, frame_color: frameColor ?? '' })
    params.item_opacity = opacity ?? '1'
    params.draw = '1'
    for (let i = 16; i + 1 < args.length && !args[i].null; i += 2) {
      params[value(args[i], `${at} param`)] = value(args[i + 1], `${at} param value`)
    }
    if (elements[name]) throw new Error(`${at}: registered twice`)
    elements[name] = params
  }
}

// Newer than the clients the editor targets: scoremapname (master only),
// ammo text_color_* (3.6.7) and gun frame_hide (3.6.6).
delete elements.scoremapname
for (const [name, params] of Object.entries(elements)) {
  if (/^ammo\d?$/.test(name)) {
    delete params.text_color_low
    delete params.text_color_normal
  }
  if (/^gun\d?$/.test(name)) delete params.frame_hide
}

const sorted = Object.fromEntries(Object.keys(elements).sort().map((k) => [k, elements[k]]))
await writeFile(OUT, JSON.stringify({ source: `${REPO}@${commit}`, elements: sorted }, null, 2) + '\n')
console.log(`${Object.keys(sorted).length} elements from ${REPO}@${commit.slice(0, 10)} -> ${OUT}`)
