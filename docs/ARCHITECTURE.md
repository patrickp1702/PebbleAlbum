# PebbleAlbum — Architecture

This document describes how PebbleAlbum is structured so that humans and AI
agents can navigate, extend, and reason about the codebase confidently.

> **For the module-by-module reference, the dependency map, and the load-bearing
> invariants, see [`MODULES.md`](MODULES.md).** Read it before editing core logic
> in `engine/`, `stores/`, or `components/canvas/` — several behaviours are
> deliberate bug fixes flagged `⚠ INVARIANT` in code and in that doc.

> ⭐ **MCP Tool-Parity Rule (mandatory).** PebbleAlbum is drivable by AI agents
> through a built-in MCP server. **Every capability a user can perform in the UI
> must be exposed as an MCP tool, and every new feature must ship its MCP tool in
> the same change.** The agent is a first-class editor of the album, equal to the
> GUI. See §12 and [`MCP.md`](MCP.md) for the full concept + per-feature checklist.

### Editor layout (current)

The editor is organised so per-page editing and album-wide config never collide:

- **Left** — page strip (thumbnails, reorder, right-click menu, active highlight).
- **Center** — interactive Fabric canvas; a fullscreen page-curl **Preview** overlay.
- **Right** — **per-page** editing (`PagePanel`, tabs: Layers / Layout / Design /
  Proverb / Page), or the selected object's properties (`PropertiesPanel`, with a
  Back button).
- **Bottom** — **album-wide** config only: Images (browse all) and Themes.

---

## 1. High-level model

PebbleAlbum is a two-process Electron app:

```
┌──────────────────────────── Renderer (Chromium) ────────────────────────────┐
│  Vue 3 + Pinia + Vue Router                                                  │
│   Views: Welcome → Setup → Editor → Export                                   │
│   Engine (pure TS): parser, layoutSelector, collageComposer, decoEngine,     │
│                     proverbSelector, themeEngine, albumGenerator,            │
│                     exportEngine, pageRenderer (Fabric), fabricFilters       │
│   Canvas: Fabric.js (interactive) + Three.js (page-turn preview)             │
└───────────────▲──────────────────────────────────────────────┬─────────────┘
                │  window.pebble.* (contextBridge, typed)        │
                │  (preload.ts exposes a safe API)               │
┌───────────────┴──────────────────────────────────────────────▼─────────────┐
│                          Main process (Node)                                 │
│   IPC handlers: folder·image·thumbnail·project·export·analyze·files·ai·app   │
│   Native: fs, dialog, shell, Sharp (thumbnails/EXIF/resizing), PDFKit (PDF)  │
└──────────────────────────────────────────────────────────────────────────────┘
```

**Key principle:** all file-system and native work happens in the main process.
The renderer is sandboxed and only talks through the typed `window.pebble` bridge.

**Third client — AI (out of process):** a standalone MCP server
(`mcp/pebble-mcp-server.mjs`, launched by an external agent over stdio) edits the
**same `.pebble` files** the app reads. It is a peer editor of the album model, not
a plugin of the renderer. Per the parity rule it exposes every user capability as a
tool, and renders low-cost JPEG previews with Sharp so the agent can see its work.
See §12.

```
   GUI (renderer)  ─┐
                    ├─▶  ~/Documents/Pebble/*.pebble  ◀─ MCP server (AI agent, stdio)
   main process  ──┘        (single source of truth)
```

---

## 2. Directory map

| Path | Responsibility |
|---|---|
| `electron/main.ts` | BrowserWindow, lifecycle, registers IPC, `app:*` handlers |
| `electron/preload.ts` | `contextBridge` → typed `window.pebble` API |
| `electron/ipc/folder.ipc.ts` | Folder picker, recursive image listing, folder watching |
| `electron/ipc/image.ipc.ts` | Read image → base64 data URL, EXIF subset |
| `electron/ipc/thumbnail.ipc.ts` | Sharp thumbnails with mtime-keyed cache |
| `electron/ipc/project.ipc.ts` | `.pebble` load/save/autosave, `.bak`, recents |
| `electron/ipc/export.ipc.ts` | PDF (PDFKit) + JPEG/PNG sequence (Sharp), progress |
| `electron/ipc/ai.ipc.ts` | Builds the MCP connect config JSON + starter prompt (`getMcpConnectInfo`) |
| `mcp/pebble-mcp-server.mjs` | Standalone MCP server (the AI tool surface; edits `.pebble` directly) |
| `mcp/skills/*.md` | Skill docs the agent reads (overview, workflow, labels, catalogs, tools) |
| `assets/overlays/*.svg` · `assets/sticker/*.svg` | Themeable + colour SVG art (inlined at build via Vite `?raw`) |
| `src/views/*` | Top-level screens (album: Welcome/Setup/Editor/Export; quick tools: `CollageView` `/collage`, `PixartView` `/pixart`, `DuplicateFinderView`, `FolderDupView`) |
| `src/composables/*` | Shared UI orchestration over the stores — `useAddPhoto` (the one ＋ Add photo, used by PagePanel + PixartView) |
| `src/components/canvas/*` | `AlbumCanvas` (Fabric), `PageTurnScene` (Three), `CanvasOverlay` |
| `src/components/editor/*` | PageStrip, PagePanel, PropertiesPanel, **TextPropertiesPanel**, **AiConnectModal**, Layout/Theme/Decoration/Proverb panels, ImageStrip |
| `src/components/setup/*` | The six wizard steps |
| `src/components/ui/*` | Reusable primitives (Button, Modal, Toast, Slider, …) |
| `src/stores/*` | Pinia: `project`, `editor`, `history`, `app` |
| `src/engine/*` | Pure album logic + Fabric/export glue (incl. `borderFrames.ts` — decorative SVG border generators) |
| `src/config/*` | Data (layouts, themes, patterns, borders, fonts, proverbs) + `overlays.ts`/`stickers.ts` (file-loaded SVG registries) |
| `src/types/*` | Shared model: `.pebble` schema, layout/theme/editor/IPC types |

---

## 3. Data flow

### Album generation (wizard → editor)

```
folder ──listImages(IPC)──▶ ImageRecord[] (dims, EXIF, thumbnail, parsedLabels)
                                  │
albumGenerator.generateAlbum(meta, records, config)
   filter(skip) → sort(order/date/name) → group(newpage/pg-/max) →
   assign roles(cover/hero/bg/fullpage) → selectLayout(score) →
   composePage(layout, images, theme, meta) → themeDecorations →
   assignProverbs(frequency) → cover + back cover
                                  │
                                  ▼
                       AlbumPage[] → projectStore.initProject → .pebble
```

### Editing (always persisted)

```
User edits object on Fabric canvas
   → AlbumCanvas commits transform into PageImage.position
   → historyStore.run(command)            (undoable, max 50)
   → projectStore.markDirty()
   → debounced 2s → window.pebble.autosave → <name>.pebble (+ .bak)
```

### Rendering parity (preview == export)

`engine/pageRenderer.ts` builds the Fabric objects used by **both** the
interactive editor (`AlbumCanvas`) and the offscreen exporter
(`renderPageStatic`). This guarantees what you see equals what you export.

---

## 4. The `.pebble` file format

Defined in `src/types/pebble.types.ts`. Top level:

```ts
PebbleProject {
  version: "1.0"
  meta: AlbumMeta          // name, sourceFolder, size, dpi, theme, proverbs, …
  pages: AlbumPage[]       // images[], decorations[], textBlocks[], proverb
  imageRegistry: ImageRecord[]   // every scanned image + parsed labels + usage
  history?: HistoryEntry[]
}
```

Per-image, every position/crop/effect/border/shadow/caption is stored so the
album reconstructs exactly. Coordinates are **absolute album pixels**; layout
fractions are resolved at compose time.

---

## 5. Filename label reference

Parser: `src/engine/filenameParser.ts`. Format
`name_[label]_[label].ext` — case-insensitive, order-independent.

| Category | Labels |
|---|---|
| Slot size | `xs sm md lg xl xxl` |
| Aspect | `sq land port free` |
| Border | `border noborder thin thick double rounded polaroid filmstrip` |
| Pattern | `floral bokeh geometric vintage plain lace dots hearts stars leaves` |
| Filter | `bw sepia vivid muted warm cool faded dramatic lomo chrome fade` |
| Position | `left right top bottom center fill` |
| Role | `cover hero thumb bg accent featured` |
| Flags | `newpage fullpage proverb skip x noborder nocaption nofilter spotlight blurbg duotone vignette glow matte textover` |
| Rotation | `r90 r180 r270` |
| Prefix | `cap-<text> pg-<tag> frame-<id> tint-<hex> ord-<n> blend-<mode> spread-left/right` |

---

## 6. Layout engine

- `src/config/layouts.json` defines 34 templates (cover/single/spread/creative/
  classic/industrial/divider) with slots in 0..1 fractions.
- `layoutSelector.selectLayout()` scores templates by image-count fit, hero/featured
  affinity, creative hints, and a **variety penalty** for recently-used layouts.
  Optional weighted-random pick from the top 3 for organic variety.

## 7. Theme engine

- `src/config/themes.json` defines 20 themes (colours, fonts, default filter,
  default decorations, border defaults, distinct gradient/pattern page background).
- `themeEngine` injects CSS variables, resolves a custom theme override, and
  provides CSS filter strings for fast preview.
- `fabricFilters.buildFilterStack()` maps filter ids to Fabric.js filter stacks
  for the real canvas/export pipeline.

## 8. Decoration, sticker & border art

- `src/config/patterns.json` defines 34 patterns: `canvas_draw` (procedural,
  rendered by functions in `decoEngine.ts`) and `svg_overlay` (file-based art in
  `assets/overlays/*.svg`, loaded by `config/overlays.ts` via a Vite `?raw` glob and
  themed by substituting `{{C}}`).
- Procedural renderers draw onto a standard 2D context with a seeded RNG, so the
  same decoration is stable across renders and identical in preview vs. export.
- **Stickers** — `assets/sticker/*.svg` (16 full-colour, any-shape) loaded by
  `config/stickers.ts`; placed at true aspect ratio (uniform scale, never stretched)
  alongside emoji stickers. Rendered in FRONT of photos; all patterns render behind.
- **Decorative photo borders** — `engine/borderFrames.ts` generates 13 themeable
  edge-motif SVG frames (Scallop Fan, Greek Key, Rope, Dots, …) at the frame's exact
  pixel size so the motif tiles without stretching. Line borders also support a
  linear **gradient** stroke. Both live on `PageImage.border`.

## 9. State management (Pinia)

| Store | Holds |
|---|---|
| `projectStore` | The `PebbleProject`, dirty flag, save state, autosave, page CRUD |
| `editorStore` | Active page, selection, zoom, tool, bottom panel, guides |
| `historyStore` | Command-pattern undo/redo stack (≤50), `revision` counter |
| `appStore` | Recent projects, preferences, toasts, version, personal proverbs |

## 10. IPC channels

`folder:open|list|watch|stopWatch|addPhotos` (`addPhotos` = Add photo dialog; outside files are copied to `<folder>/added/`), `image:readBase64|exif|saveDataUrl`,
`cutout:saveMask` (writes a new erase-mask PNG to `<folder>/.pebble_masks/`; returns its relative path for `PageImage.eraseMask`),
`thumb:generate|cachePath|clear`,
`project:save|load|autosave|openDialog|saveDialog|list|delete|recents:get|add|delete`,
`export:pdf|jpeg|png` (+ `export:progress` event),
`analyze:folder` (+ `analyze:progress` event — scan/analyze `done/total` for the culling tools),
`files:moveToDuplicates` (reversible move into `<folder>/duplicate`),
`collage:saveTemp|loadTemp|clearTemp` (the single hidden Collage-resume session file),
`app:version|openExternal|reveal|home|pebbleFolder|checkUpdates`,
`ai:mcpConfig` (MCP connect config + starter prompt),
plus the `folder:changed` push event. The renderer-facing surface is the typed
`PebbleApi` in `src/types/ipc.types.ts`.

---

## 11. Extending the app

- **Add a layout:** append to `layouts.json` (slots in 0..1). It is auto-scored.
- **Add a theme:** append to `themes.json`. It appears in the wizard + ThemePanel.
- **Add a decoration:** add to `patterns.json`; for procedural, add a renderer to
  `decoEngine.RENDERERS`.
- **Add a filename label:** extend `LABEL_MAP` + `ParsedImageLabels` and consume it
  in `collageComposer`/`albumGenerator`.
- **Add an IPC capability:** add a handler in `electron/ipc/*`, register it in
  `main.ts`, add the method to `PebbleApi` + `preload.ts`.
- ⭐ **Expose it to AI (REQUIRED):** whatever capability you add above, add or extend
  the matching **MCP tool** in `mcp/pebble-mcp-server.mjs` so an agent can do it too,
  make new ids discoverable via `list_catalog`, ensure `render_page` reflects it if
  it's visual, and note it in a `mcp/skills/*.md`. Per the parity rule, a feature
  without its MCP tool is **not finished**. See §12 and [`MCP.md`](MCP.md).

---

## 12. AI integration — the MCP server

`mcp/pebble-mcp-server.mjs` is a standalone Node process (stdio JSON-RPC 2.0, deps:
Node built-ins + `sharp`) that an external agent launches. It edits the same
`.pebble` files as the app, so the agent and the GUI are peer editors of one truth.

- **51 tools** spanning discovery, low-cost vision (`render_page`/`view_image` →
  small JPEGs via Sharp), pages, images (transform/effects/border incl. gradient +
  decorative frame/shadow/swap, free "Add photo" overlays and the non-destructive eraser), decorations & stickers, text & proverbs, and
  theme/album metadata. Every edit tool loads → mutates → saves the `.pebble` (+ `.bak`).
- **Skills** (`mcp/skills/*.md`) teach purpose, workflow, the label system, and
  catalogs; the agent reads them via `read_skill` (`pebble_guide` first).
- **Connect flow:** `electron/ipc/ai.ipc.ts` (`getMcpConnectInfo`) builds the config
  JSON + starter prompt; `components/editor/AiConnectModal.vue` (editor top-bar
  🤖 button) shows the copy-config / copy-prompt UI.
- **Packaging:** the server, skills, and config JSONs ship as electron-builder
  `extraResources`, and the app passes `PEBBLE_CONFIG_DIR`/`PEBBLE_ASSETS_DIR`/
  `PEBBLE_SKILLS_DIR` so the (asar-blind) Node process can read them.

> **Parity rule (restated):** the tool surface must always equal the UI surface.
> Adding a feature includes adding its tool. Full concept + per-feature checklist:
> [`MCP.md`](MCP.md); run/debug + env vars: [`../mcp/README.md`](../mcp/README.md).
