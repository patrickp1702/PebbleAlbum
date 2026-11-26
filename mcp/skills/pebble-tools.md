# Tool Cheat-Sheet

All tools take `project` (the project name or .pebble path). Page tools take
`page` (zero-based index). Ids (image/text/decoration) come from `get_page`.

## Discovery
- `pebble_guide` — start here.
- `list_skills` / `read_skill {name}` — these docs.
- `list_projects` — saved albums.
- `get_project {project}` — meta + page summaries.
- `get_page {project, page}` — full page detail incl. all ids.
- `list_images {project, unusedOnly?}` — source photos + labels + usage.
- `list_catalog {kind, project?}` — layouts|themes|patterns|stickers|borderFrames|filters|fonts.
  For `layouts`, pass `project` to get per-slot **orientation/aspect** + capacity + `hasTextZone`.

## Vision (cheap previews)
- `render_album {project, from?, to?, columns?, thumbWidth?}` — the WHOLE book as one
  labelled thumbnail grid (verify in a single call — prefer this).
- `view_images {project, from?, to?, columns?, unusedOnly?}` — labelled grid of all
  SOURCE photos in one call (learn content without many view_image calls).
- `render_page {project, page, maxWidth?, quality?}` — JPEG of a single page.
- `view_image {project, filename, maxWidth?, quality?}` — JPEG of a source photo.

## Batch builders (fewest calls — use these)
- `fill_page {project, page, layoutId?, photos:[{filename, slotId?, focusX?, focusY?,
  zoom?, fit?}], stylePreset?}` — set layout + place all photos + focal-crop + style
  in ONE call.
- `update_images {project, page, items:[{imageId, focusX?, focusY?, zoom?, fit?,
  filter?, rotation?, opacity?, x?,y?,width?,height?, visible?, caption?}]}`.
- `add_pages {project, pages:[{type?, layoutId?}], atIndex?}`.

## Culling (remove duplicates / weak shots — do this FIRST)
- `find_duplicates {project, threshold?}` — group near-dupe/burst photos; returns the
  suggested keeper + per-photo flags (blurry / overexposed / underexposed).
- `view_group {project, groupId? | members?}` — one low-res montage of a group so you
  can compare frames with your vision and choose.
- `cull_duplicates {project, keep?}` — keep the best frame in EVERY group, skip the
  rest. `keep:[filenames]` overrides specific winners.
- `select_photos {project, keep?, skip?}` — manual keep/skip. **Only non-skipped
  photos are used in the album.**

## Batch styling (use instead of per-image loops)
- `set_page_image_style {project, page|allPages, imageIds?, preset?, border?, shadow?, fit?, filter?}`
  — style many photos in one call. Presets: `matte_white | thin_gold | soft_shadow |
  polaroid | scallop_frame | none`.

## Pages
- `add_page {project, type?, layoutId?, atIndex?}`
- `delete_page {project, page}` · `duplicate_page {project, page}`
- `move_page {project, from, to}`
- `update_page {project, page, backgroundColor?, backgroundGradient?{from,to,angle}?,
  backgroundPattern?, layoutId?, type?, locked?, notes?}` (layoutId re-slots photos;
  gradient/pattern give the page a richer background).

## Images
- `place_image {project, page, filename, slotId?, free?, x?, y?, width?, rotation?}` —
  `free:true` = the app's **Add photo** overlay: a new free-floating photo on top of
  everything (no shadow), even if slots are empty; `x,y,width` in album px, height
  follows the photo's aspect.
- `erase_image_region {project, page, imageId, x, y, width, height, mode?, shape?,
  opacity?, feather?}` — **non-destructive eraser** (one brush stroke). Box is 0..1
  fractions of the UN-FLIPPED SOURCE PHOTO (flipX/flipY and rotation are applied afterwards, so "left" always means the photo's own left); `mode` erase|restore, `shape` ellipse|rect,
  `opacity` 0..1 (0.4 = remove 40% per call; calls accumulate), `feather` 0..1
  (0 hard edge, 1 soft). Writes a new mask PNG to `.pebble_masks/` and sets the
  image's `eraseMask` (visible in `get_page` + `render_page`). Typical use: Add
  photo overlay, then erase its edges so the photo below shows through.
- `clear_image_erase {project, page, imageId}` — remove all erasing (file kept). Also
  the fix if `erase_image_region` reports an unreadable existing mask.
- `mask_image_filter_region {project, page, imageId, x, y, width, height, mode?, shape?,
  opacity?, feather?}` — **Filter brush** (one stroke): `mode` remove (that area shows
  the ORIGINAL photo) | restore (filter back in). Same box space / opacity / feather as
  `erase_image_region`. Masks the photo's filter + every adjust slider (not the
  vignette/border/shadow). Sets `filterMask` (in `get_page`; shown by `render_page`).
  Set the filter first with `update_image`. Typical use: B&W photo with the subject
  left in colour.
- `clear_image_filter_mask {project, page, imageId}` — filter everywhere again (file
  kept); also the fix for an unreadable filter mask.
- `copy_image_style` copies effects/border/shadow/fit, never a photo's masks.
- `render_page` shows flip, rotation (clockwise about the photo's top-left, like the
  app), opacity, filters/adjustments (not the vignette), the Filter brush and erasing;
  photos partly off the page are cropped.
- `update_image {project, page, imageId, focusX?,focusY?,zoom?, x?,y?,width?,height?,
  rotation?,opacity?, zIndex?,visible?,flipX?,flipY?,fit?, filter?,filterStrength?,
  exposure?,brightness?,contrast?,highlights?,shadows?, saturation?,temperature?,
  tint?,hue?, sharpness?,blur?,noise?,vignette?, caption?}` — **focusX/focusY
  (0..1) + zoom is the face-safe crop** (keeps auto cover-fit, re-centres on the
  focal point). Adjust sliders are −1..1 (hue −180..180°, blur px, sharpness
  1=neutral..2, filterStrength 0..1).
- `set_image_mask {project, page, imageId, mask}` — clip the photo to a shape
  (circle | ellipse | squircle | heart | star | hexagon | diamond | arch | blob |
  scallop), or `null` to restore the rectangle. `list_catalog masks` lists ids.
- `set_image_border {project, page, imageId, border}` — `null`, or
  `{style, width, color, radius, gradient?, frameId?}`.
- `set_image_shadow {project, page, imageId, shadow}` — `null` or
  `{offsetX, offsetY, blur, color, opacity}`.
- `move_image_to_slot {project, page, imageId, slotId}` — move/rearrange without
  duplicating (swaps if the slot is taken; revives a parked photo).
- `copy_image_style {project, fromPage, fromImageId, toPage?, toImageIds?}` — copy
  border/shadow/filter/fit/focus to other photos for a consistent look.
- `remove_image {project, page, imageId}` · `swap_images {…, imageIdA, imageIdB}`
- `remove_background {project, filename, saveAsSticker?}` — client-side AI cutout →
  `cutouts/<name>.png` (registered; place with place_image). saveAsSticker also
  copies it into the custom sticker library.
- `list_custom_stickers {}` — names of user cutout stickers; place one with
  `add_sticker {file: "<name>"}`.

## Decorations
- `add_pattern {project, page, patternId}` (behind photos)
- `add_sticker {project, page, svg?|emoji?, x?, y?, size?}` (in front)
- `remove_decoration {project, page, decorationId}`

## Text / proverbs
- `add_text {project, page, content, type?, x?,y?,width?, fontFamily?, fontSize?,
  color?, align?, italic?, bold?, letterSpacing?, lineHeight?, rotation?,
  background?, strokeWidth?, strokeColor?, shadow?}` — `background`/`strokeWidth`+
  `strokeColor`/`shadow` are the **legibility kit** for text over busy photos.
- `add_proverb {project, page, text}` (movable, styled text block)
- `set_page_proverb {project, page, text}` · `clear_proverb {project, page}` (the
  simple auto-rendered page footer proverb)
- `update_text {project, page, textId, …}` · `remove_text {project, page, textId}`

## Album
- `set_theme {project, themeId}`
- `update_album {project, name?, coverTitle?, coverSubtitle?, coverDate?, pageBackgroundColor?}`

## AI Enhance (identity-safe re-imagining — read `pebble-enhance` first)
New scene / wardrobe / lighting via the user's own image API, then the ORIGINAL
face is composited back. Full-res goes only to the provider + disk; you get ≤ 640 px
previews. Outputs: `<album>/enhanced/<stem>/attempt-<n>.png`, `final.jpg` (registered).
- `enhance_provider_status {}` — configured?, provider, model, keyHint (never the key), supportsMask.
- `enhance_get_queue {project}` — scenePrompt, identityText, keepFace, maxAttempts, provider, items (status, attempts + metrics, resultPath), counts.
- `enhance_set_settings {project, scenePrompt?, identityText?, keepFace?, maxAttempts?}`
- `enhance_set_queue {project, add?: [relativePath], remove?: [relativePath]}`
- `enhance_set_status {project, filename, status, note?}` — pending/generating/review/compositing/done/failed/skipped.
- `enhance_generate {project, filename, prompt, keepFace?, size?, quality?}` → attempt n, metrics
  (yawDiff/pitchDiff/rollDiff °, similarity), verdictHint + preview. Pass: yaw/pitch ≤ 8°, roll ≤ 6°. Enforces maxAttempts.
- `enhance_compare_faces {project, filename, variant?}` — source | variant face crops (variant = n or "final").
- `enhance_composite {project, filename, variant?, feather?=0.12, toneMatch?=0.85, expand?=1.05, maskTop?=0.35}`
  → final.jpg + metrics (alignmentResidualPx, scale, rotationDeg, maskPx) + preview + blend crop.
- `enhance_view {project, filename, which: source|attempt|final, attempt?, maxWidth?}`

## Utilities (not tied to a project)
- `find_duplicate_folders {roots[], threshold?=0.7, matchBy?='name_date', skipSystemDirs?=true, maxResults?=100}`
  — find duplicate FOLDERS + stray duplicate files within/across the given roots
  (even whole drives). Metadata-only (name/date/size, never content). Similarity
  is containment on the smaller folder; whole duplicated trees roll up into one
  outermost pair; each pair is tagged `within` (same root) or `across`. Returns
  `duplicateFolders` (the duplicate side first, `alsoIn` = where it's copied) +
  a stray-duplicate-file count. Read-only — great for spotting backup copies to
  delete.

Every edit saves the `.pebble` file immediately. Re-render to verify.
