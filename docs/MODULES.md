# PebbleAlbum — Module Reference & Dependency Map

This is the canonical map of every module: what it does, which files it owns, what
it depends on, what depends on it, and the **invariants** that must not be broken.

> **Read this before changing core logic.** Several behaviours look "extra" but
> fix real, hard-won bugs (stretching, lag, broken animations, z-order, file://
> loading). Each is flagged **⚠ INVARIANT**. Removing or "simplifying" them will
> reintroduce the original bug.

---

## 1. Layered architecture (dependencies point ONE way only)

```
            ┌─────────────────────────────────────────────┐
  views/    │ WelcomeView · ProjectSetupView · AlbumEditorView · ExportView
            │ (+ tools: CollageView · PixartView · DuplicateFinder · FolderDup)
            └───────────────┬─────────────────────────────┘
                            │ uses (+ composables/: useAddPhoto)
            ┌───────────────▼─────────────────────────────┐
 components/│ canvas/ · editor/ · setup/ · ui/             │  (Vue, no business logic)
            └───────────────┬─────────────────────────────┘
                            │ read/write state + call helpers
            ┌───────────────▼─────────────────────────────┐
  stores/   │ project · editor · history · app  (Pinia)    │  ← the shared state hub
            └───────────────┬─────────────────────────────┘
                            │ call pure functions
            ┌───────────────▼─────────────────────────────┐
  engine/   │ parser · layoutSelector · collageComposer ·  │  (pure TS; pageRenderer/
            │ decoEngine · proverbSelector · themeEngine · │   fabricFilters/imageLoader
            │ albumGenerator · exportEngine · pageRenderer │   are renderer-only)
            └───────────────┬─────────────────────────────┘
                            │ typed by
            ┌───────────────▼─────────────────────────────┐
 config/    │ layouts/themes/patterns/borders/fonts/        │   types/  (no deps)
            │ defaultProverbs (JSON) · overlays.ts (SVG)    │
            └───────────────────────────────────────────────┘

  electron/  (separate process) depends only on: types/ + engine/filenameParser
  mcp/       (separate Node process — the AI tool surface) reads/writes the same
             .pebble files + config JSON + assets/skills; deps: node + sharp only
```

**Coupling rules (keep them):**
- A lower layer **must never import** an upper layer (engine never imports a store
  or component; a store never imports a component).
- Components **do not import other components** except: (a) `ui/` primitives, and
  (b) `PagePanel` composes `LayoutPicker` / `DecorationPanel` / `ProverbPanel`.
- Components share state **only through Pinia stores**. The only props/emits in the
  app are `PageTurnScene` (`pageIndex` ↓, `pageChanged` ↑), `CutoutEditor`
  (`filename`/`imageId` ↓, `close` ↑), `PagePanel`'s optional `variant` ↓ + optional `tab` v-model (the host's insert bar opens a tab), and `ui/` primitives.
  This is the "loosely coupled, only needed props/emits" design the project wants.

---

## 2. Cross-cutting contracts (the three things everything agrees on)

### 2.1 The `.pebble` file is the single source of truth
`projectStore.project` holds the whole album. Every edit mutates it and calls
`project.markDirty()` → debounced autosave to disk. Reopening reconstructs the
album exactly. Types live in `types/pebble.types.ts`.

### 2.2 The image placement model (read before touching rendering)
A `PageImage` is positioned by **four** related fields:
- `position` — the **displayed photo box** in absolute album px. It is ALWAYS
  aspect-correct (width/height proportional to the source image), which is why the
  photo is **never stretched**. ⚠ INVARIANT: keep `position` proportional; only the
  `fill` fit mode (user-chosen) may break it.
- `slotRect` — the fixed **frame/cell** the photo is clipped to (cover/contain).
  Present for slot photos, absent for `free` photos.
- `clipPolygon` — optional absolute-px polygon for **diagonal/angled** cells;
  overrides the rectangular `slotRect` clip when present.
- `fit` — `cover` (crop to fill) | `contain` (letterbox, whole photo) | `fill`.
- `eraseMask` *(optional)* — project-relative path to a PNG under
  `<sourceFolder>/.pebble_masks/` whose **alpha** is the keep amount (opaque = keep,
  transparent = erased), stretched over the WHOLE source photo, applied **before**
  crop/fit. Non-destructive: each save writes a new file; the photo is untouched.
  Written by the app (IPC `cutout:saveMask`) and by the MCP `erase_image_region`.

So: **frame = `slotRect`/`clipPolygon`**, **photo inside the frame = `position`**.
Panning moves `position` inside a fixed frame; moving the cell moves both.

### 2.3b ⭐ MCP tool-parity (the AI contract — INVARIANT)
The album is editable by **two** clients: the GUI and the MCP server
(`mcp/pebble-mcp-server.mjs`). **Every capability the GUI offers must have a matching
MCP tool, and every new feature must add/extend its tool in the same change.** New
ids (layouts, themes, patterns, borders, stickers, filters, fonts) must be
discoverable via `list_catalog`; visual features must appear in `render_page`. A
feature without its MCP tool is **incomplete**. (Full checklist: `MCP.md`.)

### 2.3 The render contract (the performance + correctness backbone)
- `editorStore.canvasRevision` is bumped **only** for *structural* changes
  (add/remove image, change layout/theme/decoration, z-order, fit). The canvas
  watches it and does a full rebuild. ⚠ INVARIANT: **never bump `canvasRevision`
  on a plain move/scale/rotate** — that reintroduces multi-second drag lag.
- `pageRenderer` builds the Fabric objects used by **both** the interactive editor
  and the static exporter, so preview == export. Change object building in ONE
  place only (`pageRenderer`).
- Decorations render **behind** photos; only stickers render **in front**.
  ⚠ INVARIANT: don't move overlay/wash rendering after the photo loop — patterns
  will cover the photos (a reported bug).

---

## 3. Module-by-module reference

### types/  (no dependencies)
- `pebble.types.ts` — the `.pebble` document model (project/meta/page/image/…).
- `layout.types.ts` — layout template + slot shapes.
- `theme.types.ts` — theme tokens (colors/fonts/border/stickers/proverbCategory).
- `editor.types.ts` — renderer-only UI types (tools, panels, prefs, toasts).
- `ipc.types.ts` — the `window.pebble` API contract (shared by preload + handlers).
- `global.d.ts` / `vite-env.d.ts` — `window.pebble` typing + Vue SFC shim.
- **Depended on by:** everything. **Depends on:** nothing.

### config/  (data + file-loaded assets)
- `layouts.json` (34 templates) · `themes.json` (20) · `patterns.json` (34) ·
  `borders.json` · `fonts.json` · `defaultProverbs.json` (152).
- `overlays.ts` — loads **themeable SVG** decoration art from `assets/overlays/*.svg`
  via `import.meta.glob('…?raw')` and substitutes `{{C}}`/`{{C2}}` per theme. The
  files exist on disk AND are inlined at build (no runtime fs / `file://`).
- `stickers.ts` — loads **full-colour SVG stickers** from `assets/sticker/*.svg`,
  parsing each `<svg>`'s intrinsic `width`/`height` so stickers keep their true
  aspect ratio (uniform scale, ⚠ never stretched). 16 stickers + emoji set.
- **Depended on by:** engine. **Depends on:** types only.

### engine/  (pure logic — the heart; unit-testable, framework-free)
Pure modules (no DOM/Vue): `filenameParser`, `layoutSelector`, `collageComposer`,
`decoEngine`, `proverbSelector` (+ `proverSelector` alias), `themeEngine`,
`albumGenerator`, `exportEngine`, `dragMove`.
Renderer-only (use Fabric/DOM/`window`): `pageRenderer`, `fabricFilters`,
`imageLoader`.

| Module | Core job | Depends on | ⚠ Invariants |
|---|---|---|---|
| `filenameParser` | filename → `ParsedImageLabels` | types | label maps are case-insensitive/order-independent |
| `layoutSelector` | score + pick a layout for a photo group | filenameParser, config/layouts | **aspect-fit is the primary score (weight 12)**; random pick is restricted to good-aspect candidates only — keep, or portraits land in landscape slots |
| `collageComposer` | layout + photos → a composed `AlbumPage` | filenameParser, themeEngine-types | **aspect-aware slot assignment** + **contain-fit when mismatch > 0.3** (avoids over-crop) + sets `slotRect`/`clipPolygon`/`fit`. `coverBox/containBox` are proportional |
| `decoEngine` | procedural pattern renderers (bokeh, confetti…) | config/patterns | seeded RNG → stable across renders; pure canvas2d |
| `proverbSelector` | built-in library + assign proverbs to pages | config/defaultProverbs | cover/back-cover never get a proverb |
| `themeEngine` | theme tokens, CSS vars, custom-theme merge | config/themes | `resolveTheme` is the only theme resolver |
| `albumGenerator` | orchestrate generation pipeline | parser, layoutSelector, collageComposer, proverbSelector, themeEngine | orientation-aware grouping; ~28% creative-layout chance for variety |
| `exportEngine` | drive PDF/JPEG/PNG export over IPC | types, `window.pebble` | renders each page via a callback (the canvas supplies full-DPI PNGs) |
| `dragMove` | drag payload + move image between pages | collageComposer, types | structural `ProjectStore` shape only (no store import → no cycle) |
| `pageRenderer` | **build Fabric objects** (editor + export) | decoEngine, fabricFilters, themeEngine, config/overlays, config/stickers, borderFrames | **single source of object building**; cover/clip/polygon; decorations behind, stickers front; gradient + decorative-frame borders; async SVG stickers (uniform scale) |
| `borderFrames` | generate decorative SVG photo-border frames sized to the cell | — | 13 edge-motif generators (incl. uploaded **scallop_fan**); generated at frame px so the motif tiles, ⚠ never stretched; tile count capped |
| `fabricFilters` | filter id → Fabric v6 filter stack | fabric | Fabric v6 has **no Vignette filter** (don't re-add) |
| `imageLoader` | cached base64 thumbnail loader | `window.pebble` | **base64, never `file://`** (file:// is blocked in the renderer) |
| `similarity` | perceptual **dHash** + **quality** score + near-duplicate clustering | — | pure module; shared by `analyze.ipc` + MCP culling tools. `buildDuplicateGroups(items, qById, threshold)` re-clusters at any Hamming threshold (drives the Duplicate Finder strictness slider with no re-hash) |

### stores/  (Pinia — the shared state hub)
| Store | Owns | Depends on |
|---|---|---|
| `projectStore` | the `PebbleProject`, dirty flag, save/autosave, page CRUD, `regenerate()` | engine/albumGenerator, engine/themeEngine, types |
| `editorStore` | active page, selection, zoom, tool, bottom panel, **`canvasRevision`**, **`cropImageId`**, `selectionRequest` | types |
| `historyStore` | command-pattern undo/redo (≤50) + `revision` | — |
| `appStore` | recent/saved projects, prefs, toasts, version | types |
| `collageStore` | standalone Collage tool: folder/records/selection + layout/theme/shape/bg + `phase` | types | in-memory; `CollageView` mirrors it to the hidden collage-session temp file for crash-safe resume |
- **Depended on by:** components/views. **Depends on:** engine + types only.
- ⚠ The Collage and Pixart tools **reuse `projectStore`** for a one-page in-memory
  project (`meta.autoSave=false`, save path `null`); `CollageView` / `PixartView`
  stash/restore any open album so the shared store is never clobbered (`PixartView`
  also stashes + restores the album's undo/redo stacks, and clears history on entry).

### components/  (Vue — presentation; logic lives in stores/engine)
- `canvas/AlbumCanvas.vue` — interactive Fabric canvas. Owns selection sync,
  the **frame-handle crop model** (select frame = move/resize cell; double-click =
  pan/zoom photo inside), drag-drop placement, and `commitTransform`.
  ⚠ INVARIANT: re-render only on `activePageIndex` / `canvasRevision` / `selectionRequest`.
- `canvas/PageTurnScene.vue` — WebGL page-curl preview. ⚠ INVARIANT: **every turn
  fully rebuilds + disposes its meshes** (fixes repeated-turn breakage).
- `canvas/CanvasOverlay.vue` — rulers/safe-zone/bleed guides.
- `editor/PageStrip.vue` — left page list: thumbnails, reorder, **teleported
  context menu** (don't put it back inline — it gets clipped), active highlight.
- `editor/PagePanel.vue` — **right panel = per-page editing** (tabs: Layers /
  Layout / Design / Proverb / Page). Composes LayoutPicker/DecorationPanel/ProverbPanel.
  Optional `variant="photo"` (Pixart) hides the Layout tab + slideshow settings.
  Its **＋ Add photo** calls `composables/useAddPhoto` (shared with PixartView).
- `composables/useAddPhoto.ts` — the ONE Add-photo implementation (dialog →
  registry → free overlay on top, centred + staggered, undoable, selected after the
  rebuild, locked/error toasts) + the pure `buildFreePhotos` placement helper. UI
  orchestration over stores (no component imports).
- `editor/PropertiesPanel.vue` — selected-IMAGE editor (Transform incl. fit + zoom
  + crop toggle, Effects, Border [Line: solid/dashed/dotted/double + optional
  **gradient**; or **Decorative frame**: 13 SVG motifs], Shadow, Caption) + Back.
- `editor/TextPropertiesPanel.vue` — selected-TEXT editor (content, font family,
  size, weight, italic, colour, align, spacing, line-height, rotation, opacity).
  Shown for `selectedType === 'text'` (proverbs/titles/captions are movable text).
- `editor/LayoutPicker.vue` — per-page layout chooser (independent module).
- `editor/DecorationPanel.vue` — per-page patterns + stickers (independent module).
- `editor/ProverbPanel.vue` — per-page proverbs as **movable text blocks** (multiple
  per page; add/select/remove; migrates legacy single `page.proverb`).
- `editor/ThemePanel.vue` — album theme switcher (bottom bar, album-wide).
- `editor/ImageStrip.vue` — bottom "Images" filmstrip (browse all, click→open page,
  drag→place/move).
- `editor/AiConnectModal.vue` — **🤖 Connect AI**: copy MCP config + starter prompt
  (via `window.pebble.getMcpConnectInfo`) to drive the app from an AI agent.
- `ui/*` — generic primitives (Button/IconButton/Segmented/Tabs/Modal/Toast/Slider/ColorPicker/
  Dropdown/Tooltip/Progress/EmptyState) + `AppIcon` rendering the ONE stroke-icon set in `ui/icons.ts`.
  App-chrome colours/type/radius are tokens in `src/style.css` (`--ui-*`) mapped by `tailwind.config.js`;
  ⚠ they are NOT the album theme (`--pa-theme-*`, `themeEngine.injectThemeVars`). See `UI_REDESIGN.md`.
- `editor/ImageBin.vue`, `editor/PageConfigPanel.vue` — **DEPRECATED stubs** (host
  FS blocks deletion). Superseded by PagePanel + ImageStrip. Safe to delete.

### views/  (screens; wire stores + components + router)
`WelcomeView` (saved projects list + delete; **Quick tools** cards; **Resume collage**
banner when a session exists), `ProjectSetupView` (6-step wizard via
`provide('wizard', draft)`), `AlbumEditorView` (top bar + PageStrip + canvas +
bottom album tabs + right page/properties panel + fullscreen preview overlay),
`ExportView` (export config + print checklist).
Standalone (no `.pebble`): `CollageView` (`/collage`) — two-phase pick → **full editor**
that reuses AlbumCanvas + the editor panels (one-page in-memory project,
autosave off) with crash-safe session resume; `DuplicateFinderView` (`/duplicates`) —
analyze → grouped culling with progress, strictness slider, per-set full-screen
compare, collapsible sets, and a "Possibly blurry" bucket; `PixartView` (`/pixart`) —
open photo → **standalone photo editor** reusing AlbumCanvas + PropertiesPanel/
TextPropertiesPanel + PagePanel (`variant="photo"`) + CutoutEditor over a one-page
in-memory project sized to the base photo (layout `cover_full_bleed`, base = full-page
slotted `cover` photo, extra photos = free overlays); no session file, no `.pebble`
(so nothing for MCP to edit). CollageView also mounts CutoutEditor.

### electron/  (main process — separate, no renderer imports)
`main.ts` (window + IPC registration), `preload.ts` (the `window.pebble` bridge),
`ipc/{folder,image,thumbnail,project,export,ai,analyze,files}.ipc.ts`. `ai.ipc.ts`
builds the MCP connect config + starter prompt (`getMcpConnectInfo`). `analyze.ipc.ts`
computes phash+quality (Sharp, mtime-cached) and **streams `analyze:progress`** during
scan/analyze. `files.ipc.ts` holds the project-free tool ops: `moveToDuplicates`,
`saveImage`, and the **single collage-session temp file** (`collage:saveTemp/loadTemp/
clearTemp`, atomic write). Add-photo / eraser IPC: `folder:addPhotos` (file dialog; outside
files copied to `<sourceFolder>/added/`) and `cutout:saveMask` (writes a new
`<sourceFolder>/.pebble_masks/<imageId>_<ts>.png`, returns the relative path for
`PageImage.eraseMask`). Reuses `engine/{filenameParser,similarity}` + `types` only.
⚠ INVARIANT: all `fs`/native work stays in main; the renderer only calls `window.pebble.*`.

### mcp/  (the AI tool surface — standalone Node process)
- `pebble-mcp-server.mjs` — MCP server over stdio (JSON-RPC 2.0); deps: node + `sharp`.
  Reads catalogs from `config/` and assets from `assets/` (paths overridable via env),
  edits `.pebble` files directly (load → mutate → save + `.bak`), and renders
  low-cost JPEG previews with Sharp (`render_page`, `view_image`).
- `skills/*.md` — overview, workflow, labels, catalogs, tools cheat-sheet (read via
  `read_skill`).
- ⚠ INVARIANT (**tool parity**, see §2.3b): the 51 tools must equal the GUI's
  capability set; adding a feature includes adding/extending its tool. Keep small
  hardcoded lists in the server (e.g. `BORDER_FRAMES`) in sync with the engine.
- **Depends on:** the `.pebble` shape + the `config/`/`assets/` files. **No imports**
  from `src/` (it's a separate runtime); it re-reads the JSON/SVG assets at runtime.

---

## 4. "If you change X, also check Y"

- Change `PageImage` shape → `pageRenderer` (build), `collageComposer` (compose),
  `AlbumCanvas.commitTransform` (edit), `dragMove` (move), `projectStore` (CRUD),
  **and the MCP server** (read in `get_page`, write in the relevant edit tool).
- Add a layout → `config/layouts.json` (auto-scored; for angled cells add a
  `clipPath` polygon). **MCP:** it's already exposed via `update_page`/`place_image`
  + `list_catalog layouts` — no tool change needed.
- Add a theme/pattern/border-frame/sticker → drop the file/JSON entry (+ a new SVG
  in `assets/overlays|sticker` or a `borderFrames.ts` generator). **MCP:** appears
  in `list_catalog` automatically (the server re-reads config/assets); add new
  border ids to the server's `BORDER_FRAMES` list.
- Add an IPC capability → handler in `electron/ipc/*` + register in `main.ts` +
  method in `types/ipc.types.ts` + `preload.ts` (all four, or it won't resolve).
- ⭐ **Add ANY user-facing feature → add/extend its MCP tool** in
  `mcp/pebble-mcp-server.mjs`, keep `render_page` accurate if it's visual, and note
  it in `mcp/skills/*.md`. (Parity rule — §2.3b / `MCP.md`. Not optional.)
- Touch render order → keep "decorations behind, photos, stickers front" (in BOTH
  `pageRenderer`/`AlbumCanvas` AND the MCP server's `render_page` compositor).
- Touch drag/zoom/pan → keep the frame-handle model + `clampCover` (no gaps) and do
  NOT bump `canvasRevision` during a drag.

See `ARCHITECTURE.md` for data-flow diagrams and `TEST_PLAN.md` for the cases that
exercise these invariants.
