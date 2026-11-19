# Catalogs — Valid ids for layouts, themes, patterns, borders, stickers

Always fetch the live list with `list_catalog { kind }` before using a value —
this doc explains what each catalog is for. The app ships with these (your
install may have more).

## layouts (`list_catalog layouts`)
Slot templates for a page. Each has `minImages`/`maxImages` and named `slots`.
Match photo count + shape to a layout:
- Single: `single_full`, `cover_full_bleed`, `cover_title_right`.
- Two: `two_equal`, `two_horizontal`, `diagonal_split`.
- Three+: `grid_3_asymmetric`, `grid_3_banner`, `grid_4_equal`,
  `grid_4_hero_left`, `grid_5_mosaic`, `magazine_spread`,
  `overlapping_collage`, `polaroid_scatter`, `film_strip_row`.
- Divider: `divider_page`.
Set a page's layout with `update_page { layoutId }` (re-slots photos, cover-fit).

## themes (`list_catalog themes`)
A theme sets default colours, fonts, page background, and suggested
decorations/proverbs. Examples: `elegant_rose`, `classic_black`,
`vintage_sepia`, `modern_minimal`, `festive_gold`, `nature_green`, `royal_blue`,
`warm_autumn`, `pastel_dream`, `dark_cinematic`, `wedding_ivory`,
`birthday_vibrant`, `graduation_navy`, `travel_adventure`, `family_warmth`
(+ classic/industrial sets). Set with `set_theme`.

## patterns (`list_catalog patterns`)
Page decorations drawn BEHIND photos. Two kinds:
- Procedural fills: `bokeh_circles`, `confetti`, `dot_pattern`, `geometric_grid`,
  `hearts_scatter`, `stars_scatter`, `triangles_scatter`, `crosshatch`,
  `polka_large`, `sunburst_rays`, `plus_grid`, `film_grain`, `vignette_deco`, …
- SVG edge art: `floral_corner`, `floral_border`, `lace_border`,
  `scallop_border`, `leaves_corner`, `art_deco_corner`, `botanical_frame`,
  `star_corner`, `geo_corner`, `wave_band`, `snowflake_corner`, `heart_corner`,
  `sun_rays_bg`, `watercolour_wash`, `compass_rose`, `torn_edge`, `ribbon_banner`.
Add with `add_pattern`. Use **one** per page for taste.

## borderFrames (`list_catalog borderFrames`)
Decorative photo-border motifs for `set_image_border { style:"pattern", frameId }`:
`scallop_fan` (shell/fan band), `scallop`, `dots`, `dashes`, `zigzag`, `wave`,
`greek_key`, `rope`, `beads`, `deco_lines`, `vine`, `hearts`, `triangles`.
For a plain border use `style:"solid|dashed|dotted|double"`; add a `gradient`
`{from,to,angle}` for a gradient stroke.

## stickers (`list_catalog stickers`)
Full-colour SVG sticker ids (any aspect ratio, never stretched), e.g.
`butterfly`, `balloon`, `heart`, `star`, `flower`, `leaf`, `camera`,
`ribbon_bow`, `sun`, `cloud`, `crown`, `rainbow`, `diamond`, `music_note`,
`sparkle`, `pennant_banner`. Or pass an `emoji` instead. Add with `add_sticker`.

## filters (`list_catalog filters`)
Image colour treatments for `update_image { filter }`: `none, auto_enhance, bw,
sepia, vivid, muted, warm, warm_skin, cool, faded, dramatic, portrait_glow, lomo,
chrome, fade, matte_film`. `auto_enhance` is a safe one-tap polish; `warm_skin` /
`portrait_glow` flatter people shots; `matte_film` is a faded matte look.

## Page backgrounds & text legibility
A page can have a richer background via `update_page { backgroundGradient:{from,to,
angle} }` or `{ backgroundPattern:"<pattern id>" }` (a faint full-page texture), not
just a solid `backgroundColor`. For text over busy photos, use the legibility kit on
`add_text`/`update_text`: `background` (plate colour), `strokeWidth`+`strokeColor`
(outline), `shadow:true` (drop shadow).

## fonts (`list_catalog fonts`)
Font families for text blocks (`add_text`/`update_text { fontFamily }`).
