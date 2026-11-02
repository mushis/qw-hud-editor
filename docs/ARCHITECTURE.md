# QuakeWorld Web HUD Editor: Architecture

A browser-based drag-and-drop editor for the ezQuake "new HUD" (`scr_newhud 1`).
It plays the role that [visualHUD](https://namad.github.io/visualHUD/) plays for Quake Live.
It loads and saves the HUD as plain ezQuake cvars (`hud_<element>_<property> "value"`).

## Decisions

| # | Decision | Notes |
|---|----------|-------|
| 1 | **Target client: ezQuake only** | FTE and fodquake have different HUD systems and are out of scope. |
| 2 | **Static single-page app, no backend** | Built with TypeScript, Vite and React. Import, export and persistence all happen in the browser. Hosted on GitHub Pages and deployed by a GitHub Action. |
| 3 | **The cvars are the source of truth** | The store holds `Record<element, Record<param, string>>`, exactly as written in the cfg. Positions and sizes are always derived, never stored, which keeps cfg round-trips lossless. |
| 4 | **The layout engine is a port of ezQuake's `HUD_PrepareDraw`** | It covers `place`, `align_x`/`align_y`, `pos_x`/`pos_y`, frame padding, the parent-before-child order, and `order` (z-order). Behaviour must match the client, including integer maths and the case where a placement loop makes elements disappear. |
| 5 | **Dragging edits `pos_x`/`pos_y` only** | The anchor stays as it is. Re-anchoring (`place` and `align`) is a separate explicit action, like Ctrl-drag and Alt-drag in the in-game editor. The editor refuses to create placement loops. |
| 6 | **One definition per element** | Each definition holds the category, conditions, parameter schema (type, allowed values, default), a size function and a draw function. The properties panel and the palette are generated from these definitions. |
| 7 | **Preview state (like `hud_planmode`)** | Fake values for health, armor, ammo, weapons, powerups, players, ping and fps drive element sizes and drawing. You can adjust them with sliders. |
| 8 | **One canvas plus a view mode** | Modes are player, spectator and demo. Elements that are only valid in other modes are hidden or dimmed. There is no separate palette for spectator elements. |
| 9 | **Rendering: Canvas 2D at the real screen resolution** | Virtual units (conwidth × conheight) are multiplied by `screen / conwidth`, as the GL renderer does. Selection handles and guides sit in a separate overlay layer. |
| 10 | **Assets come from nQuake distfiles** | These are the HUD textures in `qw/textures/wad`, the charsets (`povo5` is nQuake's default) and the sample HUD cfgs used as presets and test fixtures. `scripts/fetch-assets.mjs` downloads them and converts TGA files to PNG. The results are committed to `public/assets/`, so the build never needs the network. |
| 11 | **Default resolution** | 1920×1080 with `vid_conscale 2`, so the virtual HUD is 960×540, the same as stock nQuake. `viewsize` defaults to 100, which sets `sb_lines` to 48 for the `sbar`, `ibar` and `hbar` areas. |
| 12 | **Import keeps HUD cvars only** | Import reads `hud_*` cvars and `scr_newhud` and drops everything else. Export writes the ezQuake `DumpHUD` format (sorted, padded, ending with `hud_recalculate`). |
| 12b | **Missing cvars get ezQuake defaults** | `scripts/gen-hud-defaults.mjs` reads every `HUD_Register` call in ezQuake's source and writes `src/hud/ezquake-defaults.json`, which records the source commit. Cvars newer than the clients we target are left out: `scoremapname` (master only), ammo `text_color_*` (3.6.7) and gun `frame_hide` (3.6.6). Each loaded cfg (import, preset, saved state) is merged over these defaults, the same as exec'ing it on a fresh client. Export writes the full set. The inspector highlights values that differ from the defaults and can reset them. |
| 12c | **Cvars ezQuake doesn't register are dropped** | The defaults table is the list of valid cvars. Old elements (`mp3_title`, `mouserate`) and old settings (`hud_group1_tile`, `hud_fps_decimals`) are dropped on import, and from saved state, and the import message lists them. |
| 12d | **`vid_conwidth`/`vid_conheight`** | Read from an imported cfg and editable in the toolbar; 0 means derived from conscale. If their aspect ratio differs from the window's, the HUD is stretched on each axis separately, as in game. |
| 12e | **Property editors** | Colours get a swatch, the system colour picker, an alpha slider (RGBA bar colours) and preset swatches. The speed bar colours are Quake palette indexes and get a palette grid; the palette is extracted from the shareware `pak0.pak`. Numbers get ▲▼ steppers (0.05 for scale/opacity/frame, otherwise 1; Shift = ×10). `item_opacity` and `pic_alpha` get a 0–1 slider, `scale` a 0–3 slider; the box beside it takes any value. |
| 12f | **`proportional 1`** | Text and big numbers are drawn with Arial instead of the charset / `num_*` digits. |
| 12g | **Group pictures** | `hud_group<N>_picture` loads `gfx/<name>` in game. The editor ships the pictures the presets use (`src/assets/gfx`, sizes in `src/hud/pictures.ts`) and ports all five `pic_scalemode`s; any other picture gets a placeholder and an issue. |
| 12h | **Issues panel** | Lists enabled elements that won't look as intended: off-screen (error, plus a marker on the screen edge), cut off (warning, red outline), hidden by a hidden parent, in a placement loop, an invalid `place`/`align_*` (the game falls back silently), or a group picture the editor lacks. |
| 12i | **Client settings travel with the HUD** | Resolution, `vid_conscale`, `vid_conwidth`/`vid_conheight` and `viewsize` form their own toolbar group. They are read from any loaded cfg; a cfg without con size resets it to auto, because con size belongs to the HUD it came with. Export writes them only when "export" is ticked; saved HUDs always include them. |
| 12j | **Everything loads through one path** | Import, drop, presets, the empty preset and saved HUDs all go through `importCfg` (`src/editor/actions.ts`): the cfg is applied over the ezQuake defaults, so nothing leaks from the previous HUD. |
| 12k | **Custom textures stay in the browser** | Dropped textures (images, `gfx.wad` qpic lumps and conchars, zip/pk3) are PNG blobs in IndexedDB, keyed by name, replacing built-ins. |
| 12l | **Shared HUD gallery on Supabase** | Replaces per-browser saves. Anyone shares without an account and it is public at once; authors own their HUDs through a per-browser secret (recovery code); the admin signs in by e-mail link. The database enforces all of it (`supabase/migrations`); the site stays static. Details: `docs/SHARED-HUDS.md`. |
| 13 | **License: GPL v2 or later** | Matches ezQuake, because the layout engine is a port of its code. |
| 14 | **Undo and persistence** | Undo/redo is a stack of whole-store states (the store is small). Each edit is also saved to the browser's localStorage. A share link (compressed state in the URL hash) comes later. |

## Positioning model (ported from `hud.c`)

```
area   = place is screen-area ? bounds(place) : parent box
         (parent content box for "@name", parent box including its frame for "name")
x      = left|center|right|before|after  against area   + pos_x
y      = top|center|bottom|before|after|console against area + pos_y
frame  = 0 none | (0,1] filled rect, alpha = frame | 2 text box (8px border)
```

- **Screen areas** (W×H is conwidth×conheight; `sb_lines` comes from `viewsize`):
  - `screen` and `top`
  - `view`
  - `sbar`, `ibar` and `hbar`, which are 320 wide
  - `sfree`, `ifree` and `hfree`, which run from x = 320 to the right edge
- **An unknown `place`** falls back to `screen`. Element names in `place` are case-sensitive.
- **`pos_*` units:** these are virtual pixels and are not multiplied by `scale`.
- **`show`/`draw`:**
  - 0 = off, 1 = on, 2 = single-player only, 3 = multiplayer only.
  - `draw 0` keeps the element positioned, so elements placed on it still work, but renders nothing.

## Element name parsing

Element names can contain `_` (`score_team`, `bar_health`, `static_text`, `qtv_buffer`).
A cvar is matched against the known element names, longest name first: `hud_<name>_<param>`.
Global cvars stay global: `hud_planmode`, `hud_digits_trim`, `hud_tp_need`, `hud_editor_*`, `hud_sortrules_*` and `hud_name_remove_prefixes`.

## Code layout

```
src/
  hud/
    catalog.ts      element definitions (category, conditions, params)
    cfg.ts          parse and serialize ezQuake cfg
    layout.ts       port of HUD_PrepareDraw and the draw order
    preview.ts      fake game state (planmode-like)
    elements/       size and draw function per element family
  render/           canvas renderer, asset loader, charset text, digits
  editor/           React UI: canvas stage, palette, inspector, toolbar
  store.ts          state, undo/redo, persistence
public/assets/      nQuake textures (converted to PNG), charsets, backgrounds
scripts/            asset fetch and convert
```

## v1 scope

- **Drawn exactly:**
  - face, health, armor, ammo and ammo1–4
  - iarmor and iammo
  - gun and gun2–8
  - keys, powerups and sigils
  - clocks, fps, ping and other text elements
  - bar_health, bar_armor, speed and groups
- **Drawn as approximate mock-ups at plausible sizes:** frags, teamfrags, teaminfo, radar, tracker, netgraph, notify, centerprint, gamesummary and the teamhold elements.
