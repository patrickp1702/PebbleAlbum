# Gotchas & State Behaviour (read this — it saves many calls)

Operational realities that aren't obvious from the tool names. Knowing these
prevents wasted calls and wrong-but-plausible results.

## Styling

- **Batch, don't loop.** Use `set_page_image_style` (a whole page, or `allPages:true`,
  or a subset via `imageIds`) instead of calling `set_image_border` / `set_image_shadow`
  per photo. Pass a `preset` (`matte_white`, `thin_gold`, `soft_shadow`, `polaroid`,
  `scallop_frame`, `none`). This is the single biggest call-count saver.
- **border / shadow must be a JSON object or `null`.** A stringified JSON is rejected
  with an error (it used to silently apply a default — no longer). `null` truly
  **removes** the border/shadow.
- **Decorative frame border:** `{ "style": "pattern", "frameId": "scallop_fan", "width": 24, "color": "#fff" }`.
  `frameId` is required for pattern style; see `list_catalog borderFrames`.

## Layout & placement

- **Match orientation.** Call `list_catalog { kind:"layouts", project }` to get each
  slot's `orientation` (portrait/landscape/square) for THIS album. Put portrait
  photos in portrait slots — landscape slots center-crop a portrait and **cut off
  faces**. Don't guess from the layout name.
- **Face-safe crop without distortion.** When a photo still crops badly, use
  `update_image { focusX, focusY, zoom }` — `focusX`/`focusY` are 0..1 of the photo
  (e.g. `0.5, 0.3` keeps a face near the top), `zoom` ≥ 1. This shifts/zooms the
  cover-crop while keeping the cell filled and the photo undistorted. Prefer this
  over manual `x/y/width/height`. View with `render_page` to confirm the face is in.
- **Rearrange, don't duplicate.** Use `move_image_to_slot` (swaps occupants) or
  `swap_images`; `place_image` is for ADDING a new photo (it reuses a parked copy of
  the same file rather than duplicating).
- **Vary layouts.** Don't repeat one layout more than ~twice across the album. A book
  of identical grids reads as auto-generated.
- **`update_page { layoutId }` re-slots photos and resets each image's `fit` to
  `auto`** (it does NOT touch borders/shadows). So: set the **layout first**, then
  batch-style, then tweak fit — not the other way around.
- **Re-layout parks extras.** Placed images beyond the new layout's slot count are set
  `visible:false` ("not placed"). Check `notPlaced` in `get_project`; re-place or
  remove them so they don't linger.
- **`place_image` adds a NEW image.** It does not reuse an existing not-placed photo —
  placing the same filename again can leave a hidden duplicate. Prefer setting the
  right `layoutId` (which slots the page's existing photos) and only `place_image`
  to ADD a genuinely new photo.

## Text & proverbs

- **Proverbs are movable text blocks.** Use `add_proverb` / `add_text` and
  `update_text`. The legacy page-level `proverb` auto-renders at the bottom; adding a
  proverb text block supersedes it. Don't rely on editing the page `proverb` field.
- Place text in **clear, low-detail areas** (sky, wall, blurred background), never
  across faces. Prefer layouts whose `hasTextZone` is true for caption-heavy pages.
- **Text over a photo? pass `captionSafe:true`** to `add_text`/`update_text` — it's a
  guaranteed-readable combo (white + dark plate + outline + shadow). A bare
  `background` plate alone can read faint over busy photos.

## Speed (use the batch builders)
- Prefer **`fill_page`** (layout + all photos + focal crops + style in one call),
  **`update_images`** (many photos at once), **`add_pages`**, and **`view_images`**
  (all sources in one grid). These cut a typical album from ~200+ calls to well
  under 100. Reserve single-item tools for fine-tuning.
- `page` indices accept numbers or numeric strings; `add_page { atIndex }` and
  `move_page { from, to }` work for insert/reorder — no need to rebuild the book.

## Verifying (cheaply)

- **Use `render_album` to eyeball the whole book in ONE call** (labelled thumbnail
  grid). Only `render_page` the specific pages you're fine-tuning.
- Keep `maxWidth` modest (≈ 420–600). You rarely need full size to judge composition.

## Coordinates & units

- All positions/sizes are **album pixels** (`meta.albumWidth` × `albumHeight`).
- `add_sticker` `x`,`y` are the **top-left** of the sticker; `size` is its height in
  album px (width follows the sticker's true aspect ratio). Omit x/y to drop it
  centred.
