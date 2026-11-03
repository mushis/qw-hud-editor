# QuakeWorld HUD Editor

Drag-and-drop editor for the ezQuake HUD (`scr_newhud 1`). Import your HUD cfg,
move elements around on top of a game screenshot, export a cfg you can `exec`.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design.

```sh
npm install
npm run dev           # editor at http://localhost:5173
npm test              # unit tests (cfg parser, layout engine)
npm run build         # static site in dist/
npm run fetch-assets  # re-download HUD textures, charset and presets from nQuake
npm run gen-defaults  # regenerate src/hud/ezquake-defaults.json from ezQuake source
```

Game graphics, the charset and the sample HUD configs come from
[nQuake distfiles](https://github.com/nQuake/distfiles). The layout logic is a
port of [ezQuake](https://github.com/QW-Group/ezquake-source)'s HUD code. The map
backgrounds are from [quake-mapshots](https://github.com/vikpe/quake-mapshots) (MIT).

License: GPL-2.0-or-later.
