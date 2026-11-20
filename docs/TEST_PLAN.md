# PebbleAlbum — Test Plan

This plan enumerates features and edge cases so another agent (or QA engineer)
can generate concrete test cases. Each item lists **Area → Scenario → Expected**.
IDs are stable references for generated test suites.

Test layers:
- **U** Unit (pure engine modules — no DOM): Vitest recommended.
- **C** Component (Vue, jsdom + @vue/test-utils).
- **I** Integration/IPC (Electron main handlers, mocked fs/sharp).
- **E** End-to-end (Playwright + Electron).

---

## 1. Filename parser (U) — `engine/filenameParser.ts`

| ID | Scenario | Expected |
|---|---|---|
| FP-01 | `beach_lg_warm.jpg` | size=lg, filter=warm; name tokens ignored |
| FP-02 | Case-insensitive `Beach_LG_WARM.JPG` | same as FP-01 |
| FP-03 | Order-independent `beach_warm_lg.jpg` | same as FP-01 |
| FP-04 | `pic_cap-our-first-dance.jpg` | captionText = "our first dance" (hyphens→spaces) |
| FP-05 | `pic_tint-ff9900.jpg` | colorTint = "#ff9900" |
| FP-06 | `pic_ord-3.jpg` | order = 3 |
| FP-07 | `pic_blend-multiply.jpg` | blendMode = "multiply" |
| FP-08 | `pic_r90.jpg` | rotate = 90 |
| FP-09 | `pic_noborder.jpg` | borderStyle="none" AND flags includes "noborder" |
| FP-10 | `pic_skip.jpg` / `pic_x.jpg` | flags include skip / x |
| FP-11 | Unknown token `pic_unicorn.jpg` | no label set; no crash |
| FP-12 | Multiple flags `pic_glow_vignette_proverb.jpg` | flags array deduped, all present |
| FP-13 | `spread-left` / `spread-right` | position left/right |
| FP-14 | No extension `pic_lg` | parses size=lg |
| FP-15 | Empty / dotfile `.DS_Store` | returns `{}` safely |

## 2. Layout selector (U) — `engine/layoutSelector.ts`

| ID | Scenario | Expected |
|---|---|---|
| LS-01 | 2 images, no labels | returns a layout with min≤2≤max |
| LS-02 | 1 image with `hero` | favours a dominant-slot layout |
| LS-03 | 6 images | only `film_strip_row` (max 6) eligible among large groups |
| LS-04 | Repeated calls with recentLayoutIds | variety penalty lowers repeat score |
| LS-05 | random=true | result is among top-3 scored layouts |
| LS-06 | 0 eligible layouts | falls back to `single_full` |
| LS-07 | category filter 'spread' | never returns cover/divider templates |

## 3. Collage composer (U) — `engine/collageComposer.ts`

| ID | Scenario | Expected |
|---|---|---|
| CC-01 | Compose 2-img page | absolute px positions = slot fraction × album size |
| CC-02 | Image with `noborder` | border = null even if borderOnAll |
| CC-03 | `blurbg` image | effects.blur≈18, opacity≈0.5 |
| CC-04 | `duotone` + theme duotone | effects.duotoneHighlight/Shadow set from theme |
| CC-05 | captionStyle=filename | caption = filename without extension |
| CC-06 | `nocaption` flag | caption undefined |
| CC-07 | fewer images than slots | extra slots produce no PageImage |
| CC-08 | polaroid slot (`borderForce`) | border style solid white, padding set |

## 4. Album generator (U) — `engine/albumGenerator.ts`

| ID | Scenario | Expected |
|---|---|---|
| AG-01 | 10 images, default config | cover + interior pages + back cover; pages re-indexed 0..n |
| AG-02 | image with `skip` | excluded from all pages |
| AG-03 | image with `newpage` | starts a fresh page group |
| AG-04 | shared `pg-trip` tag | tagged images grouped together |
| AG-05 | `fullpage` image | gets its own single page (`single_full`) |
| AG-06 | explicit `cover`/`hero` | used on the cover page |
| AG-07 | proverbs + frequency 'every3' | proverb every 3rd interior page |
| AG-08 | `proverb` flag on image | that page always gets a proverb |
| AG-09 | backCover=false | no back_cover page |
| AG-10 | sortBy=date | order follows EXIF dateTaken, then filename |
| AG-11 | ord- labels present | respected before date/filename |
| AG-12 | 0 usable images | returns at most cover/back cover without crashing |
| AG-13 | progress callback | fires monotonically increasing pct ending at 100 |

## 5. Proverb selector (U) — `engine/proverbSelector.ts`

| ID | Scenario | Expected |
|---|---|---|
| PV-01 | `allBuiltInProverbs()` | ≥150 entries |
| PV-02 | `searchProverbs('love')` | only matching entries, with category |
| PV-03 | assignProverbs frequency none | no page receives a proverb |
| PV-04 | empty proverb list | pages unchanged |
| PV-05 | cover/back cover pages | never receive a proverb |

## 6. Theme engine (U) — `engine/themeEngine.ts`

| ID | Scenario | Expected |
|---|---|---|
| TH-01 | `getTheme('classic_black')` | returns that theme |
| TH-02 | unknown id | falls back to first theme |
| TH-03 | meta.theme='custom' + customTheme | merged tokens, id='custom' |
| TH-04 | `getThemeFilterCSS('bw')` | "grayscale(1)" |
| TH-05 | `injectThemeVars` without DOM | no-op, no throw |

## 7. Export engine (U) — `engine/exportEngine.ts`

| ID | Scenario | Expected |
|---|---|---|
| EX-01 | range 'all' | indices 0..n-1 |
| EX-02 | range 'current' | only current index |
| EX-03 | range custom 3–10 | indices clamped to bounds, 1-based input |
| EX-04 | print checklist low-res | flags images <150 effective DPI |
| EX-05 | print checklist missing | flags images absent from registry |
| EX-06 | runExport pdf | calls window.pebble.exportToPDF with correct opts |

## 8. Stores (U/C)

| ID | Scenario | Expected |
|---|---|---|
| ST-01 | historyStore.run | executes, pushes to undo, clears redo, bumps revision |
| ST-02 | undo then redo | state round-trips; revision changes |
| ST-03 | stack > 50 | oldest command dropped |
| ST-04 | projectStore.markDirty | dirty=true, updatedAt refreshed, autosave scheduled |
| ST-05 | autosave with autoSave=false | no autosave scheduled |
| ST-06 | syncUsage | imageRegistry.usedOnPages reflects placements |
| ST-07 | duplicatePage | new ids for page + images; inserted after source |
| ST-08 | reorderPage | indices recomputed contiguously |
| ST-09 | unusedImages | excludes skipped + placed images |
| ST-10 | appStore.toast timeout | auto-dismisses after timeout |

## 9. IPC handlers (I) — `electron/ipc/*`

| ID | Scenario | Expected |
|---|---|---|
| IP-01 | listImages on folder w/ nested dirs | recurses, skips `.pebble_cache` |
| IP-02 | listImages skips non-images | only image extensions returned |
| IP-03 | readImageBase64 valid file | data URL with correct mime |
| IP-04 | readImageBase64 missing file | rejects (renderer shows placeholder) |
| IP-05 | thumbnail cache hit | second call reuses file (no re-encode) |
| IP-06 | thumbnail mtime change | regenerates (new cache key) |
| IP-07 | saveProject | writes `.pebble` + `.pebble.bak` |
| IP-08 | loadProject corrupt JSON | rejects; UI offers `.bak` |
| IP-09 | recents add | de-dupes path, caps at 12, newest first |
| IP-10 | export pdf | multi-page PDF at album px; bleed marks/page numbers optional |
| IP-11 | export jpeg/png sequence | files named `<name>_page_001.<ext>` |
| IP-12 | export progress | `export:progress` events reach renderer |

## 10. Canvas & rendering (C/E)

| ID | Scenario | Expected |
|---|---|---|
| CV-01 | select image | handles appear; editorStore selection set |
| CV-02 | drag image | position committed; undoable; autosave fires |
| CV-03 | resize/rotate | scaleX/scaleY/rotation persisted |
| CV-04 | missing source image | placeholder tile with filename, no crash |
| CV-05 | locked page | objects not selectable/movable |
| CV-06 | zoom in/out/fit/100% | canvas scales; shortcuts work |
| CV-07 | preview/export parity | rendered page matches editor within tolerance |
| CV-08 | decorations toggle | procedural pattern appears/disappears; stable across renders |

## 11. Wizard (C/E)

| ID | Scenario | Expected |
|---|---|---|
| WZ-01 | pick empty folder | warns; Next disabled until ≥1 image |
| WZ-02 | <3 images | warning toast shown |
| WZ-03 | name required | step 2 Next disabled when name blank |
| WZ-04 | size preset | width/height computed from preset × DPI |
| WZ-05 | theme select | selection highlighted; carried into project |
| WZ-06 | proverb library add | appends to textarea + meta.proverbs |
| WZ-07 | generate | progresses to 100%, opens editor with pages |

## 12. Page-turn (E) — `components/canvas/PageTurnScene.vue`

| ID | Scenario | Expected |
|---|---|---|
| PT-01 | next/prev | animates, emits pageChanged, updates active page |
| PT-02 | style curl/slide/fade/hard | distinct animation per style |
| PT-03 | speed slow/normal/fast | duration ≈1.2s/0.6s/0.3s |
| PT-04 | at first/last page | no navigation past bounds |

## 13. Persistence & recovery (I/E)

| ID | Scenario | Expected |
|---|---|---|
| PR-01 | edit → autosave → reopen | album reconstructed pixel-perfect |
| PR-02 | quit with unsaved changes | prompt to save (when wired) |
| PR-03 | corrupt `.pebble` | offer `.pebble.bak` |
| PR-04 | moved source folder | broken-image indicators; re-link flow |

## 14. Cross-platform packaging (E)

| ID | Scenario | Expected |
|---|---|---|
| PK-01 | `npm run dist:mac` | dmg + zip in release/ |
| PK-02 | `npm run dist:win` | NSIS installer in release/ |
| PK-03 | `npm run dist:linux` | AppImage + deb in release/ |
| PK-04 | Sharp unpacked from asar | native module loads in packaged app |

## 15. Edge cases & robustness

| ID | Scenario | Expected |
|---|---|---|
| ED-01 | Very large album (200+ pages) | page strip virtualises; no jank |
| ED-02 | 4K source images | thumbnails generated; editor stays at screen DPI |
| ED-03 | Non-ASCII filenames/paths | parse, load, export all succeed |
| ED-04 | Duplicate filenames in subfolders | tracked by relativePath |
| ED-05 | Mixed orientations | layouts adapt; no overflow |
| ED-06 | All images skipped | generator yields minimal album safely |
| ED-07 | Empty proverb lines | trimmed/ignored |
| ED-08 | Export range out of bounds | clamped, no crash |

## 16. Borders, stickers, patterns & text (recent)

| ID | Scenario | Expected |
|---|---|---|
| BR-01 | Line border solid/dashed/dotted/double | stroke style persists + follows rotation |
| BR-02 | Gradient border (from/to/angle) | gradient stroke renders; scales with the rect |
| BR-03 | Decorative frame (e.g. `scallop_fan`) | motif tiles around the cell, **never stretched**; regenerates crisp on resize |
| ST-01 | Add SVG sticker (e.g. `butterfly`) | placed at true aspect ratio (uniform scale, no stretch) |
| ST-02 | Add emoji sticker | renders in front of photos; movable; deletable |
| PA-01 | Toggle new pattern (triangles/crosshatch/…) | renders BEHIND photos; theme-tinted; stable across renders |
| PA-02 | SVG overlay corner/frame | loaded from `assets/overlays/*.svg`; themed via `{{C}}` |
| TX-01 | Add multiple proverbs to a page | each is a movable text block; all render |
| TX-02 | Move/rotate/scale a text block | x/y/rotation/fontSize persisted + undoable |
| TX-03 | Edit text font/size/colour/align | re-renders; persists to `.pebble` |
| TX-04 | Legacy `page.proverb` project | migrates to a movable text block on opening the Proverb tab |

## 17. MCP server / AI integration (I/E) — `mcp/pebble-mcp-server.mjs`

| ID | Scenario | Expected |
|---|---|---|
| MCP-01 | `initialize` + `tools/list` over stdio | returns serverInfo + 53 tools |
| MCP-02 | `get_project` / `get_page` | accurate meta + page/image/text/decoration ids |
| MCP-03 | edit tool (place_image, update_image, set_image_border, add_*) | mutates and **saves the `.pebble` (+ `.bak`)** immediately |
| MCP-04 | `render_page` | returns a small JPEG (≤~80 KB) matching the page; photos cover-fit, not stretched |
| MCP-05 | `view_image` | downscaled JPEG of a source photo (auto-oriented) |
| MCP-06 | `list_catalog` for each kind | returns valid ids (layouts/themes/patterns/stickers/borderFrames/filters/fonts) |
| MCP-07 | bad args / missing page | returns `isError` content, no crash |
| MCP-08 | **Parity check** | every UI capability has a corresponding tool; new features add theirs (see `MCP.md`) |
| MCP-09 | Connect AI panel | copy-config + copy-prompt produce a working config (resolved node path + env) |
| MCP-10 | App ⇄ agent round-trip | agent edits a project; reopening in the app shows the changes |

## 18. Filter brush — partial filter (`PageImage.filterMask`)

| ID | Scenario | Expected |
|---|---|---|
| FB-01 | Photo with no filter/adjustment → Adjust or Filters tab | **Filter brush** button disabled, hint "Apply a filter or adjustment first…" (vignette alone does not count — it is an overlay) |
| FB-02 | Strong filter (B&W / Sepia 100%) → Filter brush → Remove filter, 100% opacity over the left half → Apply | left half shows the original colours, right half the filtered ones — in the editor canvas, the page thumbnail, the page-turn preview and the export; panel shows **Partial** + **Clear** |
| FB-03 | 40% opacity stroke | that area = original·0.4 + filtered·0.6 (measured: mask alpha 153; pixel within ±1 of the lerp) |
| FB-04 | Rotate / flip the photo after brushing | the unfiltered area stays on the same part of the PHOTO (mask lives in un-flipped source space) |
| FB-05 | Drag an Adjust slider / change preset or strength with a mask | updates live without a canvas rebuild (`canvasRevision` unchanged); brushed area stays original |
| FB-06 | Hold to compare | whole photo shows the original while held; the partial filter returns on release |
| FB-07 | Undo / redo in the studio (Cmd/Ctrl Z, Shift Z), Reset (filter everywhere), Esc with changes | same behaviour as the eraser; Reset + Apply clears `filterMask` |
| FB-08 | Undo / redo after Apply or Clear (editor history) | `filterMask` path swaps back and forth; thumbnails refresh |
| FB-09 | Photo with BOTH an erase mask and a filter mask | erased areas stay transparent; filter studio preview and erase studio preview both show the partial filter + erasing |
| FB-10 | Studio in filter mode | title "Filter brush", modes Remove filter / Restore filter / Pan (E / R / Space), no AI removal, no sticker section; Apply saves only the mask as `<imageId>_fx_<ts>.png` |
| FB-11 | Album editor, Pixart and Collage | the button opens the same studio in all three |
| FB-12 | Move the photo to another page (drag) | `filterMask` carried with it |
| FB-13 | MCP `mask_image_filter_region` remove/restore, `clear_image_filter_mask`, `get_page` | new mask file per call; `render_page` shows original/filtered through the mask; unreadable mask → filter everywhere (render) / refused (stroke); `..` paths ignored |
| FB-14 | MCP `copy_image_style` from a brushed photo | effects copied, `filterMask` NOT copied |

