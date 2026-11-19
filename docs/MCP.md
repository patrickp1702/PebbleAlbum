# PebbleAlbum — AI Integration & the MCP Server

PebbleAlbum ships a built-in **MCP (Model Context Protocol) server** so an external
AI agent (Claude Desktop, etc.) can design albums by driving the app's full feature
set. This document explains the concept, the architecture, and the one rule that
keeps it trustworthy.

---

## ⭐ THE MCP TOOL-PARITY RULE (mandatory, non-negotiable)

> **Every capability a user can perform in the PebbleAlbum UI MUST be exposed as an
> MCP tool — and every NEW feature MUST ship its MCP tool in the SAME change.**

The MCP server is a **first-class client of the album model, equal to the GUI** —
never an afterthought or a partial mirror. Concretely, a feature is only "done"
when **all three** are true:

1. **UI** — a user can do it in the app, and
2. **Model** — it persists to the `.pebble` file (the single source of truth), and
3. **Agent** — an AI agent can do the same thing through an MCP tool, and — when the
   feature is visual — can **see** the result via `render_page` / `view_image`.

If you add a feature and don't add (or extend) the matching MCP tool, the feature
is **incomplete**. This rule is intentional: it guarantees the agent and the human
always have the same power, and that "make me an album" can actually use everything
the studio offers.

**Checklist for every new feature / capability:**

- [ ] UI control implemented and wired to the `.pebble` model.
- [ ] `.pebble` types updated (`src/types/pebble.types.ts`) if the schema changed.
- [ ] **MCP tool added or extended** in `mcp/pebble-mcp-server.mjs` to drive it.
- [ ] If it introduces new ids/values (layout, theme, pattern, border, sticker,
      filter, font…), it's discoverable via `list_catalog`.
- [ ] If it's visual, it shows up in `render_page` output (extend the sharp
      preview compositor if needed).
- [ ] A skill doc (`mcp/skills/*.md`) mentions it where an agent would look.

---

## 1. What the MCP server is

`mcp/pebble-mcp-server.mjs` is a **standalone Node process** that an AI agent
launches over **stdio** (newline-delimited JSON-RPC 2.0, the MCP stdio transport).
It depends only on Node built-ins + `sharp`.

It does **not** require the desktop app to be running. It reads and writes the same
`.pebble` JSON files the app uses (in `~/Documents/Pebble`), so:

```
        ┌──────────────┐        edits the same          ┌──────────────┐
        │ PebbleAlbum  │ ─────▶  ~/Documents/Pebble/ ◀───── │  MCP server  │
        │  desktop app │         *.pebble (truth)         │ (AI agent)   │
        └──────────────┘                                 └──────────────┘
```

Anything the agent designs appears in the app the next time the project is opened
or reloaded. The `.pebble` file remains the **single source of truth**; both the
GUI and the agent are just editors of it.

## 2. Why a separate process (not a renderer feature)

- An external agent must be able to launch it via a simple `command + args` config,
  independent of the Electron app's lifecycle.
- It keeps native/file work out of the sandboxed renderer (same principle as the
  app's IPC layer).
- Server-side rendering with `sharp` lets the agent *see* pages/photos as small
  JPEGs without paying a huge token cost.

## 3. Connect flow (what the user does)

In the app: **open a project → top bar → 🤖 Connect AI**. The panel
(`AiConnectModal.vue`, fed by `electron/ipc/ai.ipc.ts` → `getMcpConnectInfo`) gives:

1. **Copy config** — the MCP client JSON, with the resolved `node` command, absolute
   server path, and env (projects folder + app/config/asset/skill dirs):
   ```json
   {
     "mcpServers": {
       "pebble-album": {
         "command": "node",
         "args": ["/abs/path/mcp/pebble-mcp-server.mjs"],
         "env": { "PEBBLE_HOME": "…/Documents/Pebble", "PEBBLE_APP_ROOT": "…" }
       }
     }
   }
   ```
2. **Copy prompt** — a starter prompt pre-filled with the open project's name.

The user pastes the config into their agent (e.g. `claude_desktop_config.json`),
**fully restarts** the agent app so it spawns the server, then pastes the prompt.

## 4. Vision tools (cheap on purpose)

`render_page` and `view_image` rasterize with `sharp` and return small JPEGs
(default ≤ 640 px, quality ~62 — a page is typically ~5–80 KB). The agent uses them
to verify its work without large token cost. `render_page` composites each photo
into its slot (cover/contain, never stretched), then overlays text/stickers.
Erased areas (`eraseMask`) are **shown**: the mask is applied to the whole photo
first, then the photo is fitted/cropped with alpha, so what is below shows through.
Photo `flipX`/`flipY`, `position.rotation` and `opacity` are shown too, matching
the app: the photo is mirrored about its own centre, then rotated clockwise about its
**top-left** corner, then its alpha is multiplied by `opacity`; slotted photos are
clipped to their (unrotated) slot, and a photo partly off the page is cropped, not
shifted. `erase_image_region` x/y/width/height are fractions of the **un-flipped**
source photo (the mask is applied before the flip, exactly as in the app).

## 5. Tool catalog (51 tools)

| Group | Tools |
|---|---|
| Discovery | `pebble_guide`, `list_skills`, `read_skill`, `list_projects`, `get_project`, `get_page`, `list_images`, `list_catalog` |
| Vision | `render_page`, `view_image` |
| Pages | `add_page`, `delete_page`, `duplicate_page`, `move_page`, `update_page` (incl. re-layout) |
| Images | `place_image` (`free:true` = the app's "Add photo" overlay: always a new free object on top, optional x/y/width/rotation), `update_image` (geometry + filter preset w/ `filterStrength` + ADJUST sliders: exposure/brightness/contrast/highlights/shadows/saturation/temperature/tint/hue/sharpness/blur/noise/vignette), `set_image_mask` (shape crop: circle/heart/star/… — see `list_catalog masks`), `set_image_border` (line / gradient / decorative frame), `set_image_shadow`, `remove_image`, `swap_images`, `erase_image_region` (non-destructive brush stroke: erase/restore an ellipse/rect, given as 0..1 fractions of the photo, with opacity + feather → new mask PNG in `.pebble_masks/`), `clear_image_erase` (drop the erasing) |
| Decorations | `add_pattern`, `add_sticker`, `remove_decoration` |
| Text / proverbs | `add_text`, `add_proverb`, `update_text` (incl. `curve` for bent/circular text), `remove_text` |
| Cutouts / stickers | `remove_background` (client-side AI, optional saveAsSticker), `list_custom_stickers`, `add_sticker` (svg / emoji / custom `file`) |
| Album | `set_theme`, `update_album` (incl. slideshow: interval, turn style/speed, music playlist), `list_music` |
| Utilities | `find_duplicate_folders` (duplicate folders + files across roots; metadata-only, containment similarity, within/across scope) |

Every edit tool loads the `.pebble`, mutates it, and saves immediately (+ `.bak`),
mirroring the app's "edit = persisted" contract.

## 6. Skills

`mcp/skills/*.md` teach the agent: the app's purpose (`pebble-overview`), the
recommended workflow (`pebble-workflow`), the filename-label system
(`pebble-labels`), the catalogs (`pebble-catalogs`), and a tool cheat-sheet
(`pebble-tools`). The agent fetches them with `read_skill`; `pebble_guide` points
the way.

## 7. How to extend the server (apply the parity rule)

1. Add an entry with `tool(name, description, inputSchema, handler)` in
   `mcp/pebble-mcp-server.mjs`. Handlers use `edit(project, (proj)=>{…})` which
   loads → mutates → saves the `.pebble`.
2. Reuse the geometry helpers (`slotRectFromSlot`, `coverBox`, `newPageImage`) so
   placement matches the app (uniform scale — never stretch).
3. If you added catalog values, surface them in `list_catalog` (and keep the
   server's small hardcoded lists, e.g. `BORDER_FRAMES`, in sync with the engine).
4. If the feature is visual, make sure `render_page`'s sharp compositor reflects it
   (or note the limitation in the result text).
5. Update the relevant `skills/*.md`.

## 8. Security sandbox (the agent can't touch anything else)

The server is hardened so a connected LLM can only act within the album, never on
the wider filesystem:

- **Project writes are confined to `PEBBLE_HOME/*.pebble` (+ its `.bak`).** A
  `project` argument is accepted only as a bare name or as an absolute `.pebble`
  path *inside* `PEBBLE_HOME`; anything else is refused. The server **deletes no
  files at all**.
- **The only other writes are new files inside the album folder:** cutout PNGs to
  `<sourceFolder>/cutouts/` (`remove_background`) and erase masks to
  `<sourceFolder>/.pebble_masks/` (`erase_image_region`; every save is a NEW
  `<imageId>_<timestamp>.png`, older ones stay on disk). Both paths are validated to
  stay inside the album folder (same containment + symlink checks as image reads;
  a `.pebble_masks` that resolves outside the album is refused).
- **Image reads are confined to the project's album `sourceFolder`.** Every
  filename/member path must be **relative** and resolve to a location *inside* that
  folder. **Absolute paths and `../` traversal are rejected**, and symlink escapes
  are blocked (best-effort `realpath` containment check).
- Sticker/overlay ids are sanitised to bare names before any file read.
- **Exception — `find_duplicate_folders`:** this utility deliberately scans the
  arbitrary `roots` the user/agent names (its whole purpose is comparing folders
  or drives outside any project). It is strictly **read-only** — it stats file
  names/sizes/mtimes only, never reads file contents, and never writes or deletes
  anything.
- All of this lives in one place (`safeImagePath` / `assertSafeRelative` /
  `resolveProjectPath` / `saveProject` guards) and is covered by a security test
  (traversal, absolute paths, and out-of-home project args are all refused while
  legitimate reads/edits succeed).

## 9. Packaging note

A plain Node process can't read inside an Electron `asar`. Packaged builds ship the
server, its skills, and the config JSONs as **extraResources**
(`electron-builder.config.cjs`), and `ai.ipc.ts` points the server at those paths
via `PEBBLE_CONFIG_DIR` / `PEBBLE_ASSETS_DIR` / `PEBBLE_SKILLS_DIR`.

See `mcp/README.md` for run/debug details and the full env-var table.
