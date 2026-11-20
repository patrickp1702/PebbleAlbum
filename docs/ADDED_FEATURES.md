# PebbleAlbum — Added Features

Beyond the base specification, the following enhancements were added to push
PebbleAlbum toward a world-class, pro-grade product. Each entry notes **what**
and **why**.

## Collage engine (informed by Fundy Designer / SmartAlbums / Album)

Pro album software shares a core set of behaviours; PebbleAlbum implements the
most important ones:

- **Aspect-aware auto layout** — on generation, the widest slots are paired with
  the widest (landscape) photos and tall slots with portraits, and layout
  templates are scored by how well their slot shapes match the group's photo
  shapes. *Why:* this is what stops auto pages from looking over-cropped — a
  portrait no longer gets jammed into a wide banner and zoomed to a face.
- **Per-image fit modes (Cover / Contain / Fill)** — like SmartAlbums' fill vs.
  fit. Cover crops to fill the frame, Contain shows the whole photo (letterbox),
  Fill stretches (available but discouraged). Set per image or "fit all" per page.
- **Frame + photo model** — each slot is a fixed frame; the photo is cover-fit
  and clipped to it, and can be panned/zoomed inside without distortion (the
  classic album-design interaction).
- **Drag to move photos between pages** — drag a photo from the bottom filmstrip,
  the page bin, or the canvas onto another page (in the page strip or canvas).
  Moved photos land "not placed" so the user positions them — matching how album
  tools stage images before placing.
- **Bottom Images filmstrip** — a horizontal strip of every photo; click one to
  jump to the page it's on (and select it); drag to place/move. Filter All/Unused.
- **Live page thumbnails** — the left page strip renders real low-res previews of
  each page (not placeholders), like every pro tool's page navigator.
- **Page config** — per-page background, "fit all photos" (cover/contain), notes.
- **Object stickers + theme bundles** — emoji/object stickers (butterfly, hearts,
  etc.), with each theme suggesting its own sticker set, decorations and proverb
  category (preconfigured, fully editable) — the "designed template" concept.
- **File-based SVG decoration assets** — every `svg_overlay` pattern (corners,
  frames, bands, washes) is a real themeable SVG in `assets/overlays/` and is
  inlined at build time (Vite `?raw` glob), so the `patterns.json` `asset`
  references resolve to actual files yet still work in the packaged app with no
  runtime filesystem access. Adding a new overlay is now just dropping a `.svg`
  in the folder + one `patterns.json` entry.
- **Graphic (SVG) stickers, any shape** — alongside the emoji stickers there is a
  library of full-colour SVG stickers (butterfly, balloon, crown, rainbow, music
  note, pennant banner, …) in `assets/sticker/`. Each sticker's intrinsic
  `width`/`height` is read from its `<svg>` tag so non-square stickers keep their
  true aspect ratio and are scaled UNIFORMLY — they are never stretched (the same
  no-stretch invariant the photos use). Drop a `.svg` in the folder and it appears
  in the picker automatically.
- **Expanded pattern library** — 13 new page patterns: procedural fills
  (Triangles, Crosshatch, Big Polka Dots, Sunburst, Plus Grid) and SVG overlays
  (Art Deco Corner, Botanical Frame, Star Corner, Geometric Corner, Wave Band,
  Snowflake Corner, Heart Corner, Sun Rays), all theme-tinted and rendered BEHIND
  the photos.
- **Movable, multi proverbs with full typography** — proverbs are real text
  blocks now, not a fixed footer line. A page can hold several; each can be
  dragged, rotated, and restyled (font family from the 27-font library, size,
  weight, italic, colour, alignment, letter-spacing, line-height, opacity) via
  the new Text panel. Legacy single-proverb pages migrate automatically to a
  movable block the first time the Proverb tab is opened. Text moves/rotations
  are full undo/redo commands.
- **Decorative + gradient photo borders** — the Border tab now offers two modes:
  *Line* (solid/dashed/dotted/double) with an optional **linear gradient**
  (from/to colour + angle), and *Decorative frame* — 13 themeable SVG border
  motifs incl. the **Scallop Fan** shell band, Scallops, Spaced Dots, Dashes,
  Zigzag, Wave, Greek Key, Rope, Beads, Deco Lines, Leaf Vine, Hearts and
  Triangles. Frame borders are generated at the photo frame's exact pixel size so
  the motif tiles cleanly and is never stretched, and they regenerate crisply
  when the cell is resized.

> Note: this is a curated subset of pro-tool capabilities chosen for the biggest
> impact. Deeper parity items (face/subject-aware auto-crop, spread-aware
> two-page layouts, design "swatch" libraries, client proofing) are natural next
> steps and noted under Scope below.

## AI integration (MCP)

> ⭐ **Design rule — MCP tool parity:** every capability a user can perform in the UI
> is exposed as an MCP tool, and every *future* feature must ship its MCP tool in the
> same change. The agent is a first-class editor of the album, equal to the GUI.
> Concept + per-feature checklist: [`MCP.md`](MCP.md).

- **Built-in MCP server** (`mcp/pebble-mcp-server.mjs`) — a standalone, dependency-
  light (sharp only) Model Context Protocol server an external AI agent connects
  to over stdio. It operates directly on the `.pebble` files in
  `~/Documents/Pebble`, so anything the agent designs appears in the app on
  reload. *Why:* turns PebbleAlbum into an agent-drivable studio — "make me a
  beautiful album" — while the app stays the source of truth.
- **53 tools covering every album action** (30 at first release; culling, collage, cutout, eraser, filter-brush and utility tools since) — discovery (`get_project`, `get_page`,
  `list_images`, `list_catalog`), pages (add/delete/duplicate/move/update incl.
  re-layout), images (place/transform/effects/fit/border incl. gradient + SVG
  frame/shadow/swap), decorations & stickers, text & proverbs, and theme/album
  metadata. Every edit saves the `.pebble` immediately (+ `.bak`).
- **Low-cost vision tools** — `render_page` and `view_image` return small JPEGs
  (default ≤640px, quality 62; a page is ~5–80 KB) generated server-side with
  sharp, so the agent can *see* a page/photo to verify its work without large
  token cost. *Why:* the user explicitly wanted previews cheap enough for an LLM.
- **Skill files** (`mcp/skills/*.md`) — the agent reads `pebble_guide` + skills to
  learn the app's purpose, the recommended workflow, the filename-label system,
  and the catalogs (layouts/themes/patterns/borders/stickers/fonts), so it uses
  valid ids and a sensible process.
- **"Connect AI" panel** — the editor's 🤖 button shows a one-click **copy MCP
  config** (resolved `node` command + server path + env) and a **copy starter
  prompt** (pre-filled with the open project's name). Packaged builds ship the
  server, skills and config JSONs as resources so a plain Node process (which
  can't read an asar) can load them.
- **Agent-feedback-driven improvements (P0+P1).** After a real agent build of an
  album, two rounds of fixes: (P0) `list_catalog layouts` now returns per-slot
  orientation/aspect so the agent stops cropping faces and varies layouts;
  `set_page_image_style` batch-styles a page/album in one call with presets;
  border/shadow inputs are validated (`null` truly removes); and `render_album`
  verifies the whole book in one labelled grid. (P1) **focal-point + cover-zoom
  crop** (`focus{x,y}` + `coverZoom` on `PageImage`, honoured by the renderer and
  the MCP preview, exposed as `update_image { focusX, focusY, zoom }` and as Focus
  X/Y + Cover-zoom sliders in the Properties panel) keeps faces in frame without
  distortion; deterministic re-layout (no orphaned overlaps); `place_image` reuses a
  parked photo instead of duplicating; `move_image_to_slot`; `set_page_proverb` /
  `clear_proverb`; a **birthday sticker pack** (0–9 number badges, cake, candle,
  gift, party hat, bunting, confetti, balloon cluster, "Happy Birthday") and two
  occasion themes (`first_birthday`, `kids_primary`).
  (P2 polish) **gradient / texture page backgrounds** (`page.backgroundGradient` +
  `backgroundPattern`, rendered in editor + export + MCP preview, with PagePanel
  controls and `update_page` params); a **text legibility kit** (background plate +
  outline + drop shadow rendered from `TextStyle`, in the Text panel and
  `add_text`/`update_text` incl. letterSpacing/lineHeight); **auto-enhance + 3
  filters** (`auto_enhance`, `portrait_glow`, `warm_skin`, `matte_film`); 4 more
  decorative frames (washi tape, film strip, studs, pinstripe); 3 more patterns
  (linen texture, kraft speckle, balloons); 4 more script/kids fonts; and a
  **`copy_image_style`** MCP tool for a consistent look across a page/album.
  (2nd agent-feedback round) **batch builders** that cut a full album from ~225 to
  <100 tool calls: `fill_page` (layout + place all photos + focal crops + style in
  one call), `update_images` (batch per-image edits), `add_pages` (batch create),
  and `view_images` (all source photos as one grid); a `captionSafe` text option
  (always-readable plate+outline+shadow); `update_image { detach:true }` to free a
  cover hero from its slot; and a robustness fix so `page` accepts numeric strings
  (the `set_page_image_style` single-page error) and `add_page atIndex` / `move_page`
  reliably insert/reorder.

## Standalone quick tools (folder-level, no project)

Two project-free utilities launch from the welcome screen, reusing the same engine
modules as the album so they're additive and loosely coupled:

- **Collage Creator** (`/collage`, `CollageView` + `collageStore`) — a **two-phase**
  tool that gives a collage the *same editing power as an album page* by reusing the
  album's own components rather than reimplementing them:
  - **Setup** — pick a folder, multi-select photos (in click order), choose a starting
    layout/theme/shape/background.
  - **Edit** — drops into a **full interactive editor** that mounts the real
    `AlbumCanvas`, `PropertiesPanel`/`TextPropertiesPanel`, `PagePanel`, `ImageStrip`
    and `ThemePanel`. So a collage now supports drag/resize/rotate, double-click focal
    crop, filters & adjustments, borders (line/gradient/SVG frame), shadows,
    decorations, stickers, movable/rotatable text, layout/theme swaps, and undo/redo.
    **Download** renders the page full-resolution via `renderPageStatic` (Save dialog).

  *How the reuse stays clean:* the collage is modelled as a **one-page in-memory
  project** with `meta.autoSave = false`, so the store-backed editor components work
  unchanged yet **nothing is written to the named-project (`.pebble`) system**. Any
  album already open is **stashed on entry and restored on exit**, so the shared
  project store is never clobbered.
- **Collage session resume (crash-safe).** The collage **autosaves on every change**
  (debounced) to a *single hidden* `~/Documents/Pebble/.collage-session.json`
  (dot-prefixed JSON ⇒ never listed among `.pebble` projects; only ever one, no name).
  Written atomically (temp-file + rename) and flushed synchronously on leave, so a
  sudden close loses at most ~0.7 s. On reopening the tool it **restores exactly where
  you left off** (back into the editor on the same page, or the picker). **Clear**
  deletes the session file. The welcome screen shows a **Resume collage** banner
  (Resume / Discard) whenever a session exists. IPC: `collage:saveTemp/loadTemp/clearTemp`
  in `files.ipc.ts`; shape `CollageSession` in `ipc.types.ts`.
- **Duplicate Finder** (`/duplicates`, `DuplicateFinderView`) — pick a folder, see
  near-duplicate/burst groups (best frame highlighted, blurry/over/under flags) via
  the shared similarity engine, mark the unwanted ones, and **Move to `duplicate/`** —
  a reversible subfolder move (never a delete). After a move the sets re-cluster, so
  any set that drops to one photo falls into **All other photos**. The tool keeps no
  state — every open is fresh. The `duplicate/` subfolder is excluded from all future
  scans (so moved photos never reappear, in tools or albums). This session added:
  - **Live progress + errors.** `analyzeFolder` streams an `analyze:progress` event
    (phases `scan` → `analyze` with `done/total`); the header shows a running label
    ("Analyzing photos… 300 / 540 · 240 left") and a **progress bar with %** (so a big
    folder no longer just says "Analyzing…"). Failures and empty folders show an inline
    error panel with **Retry**. (`AnalyzeProgress` type, `onAnalyzeProgress` listener.)
  - **Match-strictness slider** (Loose ↔ Strict). Re-clusters **instantly** in the
    renderer via the pure `buildDuplicateGroups` (no re-analysis / no re-hash); higher =
    only near-identical frames group together.
  - **Per-set full-screen compare.** Each group has a **⛶ Full screen** button opening
    just that set as large side-by-side images (mark/keep, ★ Best, flags, Esc to close).
  - **Collapsible sets** (per-group chevron + Collapse/Expand all).
  - **"Possibly blurry" bucket** — ungrouped photos whose sharpness is well below the
    folder median are split into their own section (markable for moving), separate from
    "All other photos".
- **Secure file ops** (`electron/ipc/files.ipc.ts`): `moveToDuplicates` is confined to
  the chosen folder (no absolute/`..` paths), clash-safe (`name_1.jpg`), with an
  EXDEV copy+remove fallback; `saveImage` writes a chosen image via a Save dialog.

## MCP security sandbox

- **Filesystem confinement for the AI.** The MCP server restricts the agent to the
  album only: project writes go solely to `PEBBLE_HOME/*.pebble` (+ `.bak`) plus new
  files inside the album folder (`<sourceFolder>/cutouts/`, `<sourceFolder>/.pebble_masks/`)
  and the server deletes nothing; image reads are confined to the project's `sourceFolder`
  with **absolute paths, `../` traversal, and symlink escapes rejected**, and the
  `project` argument can't point outside `PEBBLE_HOME`. Centralised in
  `safeImagePath`/`assertSafeRelative`/`resolveProjectPath`/`saveProject` guards and
  covered by a security test (malicious paths refused; legitimate reads/edits pass).

## Photo culling — duplicate detection & quality selection

- **Near-duplicate grouping + best-frame suggestion.** `src/engine/similarity.ts`
  fingerprints every photo with a perceptual **dHash**, clusters near-duplicate /
  burst shots by Hamming distance (aspect-gated, union-find), and scores each photo's
  **quality** (sharpness via gradient energy × exposure goodness, with highlight/shadow
  clipping). The sharpest, best-exposed frame in each group is auto-suggested as the
  keeper — only **selected** photos go into the album. *Why:* this is the single most
  requested pro-culling capability (à la Aftershoot/Narrative), done with a fast,
  dependency-free heuristic.
- **Analysis IPC + cache.** `electron/ipc/analyze.ipc.ts` computes phash+quality with
  Sharp, mtime-cached in `.pebble_cache/analysis.json`, and returns the duplicate
  groups; results persist on `ImageRecord` (`phash`/`quality`) + `PebbleProject.duplicateGroups`.
- **Full-page selection UI** (`PhotoSelectionView.vue`) — available **after picking the
  folder in the wizard** and from the editor's **🖼 Select images** button. Duplicate
  groups show side-by-side frames with the **★ Best** pre-selected and
  blurry/over-/under-exposed warning chips; click any frame to keep it, keep several,
  "keep best only", or exclude uniques. Deselected photos are marked `skipped` (and any
  already placed are parked) so the album uses only the chosen photos.
- **AI leverage (MCP).** `find_duplicates` (groups + flags + suggested keeper),
  `view_group` (a low-res montage so the agent's **vision model** can compare frames
  cheaply), `cull_duplicates` (keep-best across all groups in one call), and
  `select_photos` (manual keep/skip). Images are downscaled before sending to keep
  token cost low.

## Architecture & quality

- **Shared `pageRenderer` module** — the exact Fabric.js object-building code is
  reused by both the interactive editor and the offscreen exporter. *Why:* the
  hardest bug in album software is "export doesn't match preview"; sharing the
  builder eliminates that class of bug by construction.
- **Pure, framework-free engine layer** — parser, layout, composer, generator,
  proverbs, theme and export logic have no DOM/Fabric dependency. *Why:* fast,
  deterministic, unit-testable, and runnable in a Web Worker later.
- **Seeded RNG for procedural decorations** — bokeh/confetti/grain use a stable
  seed derived from the page id. *Why:* decorations don't "jump" on every render
  and preview matches export.
- **Typed IPC contract (`ipc.types.ts`)** — a single `PebbleApi` interface shared
  by preload, handlers, and renderer. *Why:* prevents bridge/handler drift.

## Reliability

- **Crash-recovery `.pebble.bak`** — every save also writes a backup; the welcome
  flow can offer it if the main file is corrupt. *Why:* never lose an album.
- **Missing-image placeholders + re-link path** — broken sources render a labelled
  placeholder instead of crashing the canvas. *Why:* folders move; albums shouldn't break.
- **Pre-export print checklist** — flags images below ~150 effective DPI and any
  missing sources before you commit to a print. *Why:* avoid expensive bad prints.

## Productivity

- **Album statistics panel** — pages, images used/unused, average per page.
- **Keyboard shortcuts** — undo/redo, save, page navigation, delete, zoom fit/100%,
  and a `?` shortcuts overlay.
- **Live theme & layout switching** — change a page's layout (re-mapping images
  into new slots) or the whole theme and see it immediately.
- **Built-in proverb library (150+)** — searchable, categorised, one-click insert,
  plus a personal library hook (`~/PebbleAlbum/my-proverbs.json`).
- **Recent projects** with metadata on the welcome screen.
- **Debounced autosave (2s)** with a visible Saving…/Saved indicator. *Why:* the
  `.pebble` file is always current without manual saving.

## Visual polish

- **15 complete themes** and **17 layouts** (cover/spread/creative/divider) and
  **20 decorations** (procedural + overlay), all data-driven via JSON config so
  new ones need no code changes.
- **Three.js page-turn** with curl/slide/fade/hard styles and slow/normal/fast
  speeds, driven by project meta.
- **Pro dark UI** (Lightroom-style) with electric-indigo accent, toasts, tooltips,
  modals, progress bars, and a light-mode toggle.

## Extensibility hooks (designed, ready to grow)

- Web-Worker-friendly generator, custom theme override, watermark/page-number
  meta fields, section dividers + date grouping flags, and an `app:checkUpdates`
  IPC stub for a future auto-updater.

## Modern editing engine (PicsArt-class) — 2026-07

A market survey of PicsArt / Canva / Fotor / Snapseed drove a full upgrade of
per-image editing, plus two long-standing rendering bugs fixed. Everything ships
with MCP parity (`update_image` extensions + new `set_image_mask`).

- **Real Adjust engine** — the Brightness/Contrast/Saturation/Vignette/Blur
  sliders previously stored values that were NEVER rendered. They now drive a
  Fabric filter pipeline (`buildAdjustmentFilters`), joined by new **Exposure,
  Highlights, Shadows, Temperature, Tint, Hue, Sharpen and Grain** sliders,
  grouped PicsArt-style (Light / Colour / Detail) in a new **Adjust** tab.
  *Why:* table-stakes in every leading editor.
- **Vignette that actually renders** — a radial-gradient overlay built
  identically by the editor, the page-turn preview and the exporter.
- **Filter presets with live thumbnails + strength** — a **Filters** tab shows
  every preset rendered on *your* photo (the PicsArt/Instagram pattern), in
  categories (Basic/Film/Mono/Colour/Mood) with new looks (Kodachrome,
  Technicolor, Polaroid, Vintage, Brownie, Noir, Silver, Cinematic) and a
  0–100% **Strength** slider (`effects.filterStrength`).
- **Shape masks** — clip any photo to circle / ellipse / squircle / heart /
  star / hexagon / diamond / arch / blob / scallop (`maskId`,
  `engine/maskShapes.ts`), the single highest-value "wow" feature for albums.
- **Borders/frames hug the photo and follow masks** — line borders, decorative
  frames and the vignette are drawn on the photo's VISIBLE bounds
  (`displayRectOf`: true display box ∩ slot) instead of the raw slot rect, so a
  contain-fit photo inside a full-page cover slot is framed on the photo, not
  around the page. With a shape mask active, borders (and decorative frames, as
  a dotted outline) TRACE the mask path instead of staying rectangular.
- **Hold-to-compare + Reset** — press-and-hold shows the untouched photo
  (Snapseed/Lightroom pattern).
- **Cell aspect presets + 90° rotate** — reshape a cell to 1:1 / 4:5 / 3:4 /
  3:2 / 16:9 with the photo auto re-fitting; rotate free photos in 90° steps.
- **Live, flicker-free effects** — slider changes re-apply filters on the live
  Fabric object (`requestEffectsUpdate`) instead of rebuilding the canvas.

### Rendering fixes shipped with this work

- **Tall-photo preview truncation** — Fabric's WebGL filter canvas is
  `config.textureSize` (4096) square, so filtering a 6000px-tall photo at full
  resolution silently cut off its bottom third in the preview/export. Fixed
  three ways: the page-turn preview now renders from the ≤1600px EXIF-normalised
  thumbnails; `textureSize` is raised to 8192 when the GPU allows; and
  `applyFiltersSafe` routes any still-larger image through the pixel-correct
  Canvas2D backend.
- **Editing flicker removed** — canvas rebuilds are now double-buffered (all
  objects built off-canvas, swapped in one synchronous paint, so the page never
  flashes blank), and while dragging a cell the photo/clip/border/decorative
  frame/vignette follow the gesture live instead of jumping on mouse-up.

---

## Cutout studio, stickers, curved text, drag-to-swap — 2026-07 (2)

Modelled directly on PicsArt's Cutout / Eraser / Text Bend workflows:

- **Cutout studio** (`components/editor/CutoutEditor.vue`, "✂ Cutout & blend"
  on any selected photo) — checkerboard transparency preview with **Erase /
  Restore / Pan** brushes and **Size / Opacity / Hardness** sliders. Each
  stroke commits at its opacity, so repeated low-opacity passes fade the
  photo's edges/corners **layer by layer** into the page (100% erases
  outright). Scroll-zoom, per-stroke undo. Output is a transparent PNG.
- **Optional AI background removal** — one click, fully client-side
  (`@imgly/background-removal` WASM in the app; `@imgly/background-removal-node`
  for the MCP `remove_background` tool). First run downloads the model.
- **Apply to photo / custom sticker maker** — a cutout can replace the photo on
  the page (saved as `<sourceFolder>/cutouts/*.png` + registered in the album)
  or be saved to the global **My Stickers** library (`~/PebbleAlbum/stickers`),
  which appears in the Decorations panel and renders via `params.file`.
- **Curved text (Bend)** — `style.curve` −100..100 renders per-character along
  an arc (`engine/curvedText.ts`); Bend slider in the text panel; same arc in
  editor, preview and export.
- **Drag-to-swap** — dragging a cell onto another cell highlights it and swaps
  the two photos' frames on drop (undoable), like Canva/Mixbook grids.
- **MCP parity** — `remove_background` (+saveAsSticker), `list_custom_stickers`,
  `add_sticker {file}`, `add_text`/`update_text` `curve`. Manual brushing is
  the one inherently-interactive surface; its outputs (cutout PNGs, stickers)
  are fully scriptable.

---

## Slideshow studio: transitions, timing, music, MP4 export — 2026-07 (3)

Modelled on the desktop slideshow-maker canon (Movavi/Icecream patterns:
global default + per-slide duration, named transitions, bundled + uploaded
music with loop-to-fit and end fade, MP4 H.264 export that renders exactly
the preview):

- **7 page-turn styles** — curl, slide, **push**, fade, **zoom**, **flip up**,
  hard flip; selectable in the preview control bar and Page settings
  (`meta.pageTurnStyle`).
- **Per-page duration** — `page.durationSec` (1–60s) with the album default in
  `meta.slideshowInterval` (4s); editable in Page settings ("use default"
  resets) and honoured by both the ▶ slideshow and the video export.
- **Slideshow music** — ♪ Music picker in the preview bar: three bundled
  royalty-free tracks (synthesized originals generated by
  `_scripts/generate-default-music.cjs` into `assets/music/`) + the user's
  `~/PebbleAlbum/music` library ("Add music from computer…"). Ordered
  multi-track playlist in `meta.slideshowMusic`; plays during autoplay and
  **loops back to the first track** when the show outlasts the music; fades
  out at the end. (`engine/slideshowMedia.ts` SlideshowPlaylist)
- **⬇ Save video (MP4)** — records the live preview canvas start→end (same
  transitions, same per-page timing, same playlist) at ~1080p/30fps, then
  re-encodes to a **standard progressive MP4 (H.264 + AAC, +faststart)** with a
  bundled `ffmpeg-static` in the main process. This is required for
  compatibility: Chromium's MediaRecorder emits a FRAGMENTED MP4 whose sample
  layout QuickTime / macOS AVFoundation (and Chrome on `file://`) cannot render
  — audio plays but the video is black. The re-encode rewrites clean sample
  tables + a single front-loaded `moov`, so the file plays in every player.
  The WebGL renderer also needs `preserveDrawingBuffer: true` or
  `canvas.captureStream()` reads cleared (black) frames. Saves to
  `~/Documents/Pebble/exports/` and reveals the file. Progress overlay + cancel.
  (`recordSlideshow` → `saveVideo`)
  **Focus-independent:** the Electron window uses `backgroundThrottling:false`
  plus the `disable-background-timer-throttling` / `-renderer-backgrounding` /
  `-backgrounding-occluded-windows` switches, so the render loop + recording
  keep running at full speed (correct duration, live frames) even when the user
  switches to another app during export — without them Chromium throttles rAF/
  timers and the show froze on one frame and stretched to minutes.
- **MCP parity** — `update_page {durationSec}`, `update_album
  {slideshowInterval, pageTurnStyle, pageTurnSpeed, slideshowMusic}`,
  `list_music`. Recording itself is a UI act; everything it renders is
  agent-configurable.

---

## Duplicate Folder Finder (quick tool) — 2026-07

A third standalone quick tool (alongside Collage Creator and the image
Duplicate Finder) for finding whole **duplicate folders + files** within or
across one or many roots — even two hard disks with very large trees.
Metadata-only (name / date / size — never content hashing), built with the
techniques backup/dedupe tools use so it scales.

- **Scan → analyze split** (`electron/ipc/folderdup.ipc.ts`): one concurrent
  directory walk builds an in-memory snapshot ({dir → mtime, direct files});
  analysis is a pure in-memory pass so the **similarity slider and match-mode
  re-filter instantly with no rescan** (all candidate pairs ≥30% are emitted
  once; the renderer filters).
- **Inverted index + candidate-pair counting with a hot-key cap** — never
  O(n²) over folders. A **bottom-up roll-up** (depth-bucketed) makes a
  duplicated whole *tree* surface as one outermost pair (folder-of-folder).
- **Containment similarity** = sharedFiles / min(recFilesA, recFilesB) — a
  small folder fully copied inside a bigger one scores 100% (the backup case),
  tolerating extra files in the smaller side. Slider default 70%.
- **Within vs across** scope badges (amber ⊂ within drive / blue ↔ across
  drives) so the user prioritises; the smaller/contained "duplicate" side is
  shown first as the deletion candidate, the bigger as "also in".
- **Parent-suppression**: children of a shown duplicate folder pair are hidden,
  and duplicate *files* inside a shown duplicate folder are grouped under it
  (only stray file dups whose folders aren't full duplicates are listed).
- **Incremental Sync** (`folderdup:sync`): after the user deletes/moves things
  in Finder, one click re-walks reusing every directory whose mtime is
  unchanged (skips per-file stat) and re-analyzes — the report adapts and shows
  the reuse % (e.g. "reused 95%"). Snapshots are **persisted to disk**
  (`~/PebbleAlbum/cache`, `v8.serialize`) keyed by the roots, so reopening the
  tool resumes from cache + a quick sync.
- **Virtual list** (`src/components/ui/VirtualList.vue`) renders only on-screen
  rows so tens of thousands of results scroll smoothly.
- Click any path → reveal in Finder. Ignores junk files + system/dev dirs
  (toggle). **MCP parity:** `find_duplicate_folders` (roots, threshold,
  matchBy) returns the same outermost pairs + stray-file summary.

---

---

## Add photo overlay + non-destructive eraser — 2026-11

PicsArt-style "Add photo": drop another photo onto a page as a free object and
erase (and later restore) parts of it so what is below shows through.

- **Add photo button** (Layers tab) — opens a file dialog; files from outside the
  album folder are copied into `<sourceFolder>/added/` (new IPC `folder:addPhotos`),
  then placed as an overlay. *(Implemented by the app.)*
- **Free overlay** — a normal free `PageImage` (`free: true`, on top, no shadow) with
  move / resize / rotate like any other free object. *(Implemented by the app.)*
- **Erase / Restore brushes** with **size, opacity and hardness**, edited in context
  directly over the page. Low-opacity passes accumulate, so edges can be faded
  gradually; Restore brings erased pixels back. *(Implemented by the app.)*
- **Non-destructive** — the source photo is never modified. The erasing is stored as
  `PageImage.eraseMask`: a project-relative PNG under `<sourceFolder>/.pebble_masks/`
  whose alpha channel is the keep amount (opaque = keep, transparent = erased),
  stretched over the whole source photo. Every save writes a NEW uniquely named file
  (`<imageId>_<timestamp>.png`) and leaves the previous one in place (this is also
  what makes undo/redo a path swap). Saved through the new IPC `cutout:saveMask`.
- **Thumbnails keep alpha** for transparent PNGs, so cutouts and overlays are not
  flattened onto a background in the bin.
- **MCP parity** (same change, per the tool-parity rule):
  - `place_image {free:true, x?, y?, width?, rotation?}` — the agent's "Add photo":
    always a new free overlay above every other photo, no shadow, height from the
    photo's true aspect ratio.
  - `erase_image_region {imageId, mode?, shape?, x, y, width, height, opacity?, feather?}` —
    one brush stroke: erase/restore an ellipse or rect (0..1 fractions of the source
    photo), `opacity` 0..1, `feather` 0..1 (inverse of brush hardness). Starts from the
    existing mask or a fully opaque 1024-px-long-side one, does the alpha math in JS
    (`a *= 1 - opacity*coverage` / `a += (255-a)*opacity*coverage`), writes a new PNG
    and updates `eraseMask`.
  - `clear_image_erase` — drops `eraseMask` (files are never deleted).
  - `get_page` reports each image's `eraseMask`; `render_page` / `render_album` show
    the erasing (mask applied to the whole photo, then fit/crop, composited with alpha).
  - Sandbox: masks are written only inside the album's `.pebble_masks/` folder.

## Pixart — standalone photo editor — 2026-11

A third quick tool on the welcome screen: **Pixart — Photo Editor** (`/pixart`,
`PixartView`). Open one photo and edit it with the *album's own* image-editing
module — the same components the album editor and the Collage tool compose, not a
copy of them.

- **Open photo…** — the existing `folder:addPhotos` dialog (multi-select) with the
  workspace `<Pebble folder>/Pixart` as the source folder, so picked files are copied
  into `Pixart/added/` and erase masks land in `Pixart/.pebble_masks/`. The **first**
  picked photo is the base; any others from the same dialog are placed on top as
  free overlays. *(Implemented by the app.)*
- **The photo is the page.** A one-page in-memory project exactly like Collage
  (`createDefaultMeta`, `autoSave: false`, save path `null`), sized to the base
  photo's pixels (long side capped at 4000 px, proportional). The page is built by
  hand — **not** `composePage` — so there are no theme decorations or text: white
  background, layout `cover_full_bleed` (one slot covering the whole page), and the
  base as a slotted `cover` photo whose `slotRect` is the full page. *(Implemented by the app.)*
- **Editing** — `AlbumCanvas` (select / move / resize / rotate), `PropertiesPanel`
  (Move / Adjust / Filters / Frame / Shadow / Caption + **✎ Erase / restore parts**),
  `TextPropertiesPanel`, `PagePanel` (Layers + ＋ Add photo, Design, Proverb, Page)
  and the `CutoutEditor` studio, mounted from `editor.cutoutRequest` exactly as in the
  album. Header: ‹ Home, undo/redo, zoom, **＋ Add photo**, **Open another…** (asks
  before discarding an edited photo), **⬇ Save image**. Delete removes a free photo
  (undoable); the base photo cannot be removed. *(Implemented by the app.)*
- **⬇ Save image** — `renderPageStatic(page, meta, theme, loader, 1)` reading the
  full-resolution source files, then the Save dialog (`<base name>_pixart.png`).
- **One add-photo implementation.** The Add-photo logic moved out of `PagePanel` into
  `src/composables/useAddPhoto.ts`; the Layers-tab button (album, Collage) and Pixart's
  header button call the same function. Behaviour in the album is unchanged.
- **PagePanel `variant="photo"`** — Pixart hides the album-only parts that would break
  "the page is one photo": the **Layout** tab (it would re-slot the base photo into a
  template), the Slideshow settings and the page-strip tip.
- **The open album is safe.** On entry any album in the shared project store is
  stashed **with its undo/redo stacks** and the history is cleared; on leave the album,
  its page, its unsaved flag and its undo/redo history come back, so Pixart commands
  never reach the album and vice versa.
- **No session file (v1).** Edits live in memory until you leave Pixart or open
  another photo; nothing new was added to IPC.
- **Collage gap fixed** — `CollageView` now mounts `CutoutEditor` too, so
  "✎ Erase / restore parts" works in a collage (and collage shortcuts are ignored
  while the studio is open).
- **MCP:** nothing to add. Pixart has no `.pebble` file, so there is nothing for the
  MCP server to edit; the capabilities it uses (free overlays, erase masks, filters…)
  are the album's, which already have their tools (`place_image {free:true}`,
  `erase_image_region`, …).

## Filter brush — partial filter — 2026-11

PicsArt-style selective filters: once a filter or adjustment is applied to a photo,
brush it away from some areas (they show the original photo) and back in elsewhere.

- **Entry point** — Photo panel → **Adjust** or **Filters** tab → **Filter brush**
  (disabled, with a hint, until the photo has a filter or an adjustment). When a mask
  exists the button shows **Partial** and a **Clear** button (undoable) appears.
  Works in the album editor, Pixart and Collage (all mount the same studio).
  *(Implemented by the app.)*
- **The same studio as the eraser** (`CutoutEditor` with `mode="filter"`, not a copy):
  **Remove filter** / **Restore filter** / Pan (E / R / Space), the same Size /
  Opacity / Hardness brush, stroke-at-opacity accumulation, undo/redo, Reset (= filter
  everywhere), Fit view, Show page. The preview shows the real result — brushed areas
  unfiltered, the rest filtered, erasing still applied. AI removal and the sticker
  section are hidden. **Apply** (pinned) saves only the mask. *(Implemented by the app.)*
- **Data** — `PageImage.filterMask`: same rules as `eraseMask` (PNG under
  `.pebble_masks/`, a NEW `<imageId>_fx_<timestamp>.png` per save, un-flipped
  source-pixel space, stretched over the whole photo); alpha = how much of the
  effects apply (255 filtered, 0 original); absent = filter everywhere. History
  command `editorStore.setFilterMask` (undo/redo swaps the path). Saved through the
  existing `cutout:saveMask` IPC with an optional `kind: 'filter'`.
- **What is masked** — the whole per-pixel colour pipeline of `effects`: named preset
  at its strength + every adjust slider including blur, sharpen and grain. The
  vignette, border and shadow are separate overlay objects and are NOT masked.
- **Rendering (one place)** — `pageRenderer.applyEffects` blends the original back in
  after every filter pass (`engine/maskBlend.ts`: destination-in / destination-out /
  additive on Fabric's 2D filtered canvas), so the editor canvas, live slider updates
  (no rebuild), hold-to-compare, page thumbnails, page-turn preview and export agree,
  on both the WebGL and the Canvas2D filter backends. No extra GL textures.
- **Consistency** — moving a photo to another page carries `filterMask`; page
  thumbnails refresh when it changes; copy-style (MCP `copy_image_style`; the app has
  no in-app copy-style) never copies masks.
- **MCP parity** — `get_page` reports `filterMask`; `mask_image_filter_region
  {imageId, mode: remove|restore, shape?, x, y, width, height, opacity?, feather?}`
  (one stroke, 0..1 fractions of the un-flipped source, mirrors `erase_image_region`)
  and `clear_image_filter_mask`. `render_page` now renders photo effects (a port of
  the app's filter stack on Fabric's Canvas2D maths) and blends through the mask.
- **Known limitations** — the app bakes the erase mask BEFORE filtering; `render_page`
  and the studio's live preview apply it after the blend, so blur / sharpen pixels
  along erased edges can differ slightly. The MCP blend is straight-alpha (the app's
  is premultiplied), which differs only on partly erased pixels. MCP previews read
  tint/duotone colours as hex or `rgb()/rgba()` only (others skip the tint).

---

## Scope notes (research-preview build)

This build prioritises a **runnable core + complete documentation**. The
following are implemented as solid working baselines and are the natural next
depth passes:

- **Interactive crop mode** — model + double-click hook exist; the in-slot
  pan/zoom crop UI is a follow-up.
- **Multi-select drag-from-bin auto-layout** — single add-to-page is implemented;
  multi-image drop is a follow-up.
- **SVG overlay decorations** — procedural (`canvas_draw`) decorations are fully
  rendered; `svg_overlay` assets are wired but ship as optional drop-ins under
  `assets/overlays/`.
- **Page templates / save-as-template** and **watermark render-on-export** —
  data model is present; UI actions are follow-ups.

These are tracked here so contributors and agents know exactly where the edges
are and can extend without surprises.
