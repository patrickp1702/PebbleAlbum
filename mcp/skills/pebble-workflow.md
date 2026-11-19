# Recommended Workflow — Designing an Album as an Agent

Follow this loop to produce a polished album the user will love.

## 1. Orient
1. `pebble_guide`, then `read_skill` for **`pebble-gotchas`** (saves the most calls)
   and `pebble-catalogs`.
2. `list_projects` → find the project the user created. If they named it, use
   that name; otherwise pick the most recent.
3. `get_project` → read the meta (theme, dimensions, cover title, source folder)
   and the page summaries (note any `notPlaced` photos).
4. `list_images` → see every photo, its aspect ratio, and parsed filename labels.
   `read_skill pebble-labels` for the labels.
5. `list_catalog { kind:"layouts", project }` → learn each layout's **slot
   orientation** for THIS album (portrait vs landscape) so you can match photos and
   avoid face-cropping.
6. **Cull first.** `find_duplicates` → `view_group` any you're unsure about →
   `cull_duplicates` (keep the sharpest, best-exposed frame of each burst) or
   `select_photos`. Only kept photos are used in the album — this avoids near-dupes
   and blurry/overexposed shots before you spend effort laying them out.

## 2. Plan
- Decide a narrative/order. Group related photos onto pages.
- Pick layouts that match photo counts and shapes (portraits → tall slots,
  landscapes → wide slots). `list_catalog layouts`.
- Pick or confirm a theme that fits the occasion. `list_catalog themes`.
- Sample a few photos with `view_image` (small) if you need to judge content.

### Variety rules (so it doesn't look auto-generated)
- **Don't repeat a layout more than ~twice** in the album. Pull from the full
  catalog (heroes, mosaics, magazine, panorama, diagonal, polaroid scatter…), not
  just the portrait grids.
- **Match orientation:** portrait photo → portrait slot, landscape → landscape slot
  (use the `orientation` from `list_catalog … project`). This is what keeps faces
  intact.
### Design-richness checklist (DON'T under-decorate — a bare album looks unfinished)
Aim to use most of these across the album (tasteful, not cluttered):
- **A decorative frame** (`set_image_border` / `set_page_image_style` preset
  `scallop_frame`, or `list_catalog borderFrames`: scallop_fan, washi_tape,
  film_strip, polaroid…) on the cover hero and 2–3 feature photos. Plain line
  borders or a **gradient border** elsewhere.
- **A background per spread** — a tasteful `add_pattern`, or a page
  `backgroundGradient` / `backgroundPattern` (`update_page`). Vary it; don't leave
  every page flat white.
- **Stickers** on the cover + celebratory pages (`add_sticker`). For a birthday use
  the birthday pack (number badges, `cake`, `balloon_cluster`, `confetti_burst`,
  `happy_birthday`, `party_hat`); otherwise butterflies/stars/hearts/leaves. 1–3 per
  decorated page, in corners/gaps — never on faces.
- **Focal crop faces**: `update_image { focusX, focusY, zoom }` so no one is
  decapitated (especially portraits in landscape slots).
- **Legible captions/proverbs**: when text sits over a photo, add a `background`
  plate or `strokeWidth`+`strokeColor` outline (`add_text`/`update_text`).
- Pick an **occasion theme** that fits (`set_theme`; e.g. `first_birthday`,
  `kids_primary`, `wedding_ivory`, `travel_adventure`).

Balance: ~1 pattern/background + at most a couple of stickers per page; reuse one
accent. Rich, not noisy.

### Work in BULK (keep tool calls low)
- **Compose a page in ONE call** with `fill_page { page, layoutId, photos:[{filename,
  focusX?, focusY?, zoom?}], stylePreset? }` — it sets the layout, places every
  photo (cover-fit), applies focal crops, and styles them. This replaces a
  layout-set + N×`place_image` + N×focus + style. Use it as your default builder.
- Tweak many photos at once with `update_images { page, items:[{imageId, …}] }`.
- Create several pages at once with `add_pages [{type, layoutId}]`; insert/reorder
  with `add_page { atIndex }` / `move_page { from, to }` (no need to rebuild the book).
- Learn the photos in ONE call with `view_images` (grid of all sources) instead of
  many `view_image` calls.

## 3. Build / refine each page (if not using fill_page)
For each page:
1. `update_page` to set the `layoutId` (re-slots existing photos, cover-fit) and
   optionally `backgroundColor` / `backgroundGradient`. **Set layout BEFORE styling**.
2. `place_image` only to ADD a new photo to an empty slot. To rearrange use
   `move_image_to_slot` / `swap_images` — don't re-`place_image` (it duplicates).
3. **Batch-style in one call:** `set_page_image_style { page, preset }` (e.g.
   `matte_white`, `polaroid`, `scallop_frame`). Fine-tune with `update_image`.
   For a custom cover hero that needs free positioning, `update_image { detach:true,
   x, y, width, height }`.
4. `add_pattern` for a tasteful background motif (behind photos).
5. `add_sticker` sparingly for accents (SVG or emoji; corners read best).
6. `add_proverb` / `add_text` for captions/quotes. **For text over a photo pass
   `captionSafe:true`** (white text + dark plate + outline + shadow = always
   readable). Place in clear areas, never over faces.

## 3b. Verify cheaply
- `render_album` → eyeball the WHOLE book in one labelled grid. Fix the pages that
  look off, then `render_page` just those at `maxWidth` ~520. Re-check with a final
  `render_album`.

## 4. Cover & polish
- Make page 0 a strong cover: a hero photo + the cover title/subtitle text,
  maybe a theme pattern and a corner accent.
- Keep the design consistent: reuse 2–3 layouts, one theme, one accent colour.
- Avoid clutter: 1 pattern + at most a couple of stickers per page.

## 5. Hand back
- Briefly tell the user what you built (themes, number of pages, highlights) and
  suggest they open/reload the project in PebbleAlbum to view the page-turn
  preview and export.

## Cost discipline
- **Batch** styling (`set_page_image_style`) instead of per-image calls — this alone
  roughly halves the work.
- **Verify with `render_album`** (one call) rather than `render_page` ×N.
- Use `get_page` (text, cheap) to read exact ids/positions instead of rendering.
- Render at small sizes; only re-render the specific pages you changed.

## Worked example (pattern to copy)
```
pebble_guide
read_skill pebble-gotchas
get_project { project:"frame" }
list_images { project:"frame" }
list_catalog { kind:"layouts", project:"frame" }      // learn slot orientations
set_theme { project:"frame", themeId:"festive_gold" }
# Cover
update_page { project:"frame", page:0, layoutId:"cover_full_bleed" }
add_text   { project:"frame", page:0, content:"Shawn — Happy 3rd Birthday", type:"title", ... }
add_sticker{ project:"frame", page:0, emoji:"🎉" }       // or an SVG sticker
# Interior — vary layouts, match orientation
update_page { project:"frame", page:1, layoutId:"grid_4_hero_left" }
update_page { project:"frame", page:2, layoutId:"magazine_spread" }
update_page { project:"frame", page:3, layoutId:"polaroid_scatter" }
...
# Style every photo in ONE call, then add a pattern per page
set_page_image_style { project:"frame", allPages:true, preset:"matte_white" }
add_pattern { project:"frame", page:1, patternId:"confetti" }
# Verify the whole book at once, fix outliers, re-verify
render_album { project:"frame" }
render_page  { project:"frame", page:3, maxWidth:520 }   // only the one that looked off
```
