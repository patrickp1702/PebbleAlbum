# Filename Label System

PebbleAlbum parses photo **filenames** for design intent. Labels are appended to
the descriptive name, separated by underscores, and are case-insensitive and
order-independent. Example:

```
beach_sunset_lg_land_warm_proverb.jpg
   → large, landscape, warm filter, attach a proverb to this page
```

`list_images` returns each photo's `labels` (already parsed). You can honour them
when placing/styling photos, but you are free to override with explicit edits.

## Label reference

| Category | Labels | Meaning |
|---|---|---|
| Slot size | `xs sm md lg xl xxl` | relative slot size (xs≈10% … xxl≈100%) |
| Aspect | `sq land port free` | square / landscape / portrait / free crop |
| Border | `border noborder thin thick double rounded polaroid filmstrip` | frame style |
| Pattern | `floral bokeh geometric vintage plain lace dots hearts stars leaves` | overlay motif |
| Filter | `bw sepia vivid muted warm cool faded dramatic lomo chrome fade` | colour treatment |
| Position | `left right top bottom center fill` | preferred slot position |
| Role | `cover hero thumb bg accent featured` | placement role (`bg`=full-page blur bg) |
| Page control | `newpage` | start a new page before this photo |
| Full page | `fullpage` | this photo takes a whole page |
| Proverb | `proverb` | attach a proverb to this photo's page |
| Skip | `skip` `x` | exclude from the album |
| Suppress | `noborder nocaption nofilter` | turn the named feature off |
| Effects | `spotlight blurbg duotone vignette glow matte` | special effects |
| Rotate | `r90 r180 r270` | pre-rotate |
| Caption | `cap-<text>` | caption (hyphens become spaces): `cap-our-first-dance` |
| Page tag | `pg-<tag>` | group photos with the same tag onto the same page(s) |
| Frame | `frame-<id>` | decorative frame id |
| Tint | `tint-<hex>` | colour tint, e.g. `tint-ff9900` |
| Order | `ord-<n>` | manual sort order |
| Blend | `blend-multiply blend-screen blend-overlay blend-softlight` | blend mode |
| Spread | `spread-left spread-right` | force a side of a two-page spread |
| Text overlay | `textover` | place the page title over this photo |

These are hints from the photographer; combine them with what you SEE
(`view_image`) to make good placement and styling decisions.
