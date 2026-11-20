# PebbleAlbum — Overview & Golden Rules

**PebbleAlbum** is a professional desktop studio for designing **print-ready photo
albums**: multi-photo collage pages, decorative patterns, stickers, themed
typography, proverbs/quotes, and beautiful covers. Think Fundy Designer /
SmartAlbums, but you (the AI) can drive it.

You edit a **project** — a single `.pebble` JSON file that is the album's source
of truth. Every tool here loads that file, changes it, and saves it immediately,
so the desktop app reflects your edits when the user opens/reloads the project.

## What you can do
- Read the album (`get_project`, `get_page`, `list_images`).
- **See** pages and photos cheaply (`render_page`, `view_image` → small JPEGs).
- Build pages: `add_page`, `update_page` (incl. re-layout), `move_page`, etc.
- Overlay a photo (`place_image {free:true}`) and erase/restore parts of it
  non-destructively (`erase_image_region`, `clear_image_erase`).
- Keep a filter on only part of a photo — the Filter brush
  (`mask_image_filter_region`, `clear_image_filter_mask`).
- Place & style photos: `place_image`, `update_image` (move/scale/rotate/fit/
  effects), `set_image_border` (line, **gradient**, or **decorative SVG frame**),
  `set_image_shadow`.
- Decorate: `add_pattern` (behind photos), `add_sticker` (emoji or SVG, in front).
- Text: `add_text`, `add_proverb`, `update_text` — movable, rotatable, any font.
- Album: `set_theme`, `update_album`.

## Golden rules
1. **Always `pebble_guide` → read `pebble-gotchas` + a skill or two → then
   `get_project`.** Know the album (and the state-behaviour gotchas) before editing.
2. **Photos are never stretched.** Use `fit` (cover/contain/auto) and frames; do
   not force non-uniform width/height to distort a photo. **Match photo orientation
   to slot orientation** (`list_catalog layouts` with `project`) so faces aren't cropped.
3. **Use valid ids.** Call `list_catalog` for layouts, themes, patterns,
   stickers, borderFrames, filters, fonts before using those values.
4. **Vary it & decorate it.** Don't repeat one layout >~twice; give most pages a
   tasteful pattern and the occasional frame/sticker. A bare, repetitive book looks
   auto-generated.
5. **Batch, don't loop.** Style many photos with `set_page_image_style` (presets!)
   instead of per-image border/shadow calls.
6. **Verify with `render_album`** (whole book in one call), then `render_page` only
   the pages you're fixing. Keep `maxWidth`/`quality` modest.
7. **The `.pebble` file is sacred** — your edits persist there. Don't invent
   filenames; only use photos from `list_images`.

## Coordinates
All positions/sizes are in **album pixels** (`meta.albumWidth` × `albumHeight`).
A slot frame is `slotRect`; the photo's display box is `position` (cover-fit and
clipped to the frame). Page/text/sticker positions are absolute album px.
