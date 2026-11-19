# Assets

These assets are **inlined into the app at build time** (Vite `import.meta.glob`
with `?raw`), so they ship inside the packaged app and need no runtime filesystem
or `file://` access.

## `overlays/*.svg` — decoration overlays (themeable)

Used by `svg_overlay` patterns in `src/config/patterns.json`. The pattern `id`
equals the file basename (e.g. pattern `floral_corner` ⇄ `overlays/floral_corner.svg`).

- Authored as **templates**: use `{{C}}` for the theme accent colour (and
  optionally `{{C2}}` for a secondary colour). `src/config/overlays.ts` loads the
  file and substitutes the colour(s) per theme at render time.
- Corner overlays are drawn for the **top-left** corner; the renderer rotates them
  90°/180°/270° to reach the other corners, so keep the artwork anchored near the
  SVG's `(0,0)`.
- `mode: full_frame` art should have a transparent centre (edge-only).
- `mode: center_background` / ids containing `wash` render full-bleed behind the
  photos at low opacity.

## `sticker/*.svg` — graphic stickers (full colour, any shape)

Movable object stickers shown in the editor's **Design → Graphic stickers** picker.
Loaded by `src/config/stickers.ts`.

- **Full colour** (not theme-tinted). Use any fills/gradients you like.
- **Set `width` and `height` on the `<svg>` tag.** These are read as the sticker's
  intrinsic size, so a non-square sticker is placed at its true aspect ratio and
  scaled **uniformly** (never stretched).
- The id is the file basename; the picker label is derived from it. Drop a new
  `.svg` here and it appears automatically — no code change needed.

## Other (optional)

- `fonts/*.woff2` — bundle the Google Fonts referenced in `src/config/fonts.json`
  for offline use.
- `frames/`, `patterns/`, `textures/` — decorative PNGs.
- `icons/` is `build/` for electron-builder (`icon.icns`, `icon.ico`, `icon.png`).
