# PebbleAlbum

A professional, cross-platform **desktop photo album creation studio** built with
Electron + Vue 3 + TypeScript. PebbleAlbum turns a folder of photos into a
beautiful, print-ready album with multi-image collage pages, themes, decorations,
proverbs, a WebGL page-turn preview, and PDF/JPEG/PNG export.

> The source images are **never copied or uploaded**. PebbleAlbum stores only the
> absolute folder path and reads images on demand. The entire album lives in a
> single `.pebble` JSON file that reconstructs your work pixel-perfect on reopen.

> **AI-drivable.** PebbleAlbum runs a built-in **MCP server** so an AI agent can
> design albums with the same power you have. **Rule:** every feature a user can do
> is exposed as an MCP tool — and every new feature must add its tool in the same
> change. See [`docs/MCP.md`](docs/MCP.md).

---

## Quick start

```bash
# 1. Install dependencies (Node 18+ recommended)
npm install

# 2. Run in development (hot-reload Electron + Vue)
npm run dev

# 3. Type-check the whole codebase
npm run typecheck

# 4. Build the renderer + main bundles
npm run build

# 5. Package an installable app for your platform
npm run dist          # current OS
npm run dist:mac      # macOS  → release/*.dmg, *.zip
npm run dist:win      # Windows → release/*.exe (NSIS)
npm run dist:linux    # Linux  → release/*.AppImage, *.deb
```

Packaged installers are written to `release/`. App icons are expected in
`build/` (`icon.icns`, `icon.ico`, `icon.png`) — drop yours in before packaging.

---

## Troubleshooting

### macOS: "Malware Blocked and Moved to Bin" for `Electron.app`, then `spawn … Electron ENOENT`

**Symptoms** (seen August 2026, macOS Sequoia):

1. On first launch, macOS shows **"'Electron.app' was not opened because it
   contains malware. This action did not harm your Mac."**
2. Every `npm run dev` afterwards crashes with:
   ```
   Error: spawn .../node_modules/electron/dist/Electron.app/Contents/MacOS/Electron ENOENT
   ```

**What is actually happening.** This is **not** malware in this repo. macOS
XProtect (the built-in anti-malware) false-positives on **old prebuilt Electron
runtime binaries** — a known, widespread issue since an XProtect signature update
in May 2026 (it also hit other dev tools shipping stale binaries). "Moved to Bin"
means macOS **deletes** `node_modules/electron/dist/Electron.app`, which is why
later runs fail with `ENOENT` (only the LICENSE files are left in `dist/`).

**Fix — upgrade Electron to a current stable version; do NOT disable
Gatekeeper/XProtect:**

```bash
npm install -D electron@latest
```

```bash
node node_modules/electron/install.js
```

```bash
npm run dev
```

The second command force-downloads the Electron binary — run it whenever
`node_modules/electron/dist/Electron.app` is missing (e.g. the postinstall
script didn't run or the binary was deleted). This exact sequence resolved the
issue on 2026-08-05 by moving from Electron 31.7.7 (EOL, flagged) to 43.2.0
(clean). If a current Electron build ever gets flagged too, restoring the file
and stripping quarantine flags is **not** the answer — XProtect will keep
re-deleting it; wait for an Apple signature update or check
[electron/electron issues](https://github.com/electron/electron/issues) for the
current guidance.

---

## Tech stack

| Layer | Technology |
|---|---|
| Shell | Electron 43 |
| UI | Vue 3 (`<script setup>` Composition API) |
| Build | Vite + electron-vite |
| Styling | Tailwind CSS v3 |
| Canvas engine | Fabric.js v6 |
| Page-turn | Three.js |
| State | Pinia |
| Image processing | Sharp (main process) |
| Export | PDFKit + Sharp |
| Language | TypeScript (strict) |
| Packaging | electron-builder |

---

## How it works (60-second tour)

1. **Welcome** → create a new project or open a recent `.pebble`.
2. **Setup wizard (6 steps)** → choose a folder, set identity/size/DPI, pick a
   theme, add proverbs, tune advanced options, then **Generate Album**.
3. **Album generator** parses filenames into styling labels, sorts/groups images,
   scores and selects layouts, composes each page, applies theme decorations, and
   places proverbs.
4. **Editor** → drag/resize/rotate images on a Fabric.js canvas, adjust effects,
   borders, shadows, captions; switch layouts/themes/decorations live; manage
   pages. Every edit autosaves to the `.pebble` file (debounced, 2s).
5. **Preview** → flip through pages with a Three.js page-turn animation.
6. **Export** → render every page at full DPI to PDF / JPEG / PNG, with an
   optional print checklist (low-res + missing-image warnings).
7. **Connect AI** (optional) → copy the MCP config + a starter prompt, paste them
   into your AI agent, and let it design the album for you using the MCP tools.

---

## Standalone quick tools (no project)

Two folder-level utilities launch from the welcome screen and reuse the album's own
engine + editor components, so they stay loosely coupled and never touch the
`.pebble` project system:

- **Collage Creator** (`/collage`) — pick a folder and a few photos, then drop into a
  **full interactive editor** (the same canvas, properties, borders, effects,
  decorations, stickers and text as an album page) and **download** the result as an
  image. The collage **autosaves to a single hidden session file** and **resumes
  exactly where you left off** after a close/crash (a *Resume collage* banner appears
  on the welcome screen); **Clear** discards it.
- **Duplicate Finder** (`/duplicates`) — scan a folder for near-duplicate / burst
  shots with **live progress**, adjust a **match-strictness** slider (re-groups
  instantly), compare a set **full-screen**, collapse sets, review a **"Possibly
  blurry"** bucket, and **move** unwanted frames into a reversible `duplicate/`
  subfolder (never deleted).

---

## Filename label system

Filenames drive layout and styling intent, e.g.:

```
beach_sunset_lg_warm_proverb_cap-our-first-trip.jpg
```

`lg` (large slot) · `warm` (filter) · `proverb` (attach a proverb to the page) ·
`cap-our-first-trip` (caption). Labels are case-insensitive and order-independent.
See `src/engine/filenameParser.ts` and the full table in `docs/ARCHITECTURE.md`.

---

## Project layout

```
electron/        Main process: window, IPC handlers (folder/image/thumb/project/export/ai/analyze/files)
src/
  views/         Welcome · Setup wizard · Editor · Export · Collage · DuplicateFinder
  components/     canvas/ · editor/ · setup/ · ui/
  stores/        Pinia: project · editor · history · app · collage
  engine/        Pure logic: parser · layout · composer · deco · theme · generator · export · pageRenderer · borderFrames · similarity
  config/        layouts · themes · patterns · borders · fonts · defaultProverbs (JSON) · overlays/stickers (file-loaded SVG)
  types/         Shared TypeScript model (.pebble format + IPC contract)
mcp/             Standalone MCP server (pebble-mcp-server.mjs) + skills/ — the AI tool surface
assets/          overlays/ · sticker/ — themeable + colour SVG art (inlined at build)
docs/            ARCHITECTURE.md · MODULES.md · MCP.md · TEST_PLAN.md · ADDED_FEATURES.md
```

A more detailed map, the `.pebble` schema, and the data-flow diagrams live in
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

---

## The `.pebble` file

A single JSON document that is the ground truth for an album: meta, pages
(images + decorations + text + proverbs), and the scanned image registry. It is
human-readable, diff-friendly, and backed up to `<name>.pebble.bak` on every save
for crash recovery. Full schema in `src/types/pebble.types.ts`.

---

## AI integration (MCP)

PebbleAlbum includes a built-in **MCP server** (`mcp/pebble-mcp-server.mjs`) — a
standalone Node process an AI agent launches over stdio. It edits the same
`.pebble` files the app uses, so albums an agent designs show up here on reload.
It exposes **30 tools** covering every album action (pages, image placement /
transform / effects / borders incl. gradient + decorative frames, decorations,
stickers, text & proverbs, theme) plus **low-cost vision** tools (`render_page`,
`view_image` return small JPEGs so the model can *see* its work cheaply) and
**skill** docs that teach it the workflow.

> **The MCP Tool-Parity Rule (mandatory):** every capability a user can perform in
> the UI **must** be exposed as an MCP tool, and **every new feature must ship its
> MCP tool in the same change.** The agent and the human always have equal power.
> Full concept, connect flow, and the per-feature checklist are in
> [`docs/MCP.md`](docs/MCP.md); run/debug details in [`mcp/README.md`](mcp/README.md).

Connect it from the editor: **🤖 Connect AI** → copy config + prompt into your agent.

---

## Security model

- `contextIsolation: true`, `nodeIntegration: false`.
- The renderer has **no** Node/`fs` access. Every privileged action goes through a
  typed `window.pebble.*` bridge (`electron/preload.ts`) to IPC handlers that run
  only in the main process.
- A strict Content-Security-Policy is set in `index.html`.

---

## For AI agents & contributors

- Start with `docs/ARCHITECTURE.md` for the system model and data flow, and
  `docs/MODULES.md` for the module map + invariants.
- The `engine/` modules are **pure** (no DOM/Fabric except `pageRenderer`/`fabricFilters`)
  and are the best place to add or unit-test behaviour.
- **Read [`docs/MCP.md`](docs/MCP.md) and honour the MCP Tool-Parity Rule:** any
  feature you add must also be exposed as an MCP tool in `mcp/pebble-mcp-server.mjs`
  (and discoverable via `list_catalog` / a skill). A feature without its MCP tool is
  incomplete.
- `docs/TEST_PLAN.md` enumerates features and edge cases so you can generate a
  test suite directly from it.
- New capabilities and the rationale for them are tracked in `docs/ADDED_FEATURES.md`.

## License

MIT.
