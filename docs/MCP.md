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
It depends only on Node built-ins + `sharp` (the AI Enhance tools additionally
load `@vladmandic/face-api` lazily — see §10).

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
Photo **effects** are shown too (named filter at its strength + every adjust
slider, ported from the app's filter stack onto Fabric's own Canvas2D filter maths;
the vignette overlay is not drawn), and the **Filter brush** mask (`filterMask`)
blends the original back in: per pixel `original·(1−m) + filtered·m`, then the
erase mask is applied. Known preview differences from the app (approximations,
accepted): the app bakes the erase mask into the photo BEFORE filtering, while
`render_page` (and the brush studio's live preview) apply it AFTER the blend — this
only changes blur / sharpen pixels along erased edges; the MCP blend is done in
straight alpha (the app's canvas blend is premultiplied), which only differs on
partly erased pixels; colours in `tintColor` / duotone are read as hex or
`rgb()/rgba()` — anything else (e.g. named colours) skips that tint in the preview;
and the MCP port follows Fabric's Canvas2D maths, so it can differ by a few levels
from the app's WebGL output.

## 5. Tool catalog (62 tools)

| Group | Tools |
|---|---|
| Discovery | `pebble_guide`, `list_skills`, `read_skill`, `list_projects`, `get_project`, `get_page`, `list_images`, `list_catalog` |
| Vision | `render_page`, `view_image` |
| Pages | `add_page`, `delete_page`, `duplicate_page`, `move_page`, `update_page` (incl. re-layout) |
| Images | `place_image` (`free:true` = the app's "Add photo" overlay: always a new free object on top, optional x/y/width/rotation), `update_image` (geometry + filter preset w/ `filterStrength` + ADJUST sliders: exposure/brightness/contrast/highlights/shadows/saturation/temperature/tint/hue/sharpness/blur/noise/vignette), `set_image_mask` (shape crop: circle/heart/star/… — see `list_catalog masks`), `set_image_border` (line / gradient / decorative frame), `set_image_shadow`, `remove_image`, `swap_images`, `erase_image_region` (non-destructive brush stroke: erase/restore an ellipse/rect, given as 0..1 fractions of the photo, with opacity + feather → new mask PNG in `.pebble_masks/`), `clear_image_erase` (drop the erasing), `mask_image_filter_region` (Filter brush stroke: `mode` remove/restore the photo's filter + adjustments over an ellipse/rect in 0..1 fractions of the un-flipped source, opacity + feather → new `<imageId>_fx_<ts>.png`, sets `filterMask`), `clear_image_filter_mask` (filter everywhere again). `copy_image_style` copies effects but never a photo's masks |
| Decorations | `add_pattern`, `add_sticker`, `remove_decoration` |
| Text / proverbs | `add_text`, `add_proverb`, `update_text` (incl. `curve` for bent/circular text), `remove_text` |
| Cutouts / stickers | `remove_background` (client-side AI, optional saveAsSticker), `list_custom_stickers`, `add_sticker` (svg / emoji / custom `file`) |
| Album | `set_theme`, `update_album` (incl. slideshow: interval, turn style/speed, music playlist), `list_music` |
| AI Enhance | `enhance_provider_status`, `enhance_get_queue`, `enhance_set_settings`, `enhance_set_queue`, `enhance_set_status`, `enhance_generate`, `enhance_compare_faces`, `enhance_composite`, `enhance_view` — see §10 |
| Utilities | `find_duplicate_folders` (duplicate folders + files across roots; metadata-only, containment similarity, within/across scope) |

Every edit tool loads the `.pebble`, mutates it, and saves immediately (+ `.bak`),
mirroring the app's "edit = persisted" contract.

## 6. Skills

`mcp/skills/*.md` teach the agent: the app's purpose (`pebble-overview`), the
recommended workflow (`pebble-workflow`), the filename-label system
(`pebble-labels`), the catalogs (`pebble-catalogs`), a tool cheat-sheet
(`pebble-tools`), and the AI Enhance loop with its verdict thresholds
(`pebble-enhance`). The agent fetches them with `read_skill`; `pebble_guide` points
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
  `<sourceFolder>/.pebble_masks/` (`erase_image_region`, `mask_image_filter_region`;
  every save is a NEW `<imageId>_<timestamp>.png` / `<imageId>_fx_<timestamp>.png`,
  older ones stay on disk), and AI Enhance outputs to
  `<sourceFolder>/enhanced/<stem>/` (`attempt-<n>.png`, `final.jpg` — the only
  files the server overwrites, and only its own outputs). All are validated to
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

## 10. AI Enhance — identity-safe re-imagining

The **AI Enhance** studio (Welcome tool card / editor top bar → *Enhance*) lets the
user change a photo's **scene, wardrobe and lighting** with their own image API
while every person keeps their **real face**. The UI only prepares the job (queue,
scene wish, identity paragraph, provider settings) and hands the agent ONE prompt;
the agent runs the loop through the `enhance_*` tools (code: `mcp/enhance/`).

### The loop (per queued photo)

```
 enhance_get_queue ──▶ enhance_generate ──▶ judge preview + metrics ──fail──▶ refine prompt ─┐
                        ▲  (≤ maxAttempts)          │ pass                                     │
                        └───────────────────────────┼──────────────────────────────────────────┘
                                                    ▼
                                    enhance_composite (ORIGINAL face back) ──▶ check blend crop
                                                    │                     └─ seam? re-run with more feather
                                                    ▼
                         enhanced/<stem>/final.jpg, registered in imageRegistry, status done
```

1. **Generate** — `enhance_generate` sends the photo (EXIF-upright, long side ≤ 2048)
   to the configured provider with the agent's prompt + a pose-lock line. When the
   provider accepts a mask (OpenAI / OpenAI-compatible) and `keepFace` is on, a mask
   PNG keeps the face pixels (opaque feathered face, transparent = regenerate);
   otherwise the identity paragraph is appended to the prompt. Output:
   `enhanced/<stem>/attempt-<n>.png` (status `review`).
2. **Judge** — the result carries face metrics for source and variant (largest face,
   `@vladmandic/face-api` on the CPU, weights loaded from the package — no network):
   `yawDiff` / `pitchDiff` / `rollDiff` (degrees, geometric estimates from 68
   landmarks, meant for differences) and `similarity` (1 − descriptor distance).
   Pass: yaw/pitch ≤ 8°, roll ≤ 6°, face detected, scene right. `enhance_compare_faces`
   shows source | variant face crops side by side.
3. **Composite** — `enhance_composite` aligns the ORIGINAL face onto the variant with a
   least-squares similarity transform from 5 landmarks (eye centres, nose tip, mouth
   corners), warps it bilinearly, masks it with a convex landmark polygon (jaw + brows
   lifted by `maskTop`, scaled by `expand`) feathered inward by a 3-pass box blur
   (`feather` = fade width as a fraction of the face width), matches skin tone with a
   Reinhard transfer in CIE Lab over the face region (σ ratio clamped to 0.7–1.4,
   blended by `toneMatch`) and writes `final.jpg` (JPEG q92, the variant's resolution).
   The final is registered like a `remove_background` cutout, the attempt is marked
   `accepted` and the item `done`. Re-running only re-composites (no API cost).

### Tools

| Tool | Does |
|---|---|
| `enhance_provider_status {}` | configured?, provider, model, key hint, `supportsMask` — never the key |
| `enhance_get_queue {project}` | settings + items (status, attempts with metrics, resultPath) + counts |
| `enhance_set_settings {project, scenePrompt?, identityText?, keepFace?, maxAttempts?}` | parity with the studio form |
| `enhance_set_queue {project, add?, remove?}` | parity with ticking photos (registry relativePaths) |
| `enhance_set_status {project, filename, status, note?}` | e.g. `failed` / `skipped` with a reason |
| `enhance_generate {project, filename, prompt, keepFace?, size?, quality?}` | one provider call → attempt PNG + metrics + ≤ 640 px preview; enforces `maxAttempts` |
| `enhance_compare_faces {project, filename, variant?}` | source \| variant face crops (≤ 320 px each) + metrics |
| `enhance_composite {project, filename, variant?, feather?, toneMatch?, expand?, maskTop?}` | final.jpg + metrics (`alignmentResidualPx`, `scale`, `rotationDeg`, `maskPx`) + preview + blend crop |
| `enhance_view {project, filename, which, attempt?, maxWidth?}` | ≤ 640 px preview of source / attempt / final |

### Privacy

- **Full-resolution pixels go only to the user's configured provider and to disk**
  (`<sourceFolder>/enhanced/`). Nothing is uploaded until the agent calls
  `enhance_generate`; the `mock` provider uploads nothing at all.
- **The agent only ever sees ≤ 640 px JPEG previews** (and ≤ 320 px face crops).
- **The API key never leaves `<PEBBLE_HOME>/ai-provider.json`** (mode 0600, written by
  the app via `mcp/enhance/providerConfig.mjs`): it is not in the MCP config JSON,
  not in any `.pebble`, never returned by a tool, and provider error messages are
  scrubbed of it.
- **Deliberate parity exception:** saving / testing / clearing the provider settings
  (the API key) is UI-only. An agent must never handle the key, so there is no MCP
  tool to write it; `enhance_provider_status` is the read-only, key-free mirror.

### Testing

`node mcp/enhance/smoke.mjs <photo-with-a-face.jpg> [--out dir] [--keep]` builds a
throwaway `PEBBLE_HOME` + album with the offline `mock` provider and drives the whole
loop over stdio (initialize → tools/list → queue → settings → generate → compare →
composite → queue → view), asserting the outputs, registry entry, metrics, sandbox
confinement and a JSON-only stdout.
