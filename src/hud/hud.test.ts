import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ELEMENTS } from './catalog'
import { lastValues, parseCfg, serializeCfg, splitCvar } from './cfg'
import { EZQUAKE_DEFAULTS, isUnezquakeElement, isUnezquakeParam, withDefaults } from './defaults'
import { IMPLS, implFor } from './elements'
import { decodePcx, decodeTga, decodeWad, unzip, zip } from '../render/decode'
import { CHARSET, CROSSHAIR, isHudPicture, texturePriority, texturePurpose } from '../render/textures'
import { builtinMask, builtinPixels, crosshairFromCvars } from '../render/crosshair'
import { clientIssues, findIssues, unusableResolution } from './issues'
import { checkEncoding } from './encoding'
import { keepInPlace, placeTree, unanchored } from './layout'
import { frameExtents, layoutHud, screenFor, shouldShow, viewRect, wouldCycle } from './layout'
import { DEFAULT_PREVIEW } from './preview'

const presets = join(__dirname, 'presets')
const nquake = readFileSync(join(presets, 'nquake-default.cfg'), 'latin1')
const screen = screenFor(960, 540, 100)
const sizer = (name: string, p: Record<string, string>) =>
  implFor(name).size(p, { preview: DEFAULT_PREVIEW, screenW: 960, screenH: 540 })

describe('cvar names', () => {
  it('matches element names containing underscores', () => {
    expect(splitCvar('hud_score_team_colorize')).toEqual({ element: 'score_team', param: 'colorize' })
    expect(splitCvar('hud_bar_health_color_normal')).toEqual({ element: 'bar_health', param: 'color_normal' })
    expect(splitCvar('hud_static_text_text')).toEqual({ element: 'static_text', param: 'text' })
    expect(splitCvar('hud_gun2_style')).toEqual({ element: 'gun2', param: 'style' })
    expect(splitCvar('hud_planmode')).toBeNull()
  })

  it('every element has an implementation', () => {
    expect(ELEMENTS.filter((e) => !IMPLS[e.name]).map((e) => e.name)).toEqual([])
  })
})

describe('cfg', () => {
  it('parses the nQuake default HUD', () => {
    const { doc, ignored } = parseCfg(nquake)
    expect(ignored).toBe(0)
    expect(Object.keys(doc.elements).length).toBe(82)
    expect(doc.elements.ammo1.place).toBe('gun2')
    expect(doc.globals.hud_planmode).toBe('0')
    expect(doc.globals.scr_newhud).toBe('1')
  })

  it('round-trips the nQuake default HUD byte for byte (ignoring header)', () => {
    const body = (s: string) => s.replace(/\r/g, '').split('\n').filter((l) => l && !l.startsWith('//'))
    expect(body(serializeCfg(parseCfg(nquake).doc))).toEqual(body(nquake))
  })

  it('drops non-HUD commands and handles comments, set and ;', () => {
    const { doc, ignored } = parseCfg('name "player"; bind x "+attack"\nset hud_fps_show 1 // fps\nhud_fps_place "top"')
    expect(ignored).toBe(2)
    expect(doc.elements.fps).toEqual({ show: '1', place: 'top' })
  })

  it('drops cvars of other client versions and reads vid_conwidth', () => {
    const r = parseCfg(readFileSync(join(presets, 'carapace.cfg'), 'latin1'))
    expect(r.dropped).toContain('hud_mp3_title_width')
    expect(r.dropped).toContain('hud_mouserate_show')
    expect(r.dropped).toContain('hud_fps_decimals')
    expect(r.doc.elements).not.toHaveProperty('mp3_title')
    expect(r.doc.globals).not.toHaveProperty('hud_mp3_title_width')
    expect(r.client).toEqual({ conwidth: 560, conheight: 350 })

    const old = parseCfg('hud_group1_tile "1"\nhud_group1_alpha "0.5"\nhud_gun2_frame_hide "1"\nhud_group1_width "10"')
    expect(old.dropped).toEqual(['hud_group1_tile', 'hud_group1_alpha', 'hud_gun2_frame_hide'])
    expect(old.doc.elements).toEqual({ group1: { width: '10' } })
  })

  it('parses every ezQuake sample HUD', () => {
    for (const f of readdirSync(presets)) {
      const { doc } = parseCfg(readFileSync(join(presets, f), 'latin1'))
      expect(Object.keys(doc.elements).length, f).toBeGreaterThan(0)
    }
  })
})

describe('layout', () => {
  it('computes frame padding like HUD_CalcFrameExtents', () => {
    expect(frameExtents(0.5, 20, 20, false)).toEqual({ l: 4, r: 4, t: 4, b: 4 })
    expect(frameExtents(0.5, 20, 20, true)).toEqual({ l: 0, r: 0, t: 0, b: 0 })
    expect(frameExtents(2, 20, 10, true)).toEqual({ l: 10, t: 9, r: 10, b: 9 })
  })

  it('anchors a child after its parent', () => {
    const doc = {
      globals: {},
      elements: {
        face: { show: '1', place: 'screen', align_x: 'center', align_y: 'bottom', pos_x: '0', pos_y: '0', scale: '1' },
        health: { show: '1', place: 'face', align_x: 'after', align_y: 'center', pos_x: '3', pos_y: '0', style: '0', digits: '3' },
      },
    }
    const placed = layoutHud(doc, screen, sizer)
    expect(placed.get('face')!.outer).toEqual({ x: 468, y: 516, w: 24, h: 24 })
    expect(placed.get('health')!.outer).toEqual({ x: 495, y: 516, w: 72, h: 24 })
  })

  it('drops both elements of a placement loop, as in game', () => {
    const doc = {
      globals: {},
      elements: {
        fps: { show: '1', place: 'ping' },
        ping: { show: '1', place: 'fps' },
      },
    }
    expect(layoutHud(doc, screen, sizer).size).toBe(0)
    expect(wouldCycle(doc, 'fps', 'ping')).toBe(true)
  })

  it('lays out the nQuake default HUD', () => {
    const { doc } = parseCfg(nquake)
    const placed = layoutHud(doc, screen, sizer)
    expect(placed.size).toBeGreaterThan(30)
    for (const p of placed.values()) expect(Number.isFinite(p.outer.x + p.outer.y), p.name).toBe(true)
  })
})

describe('ezQuake defaults', () => {
  it('cover exactly the catalogue elements', () => {
    expect(Object.keys(EZQUAKE_DEFAULTS).sort()).toEqual(ELEMENTS.map((e) => e.name).sort())
  })

  it('give every element the common cvars', () => {
    const common = ['show', 'place', 'align_x', 'align_y', 'pos_x', 'pos_y', 'order', 'item_opacity', 'draw']
    for (const [name, p] of Object.entries(EZQUAKE_DEFAULTS)) {
      for (const k of common) expect(p[k], `${name}.${k}`).toBeDefined()
    }
    expect(EZQUAKE_DEFAULTS.face).toMatchObject({ show: '1', place: 'screen', align_x: 'center', align_y: 'bottom' })
    expect(EZQUAKE_DEFAULTS.speed.color_stopped).toBe('52') // resolved from a #define
  })

  it('fill cvars a partial cfg leaves out, keeping the cfg values', () => {
    const doc = withDefaults(parseCfg('hud_health_pos_x "10"').doc)
    expect(doc.elements.health).toMatchObject({ pos_x: '10', place: 'face', align_x: 'after', style: '0' })
    expect(Object.keys(doc.elements).length).toBe(Object.keys(EZQUAKE_DEFAULTS).length)
  })

  // A shown element may only be missing because its parent is (hidden parents hide children in game too).
  it('let every shown element of every sample preset be placed, unless its parent is hidden', () => {
    for (const f of readdirSync(presets)) {
      const doc = withDefaults(parseCfg(readFileSync(join(presets, f), 'latin1')).doc)
      const placed = layoutHud(doc, screen, sizer)
      const missing = Object.entries(doc.elements)
        .filter(([name, p]) => shouldShow(p.show) && !placed.has(name))
        .filter(([, p]) => {
          const parent = (p.place ?? '').replace(/^@/, '')
          return !doc.elements[parent] || placed.has(parent)
        })
        .map(([name, p]) => `${name} (place ${p.place})`)
      expect(missing, f).toEqual([])
    }
  })
})

describe('issues', () => {
  const issuesOf = (elements: Record<string, Record<string, string>>) => {
    const doc = withDefaults({ globals: {}, elements })
    for (const [name, p] of Object.entries(doc.elements)) if (!elements[name]) p.show = '0'
    return findIssues(doc, layoutHud(doc, screen, sizer), screen)
  }

  it('reports off-screen, cut-off and invalid values', () => {
    const issues = issuesOf({
      fps: { show: '1', place: 'screen', align_x: 'right', pos_x: '200' },
      ping: { show: '1', place: 'screen', align_x: 'right', pos_x: '20' },
      clock: { show: '1', place: 'center', align_x: 'top', align_y: 'left' },
    })
    // align_x "top" and align_y "left" fall back to left and top, which is where they put it anyway: only info.
    expect(issues.map((i) => `${i.element} ${i.severity}`)).toEqual([
      'clock warning',
      'clock info',
      'clock info',
      'fps error',
      'ping warning',
    ])
  })

  it('warns about invalid aligns that move the element', () => {
    const issues = issuesOf({ clock: { show: '1', align_x: 'bottom', align_y: 'right' } })
    expect(issues.map((i) => `${i.severity} ${i.message}`)).toEqual([
      'warning align_x "bottom" is not valid: the game uses "left".',
      'warning align_y "right" is not valid: the game uses "top".',
    ])
  })

  it('reports elements hidden by their parent', () => {
    const issues = issuesOf({ face: { show: '0' }, health: { show: '1', place: 'face' } })
    expect(issues).toEqual([{ element: 'health', severity: 'warning', message: 'Not drawn: it is placed on face, which is hidden.', params: ['place'] }])
  })

  it('grows a group to its picture with pic_scalemode 3', () => {
    expect(sizer('group1', { width: '32', height: '32', picture: 'Clock', pic_scalemode: '3' })).toEqual({ w: 128, h: 128 })
    expect(sizer('group1', { width: '32', height: '32', picture: 'clock', pic_scalemode: '2' })).toEqual({ w: 32, h: 32 })
  })
})

describe('client settings', () => {
  it('reads them from a cfg and writes them on request', () => {
    const r = parseCfg('vid_width "1920"\nvid_height 1200\nvid_conscale "2"\nvid_conwidth 640\nvid_conheight 480\nviewsize 110\nhud_fps_show 1')
    expect(r.client).toEqual({ width: 1920, height: 1200, conscale: 2, conwidth: 640, conheight: 480, viewsize: 110 })
    expect(r.ignored).toBe(0)
    const client = { width: 1920, height: 1200, conscale: 2, conwidth: 640, conheight: 480, viewsize: 110 }
    const out = serializeCfg(r.doc, { client, date: new Date(2026, 10, 2, 9, 5) })
    expect(out).toContain('// Generated by QuakeWorld HUD Editor on 2026-11-02 09:05')
    expect(parseCfg(out).client).toEqual(client)
    expect(serializeCfg(r.doc)).not.toContain('vid_width')
  })
})

describe('texture decoding', () => {
  it('decodes a bottom-up 24-bit TGA', () => {
    const tga = new Uint8Array([0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 2, 0, 24, 0, 1, 2, 3, 4, 5, 6])
    const img = decodeTga(tga)
    expect([img.w, img.h]).toEqual([1, 2])
    expect([...img.data]).toEqual([6, 5, 4, 255, 3, 2, 1, 255]) // last row in the file is the top row
  })

  it('reads qpic lumps from a WAD2', () => {
    const pic = [2, 0, 0, 0, 1, 0, 0, 0, 0, 255] // 2×1: palette 0, transparent
    const head = [...'WAD2'].map((c) => c.charCodeAt(0)).concat([1, 0, 0, 0, 12 + pic.length, 0, 0, 0])
    const entry = [12, 0, 0, 0, pic.length, 0, 0, 0, pic.length, 0, 0, 0, 0x42, 0, 0, 0, ...[...'NUM_0'].map((c) => c.charCodeAt(0)), ...Array(11).fill(0)]
    const [lump] = decodeWad(new Uint8Array([...head, ...pic, ...entry]))
    expect(lump.name).toBe('num_0')
    expect([...lump.image.data]).toEqual([0, 0, 0, 255, ...lump.image.data.slice(4, 7), 0])
  })
})

describe('texture priority', () => {
  it('prefers what ezQuake loads: textures/wad before gfx, then tga, png, jpg', () => {
    const order = ['gfx/num_0.tga', 'num_0.png', 'textures/wad/num_0.png', 'textures/wad/num_0.tga', 'num_0.jpg', 'gfx/num_0.png']
    expect([...order].sort((a, b) => texturePriority(a) - texturePriority(b))).toEqual([
      'textures/wad/num_0.tga',
      'textures/wad/num_0.png',
      'gfx/num_0.tga',
      'gfx/num_0.png',
      'num_0.png',
      'num_0.jpg',
    ])
  })
})

describe('viewsize', () => {
  it('keeps the view full screen from 100 up, and shrinks and centres it above the status bar below', () => {
    expect(viewRect(640, 480, 100)).toEqual({ x: 0, y: 0, w: 640, h: 480 })
    expect(viewRect(640, 480, 50)).toEqual({ x: 160, y: 96, w: 320, h: 240 })
    expect(viewRect(640, 480, 10)).toEqual(viewRect(640, 480, 30)) // bound to 30
  })
})

describe('formatted elements', () => {
  const ctx = { preview: DEFAULT_PREVIEW, screenW: 640, screenH: 480 }
  const size = (name: string, params: Record<string, string>) => implFor(name).size({ ...EZQUAKE_DEFAULTS[name], ...params }, ctx)

  it('sizes teaminfo from its layout', () => {
    // "%p%n $x10%l$x11 %a/%H %w": powerups 3, name 6, space, [, loc 5, ], space, armor 3, /, health 3, space, weapon icon 2 = 28
    expect(size('teaminfo', {})).toEqual({ w: 28 * 8, h: 4 * 8 })
    expect(size('teaminfo', { weapon_style: '1', show_ammo: '1' })!.w).toBe((28 - 2 + 3 + 4) * 8)
  })

  it('sizes score_bar from format_small and format_big', () => {
    // "&c69f%T&r:%t &cf10%E&r:%e $[%D$]" -> "red:54 blue:37 [+17]"
    expect(size('score_bar', {})).toEqual({ w: 20 * 8, h: 8 })
    // "%t:%e:%Z" -> 54:37:c17r, six digits and two colons
    expect(size('score_bar', { style: '1' })).toEqual({ w: 6 * 24 + 2 * 16, h: 24 })
  })

  it('fills in the weaponstats format', () => {
    // "&c990sg&r:%2 &c099ssg&r:%3 &c900rl&r:#7 &c009lg&r:%8" -> "sg:45.2 ssg:30.0 rl:12 lg:33.1"
    expect(size('weaponstats', {})).toEqual({ w: 30 * 8, h: 8 })
  })
})

describe('settings in a cfg', () => {
  it('reads viewsize, bound to 30..120 as in game', () => {
    expect(parseCfg('viewsize "95"').client.viewsize).toBe(95)
    expect(parseCfg('viewsize 200').client.viewsize).toBe(120)
    expect(viewRect(640, 360, 99)).toEqual({ x: 3, y: 0, w: 633, h: 312 })
  })

  it('marks negative values as invalid, except where ezQuake takes them', () => {
    const doc = withDefaults(parseCfg('hud_ammo_show 1\nhud_ammo_pos_x -20\nhud_ammo_digits -2\nhud_ammo_scale -1').doc)
    expect(findIssues(doc, layoutHud(doc, screen, (n, p) => implFor(n).size(p, { preview: DEFAULT_PREVIEW, screenW: 960, screenH: 540 })), screen)
      .filter((i) => /negative/.test(i.message))
      .map((i) => i.message)
      .sort()).toEqual(["digits can't be negative.", "scale can't be negative."])
  })
})

describe('import setup', () => {
  it('reads the last value of loadcharset and the crosshair cvars', () => {
    const v = lastValues('loadcharset povo5\nseta crosshairimage "cross1" // mine\ncrosshairsize 2; crosshairsize 0.5\nhud_clock_show 1')
    expect(v).toMatchObject({ loadcharset: 'povo5', crosshairimage: 'cross1', crosshairsize: '0.5' })
    // Keys follow their last line: here gl_consolefont is set after loadcharset.
    const keys = Object.keys(lastValues('gl_consolefont a\nloadcharset b\ngl_consolefont c'))
    expect(keys).toEqual(['loadcharset', 'gl_consolefont'])
  })

  it('decodes an 8-bit RLE PCX, with index 255 transparent', () => {
    // 2x1 image: colour 1, then colour 255 (written as a run of one, since it is above 0xbf), then the palette.
    const head = new Uint8Array(128)
    head.set([0x0a, 5, 1, 8])
    head.set([1, 0], 8) // xmax 1 -> width 2
    head.set([2, 0], 66) // bytes per line
    const palette = new Uint8Array(768)
    palette.set([10, 20, 30], 3) // colour 1
    const pcx = new Uint8Array([...head, 0x01, 0xc1, 0xff, 0x0c, ...palette])
    const img = decodePcx(pcx)
    expect([img.w, img.h]).toEqual([2, 1])
    expect([...img.data]).toEqual([10, 20, 30, 255, 0, 0, 0, 0])
  })
})

describe('crosshair', () => {
  it('reads the crosshair cvars, with ezQuake defaults for the rest', () => {
    expect(crosshairFromCvars({ crosshair: '2', crosshairsize: '50', crosshairscale: '1.7' })).toEqual({
      crosshair: 2, size: 20, color: '255 0 0', alpha: 1, scale: 1, scalemethod: 0,
    })
  })

  it('builds the built-in shapes like CreateBuiltinCrosshair', () => {
    const at = (mask: boolean[], size: number) => mask.flatMap((on, i) => (on ? [[i % size, Math.floor(i / size)]] : []))
    expect(builtinPixels(0)).toBe(8)
    expect(at(builtinMask(4, 8), 8)).toEqual([[3, 3]]) // dot
    expect(at(builtinMask(3, 8), 8)).toHaveLength(5) // small cross: centre plus one each way
    expect(at(builtinMask(2, 8), 8)).toHaveLength(8) // stipple: every other pixel down and across column/row 3
  })
})

describe('cfg encoding', () => {
  const bytes = (s: string) => new Uint8Array([...s].map((c) => c.charCodeAt(0)))
  const utf8 = (s: string) => new TextEncoder().encode(s)

  it('leaves plain and Quake-byte cfgs alone', () => {
    expect(checkEncoding(bytes('hud_clock_show "1"\nhud_score_bar_format_small "$[%D$]"\n'))).toBeNull()
    expect(checkEncoding(bytes('hud_group1_name "\xe8\xe5\xec\xec\xef"\n'))).toBeNull() // brown "hello"
  })

  it('finds UTF-8 in HUD lines and turns it back into Quake bytes', () => {
    const issue = checkEncoding(utf8('name "é"\nhud_group1_name "èå"\n'))
    expect(issue?.kind).toBe('utf8')
    expect(issue?.cvars).toEqual(['hud_group1_name'])
    expect(issue?.fixed).toBe('name "\xe9"\nhud_group1_name "\xe8\xe5"\n')
  })

  it('ignores UTF-8 outside HUD lines', () => {
    expect(checkEncoding(utf8('name "é"\nhud_clock_show 1\n'))).toBeNull()
  })

  it('reports a BOM before a HUD cvar, and UTF-16', () => {
    expect(checkEncoding(new Uint8Array([0xef, 0xbb, 0xbf, ...bytes('hud_clock_show 1\n')]))).toMatchObject({ kind: 'bom', cvars: ['hud_clock_show'] })
    const u16 = new Uint8Array([0xff, 0xfe, ...[...'hud_clock_show 1\n'].flatMap((c) => [c.charCodeAt(0), 0])])
    expect(checkEncoding(u16)).toMatchObject({ kind: 'utf16', fixed: 'hud_clock_show 1\n' })
  })
})

describe('place tree', () => {
  it('lists each element once, under the one it is placed on', () => {
    const doc = { globals: {}, elements: { face: { place: 'screen' }, armor: { place: 'face' }, iarmor: { place: 'armor' }, health: { place: '@face' }, a: { place: 'b' }, b: { place: 'a' } } }
    expect(placeTree(doc, ['face', 'armor', 'iarmor', 'health', 'a', 'b'])).toEqual([
      { name: 'face', depth: 0 },
      { name: 'armor', depth: 1 },
      { name: 'iarmor', depth: 2 },
      { name: 'health', depth: 1 },
      { name: 'a', depth: 0 },
      { name: 'b', depth: 1 },
    ])
  })
})

describe('unezquake', () => {
  it('has totalstrength and mapvote, and the armor text colours', () => {
    expect(isUnezquakeElement('totalstrength') && isUnezquakeElement('mapvote')).toBe(true)
    expect(isUnezquakeParam('armor', 'text_color_ra_low')).toBe(true)
    expect(isUnezquakeParam('armor', 'style')).toBe(false)
    const { doc } = parseCfg('hud_totalstrength_show 1\nhud_mapvote_scale 2\nhud_armor_text_color_ra_normal "255 0 0"\n')
    expect(doc.elements.totalstrength).toEqual({ show: '1' })
    expect(doc.elements.armor).toEqual({ text_color_ra_normal: '255 0 0' })
  })

  it('sizes total strength like the other numbers, and the map vote box', () => {
    const ctx = { preview: DEFAULT_PREVIEW, screenW: 640, screenH: 480 }
    expect(implFor('totalstrength').size(EZQUAKE_DEFAULTS.totalstrength, ctx)).toEqual({ w: 72, h: 24 })
    expect(implFor('mapvote').size(EZQUAKE_DEFAULTS.mapvote, ctx)).toEqual({ w: 208, h: 132 })
  })
})

describe('stage edits', () => {
  const doc = withDefaults(parseCfg(nquake).doc)
  const box = (d: typeof doc, name: string) => layoutHud(d, screen, sizer).get(name)!.outer

  it('keeps the fixed corner where it was after a new scale', () => {
    const before = box(doc, 'armor')
    const changes = keepInPlace(doc, screen, sizer, 'armor', { scale: '2' }, 'br')
    const after = box({ ...doc, elements: { ...doc.elements, armor: { ...doc.elements.armor, ...changes } } }, 'armor')
    expect(after.w).toBe(before.w * 2)
    expect([after.x + after.w, after.y + after.h]).toEqual([before.x + before.w, before.y + before.h])
  })

  it('unanchors to the screen without moving, aligned to the nearest edge', () => {
    const before = box(doc, 'armor')
    const changes = unanchored(doc, screen, sizer, 'armor')
    expect(changes).toMatchObject({ place: 'screen', align_x: 'center', align_y: 'bottom' })
    const after = box({ ...doc, elements: { ...doc.elements, armor: { ...doc.elements.armor, ...changes } } }, 'armor')
    expect([after.x, after.y]).toEqual([before.x, before.y])
  })
})

describe('client settings', () => {
  const ok = { width: 1920, height: 1080, conscale: 2, conwidth: 0, conheight: 0, viewsize: 100 }

  it('leaves out a 0 or too small resolution from a cfg', () => {
    expect(unusableResolution({ width: 0, height: 0 })).toBe(true)
    expect(unusableResolution({ width: 100 })).toBe(true)
    expect(unusableResolution({ width: 1920, height: 1080 })).toBe(false)
    expect(unusableResolution({ conscale: 2 })).toBe(false)
  })

  it('lists odd resolutions and virtual sizes', () => {
    expect(clientIssues(ok, null)).toEqual([])
    expect(clientIssues(ok, { width: 0, height: 0 })[0].message).toMatch(/desktop resolution/)
    expect(clientIssues({ ...ok, width: 1920, height: 200 }, null).map((i) => i.cvar)).toEqual(['vid_width'])
    expect(clientIssues({ ...ok, conwidth: 4000 }, null)[0].fix?.settings).toEqual({ conwidth: 1920 })
    expect(clientIssues({ ...ok, conscale: 0 }, null).map((i) => i.cvar)).toEqual(['vid_conscale'])
  })
})

describe('zip', () => {
  it('reads back what it writes', async () => {
    const files = [
      { path: 'myhud.cfg', data: new TextEncoder().encode('hud_recalculate') },
      { path: 'textures/wad/num_0.png', data: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]) },
    ]
    const back = await unzip(new Uint8Array(await zip(files).arrayBuffer()))
    expect(back.map((f) => [f.path, [...f.data]])).toEqual(files.map((f) => [f.path, [...f.data]]))
  })
})

describe('which textures are loaded', () => {
  it('knows every picture the editor draws, and no menu graphics', () => {
    const own = readdirSync(join(__dirname, '../../public/assets/wad')).map((f) => f.replace(/[.][^.]+$/, ''))
    expect(own.filter((n) => !isHudPicture(n))).toEqual([])
    const menu = ['bigbox', 'box_tl', 'complete', 'conback', 'cursor', 'finale', 'inter', 'loading', 'mainmenu', 'menudot1', 'mp_menu', 'p_option', 'pause', 'qplaque', 'ranking', 'sp_menu', 'ttl_main', 'vidmodes', 'flags', 'conchars']
    expect(menu.filter(isHudPicture)).toEqual([])
  })

  it('takes from folders only HUD pictures, the charset, the crosshair and group pictures', () => {
    expect(texturePurpose('qw/gfx/conback.png', true)).toBeNull()
    expect(texturePurpose('qw/gfx/mainmenu.png', true)).toBeNull()
    expect(texturePurpose('qw/textures/wad/num_0.tga', true)).toBe('num_0')
    expect(texturePurpose('qw/textures/charsets/povo5.png', true)).toBe(CHARSET)
    expect(texturePurpose('qw/crosshairs/dot.png', true)).toBe(CROSSHAIR)
    expect(texturePurpose('qw/gfx/logo.png', true)).toBeNull()
    expect(texturePurpose('qw/gfx/logo.png', true, new Set(['logo']))).toBe('logo')
  })

  it('takes a file dropped on its own by its name', () => {
    expect(texturePurpose('mycrosshair.png', false)).toBe(CROSSHAIR)
    expect(texturePurpose('charset-big.png', false)).toBe(CHARSET)
    expect(texturePurpose('logo.png', false)).toBe('logo')
    expect(texturePurpose('conback.png', false)).toBeNull()
  })
})
