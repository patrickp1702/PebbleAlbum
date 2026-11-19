# PebbleAlbum — UI redesign (decision record)

Presentation only: no behaviour, data-model, IPC, engine, store or MCP change.
Every control that existed still exists; the ones that moved are listed in §5.

## 1. Decision in five lines

- **Surfaces:** a neutral grey ramp (`#111113` canvas → `#1B1B1E` panel → `#252529` raised →
  `#2E2E33` hover → `#38383E` pressed), separated by 1px hairlines — no tint, no gradients, no glow.
- **Accent:** ONE electric blue, `#2B66F6` (hover `#3871FA`, pressed `#2256D6`, as text `#6EA2FF`),
  used only for the primary action, the selected state, slider fill and focus.
- **Type:** the platform UI font (nothing is bundled or fetched); scale 11 / 12 / 13 / 14 / 16 / 20 / 24,
  11px is the floor; hierarchy comes from weight + the text ramp (`#EDEDF0` / `#A6A6B0` / `#7A7A85`).
- **Icons:** one inline-SVG stroke set (`ui/icons.ts` → `ui/AppIcon.vue`), 24px grid, 1.75 stroke.
  No emoji or unicode symbols as UI icons.
- **Shape & density:** radius 4 / 6 / 8 / 12, control heights 28 / 32 / 40, 120ms ease-out transitions.

Why blue rather than another "electric" hue: the app shows photographs. A neutral chrome does not
colour-cast them, and blue is the one accent that reads as *selection* in every tool studied; a warm or
green accent collides with the semantic warning/success colours, and violet is what the old UI already
looked like. All text/surface pairs meet WCAG AA (primary 14.7:1, secondary 7.1:1 on the panel;
white on the accent 4.85:1; the accent as text 6.8:1).

## 2. What the research said

Sources: vendor documentation and design-system pages where they could be fetched (Figma UI3 blog,
Adobe Spectrum colour system, Apple Photos and Pixelmator Pro user guides, Affinity Photo help,
MacPaw Gemini 2 knowledge base, PhotoSweeper store page, Pixellu SmartAlbums blog); Canva, Picsart,
Photoshop Express, Fundy and Mixbook from search summaries and general familiarity (their help pages
refused automated fetches). Pixel metrics are general knowledge, not quoted from a page.
Principles were derived; no product's palette, assets or trademarked look is copied.

| # | Convention users expect | Seen in | Applied as |
|---|---|---|---|
| 1 | Structure on the left, canvas in the middle, properties of the selection on the right | Figma, Pixelmator Pro, Lightroom, Photos | **Kept** — the editor already had this; it is the right pattern |
| 2 | Contextual options sit in ONE predictable place and follow the selection/tool | Affinity context toolbar, Pixelmator tool pane, Canva bar | Right panel always answers "what is selected + what can I do"; an insert bar above the page holds the Add actions |
| 3 | One filled primary action at a fixed corner; everything else quieter | Canva Share, Photos Done, Gemini Remove, Picsart Apply | Exactly one accent button per screen (Export / Save / Apply / Next / Move) |
| 4 | Every slider shows its label and live value; double-click resets | Lightroom, Photos, Spectrum | `AppSlider`: value on the right, accent fill, double-click reset, changed values tinted |
| 5 | Named, collapsible/sectioned groups instead of one long list | Photos (Light/Color), Lightroom groups, Figma sections | `pa-section` headings inside every panel tab |
| 6 | Tool modes as a segmented control with icon + label; Apply/Cancel pinned | Picsart eraser, Photos Adjust/Filters/Crop | Erase / Restore / Pan segmented control; Apply pinned at the panel foot |
| 7 | Icon + label for novices on the main rails; icon-only + tooltip-with-shortcut for dense toolbars | Canva/Picsart vs Figma/Affinity | Panel tabs are icon + label; top-bar utilities are icon buttons with tooltips and shortcuts |
| 8 | Depth by closely spaced neutral layers and hairlines; colour only for meaning | Spectrum, Figma UI3 | The token ramp in §3 |
| 9 | Destructive flows are review-first, counted, and reversible | Gemini 2, PhotoSweeper | Duplicate finders: marked count next to the one action; red only on what will move |
| 10 | Empty states say what to do next with one action | Canva, Mixbook, Photos | `AppEmptyState` (icon, one line, one button) |
| 11 | Page strip + photo tray with usage state, drag to place | SmartAlbums, Fundy, Mixbook | **Kept** — page strip left, image tray bottom, "unused" filter |
| 12 | Hold to compare with the original | Photos, Lightroom | **Kept**, restyled as a press-and-hold button |

The three findings that changed the design most: **(3)** one primary per screen, **(8)** neutral
layered greys with a single accent, **(6/7)** icon + label tool choices instead of text-only tabs and
emoji glyphs.

## 3. Critique of the old UI (verified in code and screenshots)

What made it read as a generated template:

- **Emoji and unicode as icons** — 70+ distinct glyphs (`🤖 🖼 📊 ✨ ✂ ✎ ☰ ↶ ↷ ▶ ⬇ ⌫ ✋ 👁 🔍 🗂 🎨 📷 …`) in 25 files; they render
  differently per OS, have no shared weight and cannot be tinted.
- **Purple accent on navy** — `#6C63FF` on `#1A1A2E` / `#16213E` / `#0F3460` (tailwind.config.js); the
  tinted surfaces colour-cast photos and the border was *bluer* than the panels it separated.
- **Gradient + glow** — Welcome used `bg-gradient-to-br`, the logo tile and every primary button
  carried `shadow-lg shadow-pebble-accent/20–30`, the active page thumbnail glowed.
- **Uniform rounded cards** — everything was a `pa-panel` with the same border and `rounded-lg/xl/2xl`,
  so nothing ranked above anything else.
- **Tiny, low-contrast labels** — 56 uses of 8–10.5px text (`text-[10px]` ×46, `text-[9px]` ×6 …) in
  `#9E9E9E` on navy; helper paragraphs at 10px.
- **Everything equal weight** — editor top bar had five look-alike buttons (📊, ▶ Preview, 🖼 Select
  images, 🤖 Connect AI, Save) before the primary; the properties panel had six text-only 10.5px tabs.
- **Ad-hoc colours** — `amber-300`, `red-400`, `green-400`, `sky-300`, `white/5` picked per file.
- **Details** — tooltips opened above the top bar (clipped), no visible keyboard focus,
  `active:scale-[.98]` bounce, native blue range sliders, native select chevrons.

Per screen: **Welcome** — centred logo hero with glow, primary button floating alone, tools above
projects, emoji tiles. **Editor** — see above; "Add photo" lived only in a right-panel tab. **Properties**
— "Erase / restore" (a headline feature) was the last control of the first tab. **Erase studio** — the AI
button, not Apply, was the first filled button; Apply sat mid-panel between a checkbox and a text field.
**Pixart** — fine structure, same weight problems. **Wizard / Export / Collage / Duplicate finders** —
correct flows, generic styling, emoji headers.

## 4. The design system

One source of truth: CSS variables in `src/style.css` (`--ui-*`), mapped to Tailwind in
`tailwind.config.js`. The historical `pebble-*` class names are kept and re-pointed, so nothing broke;
new names fill the gaps. **Album themes** (`src/config/themes.json`, injected as `--pa-theme-*` by
`themeEngine.injectThemeVars`) are user content and are untouched — the two families never mix.

| Role | Token / class | Dark value |
|---|---|---|
| Work area (recedes) | `--ui-canvas` · `bg-pebble-bg` | `#111113` |
| Bars, side panels | `--ui-panel` · `bg-pebble-surface` | `#1B1B1E` |
| Controls, cards, menus | `--ui-raised` · `bg-pebble-surface-2` | `#252529` |
| Hover / pressed | `bg-pebble-hover` / `bg-pebble-pressed` | `#2E2E33` / `#38383E` |
| Hairline / control outline | `border-pebble-border` / `-border-strong` | `#34343A` / `#5C5C66` |
| Text primary / secondary / disabled | `text-pebble-text` / `-text-dim` / `-text-off` | `#EDEDF0` / `#A6A6B0` / `#7A7A85` |
| Accent fill / hover / pressed | `bg-pebble-accent` / `-accent-hover` / `-accent-pressed` | `#2B66F6` / `#3871FA` / `#2256D6` |
| Accent as text or icon | `text-pebble-accent-soft` | `#6EA2FF` |
| Success / warning / danger | `text-pebble-success` / `-warning` / `-danger` | `#4CC27A` / `#F0B44A` / `#FF6B63` |
| Destructive fill | `bg-pebble-danger-fill` | `#D63B34` |
| Focus | `:focus-visible` outline | 2px `#6EA2FF` |

A light ramp is defined under `.light` for the existing `uiTheme` preference (no screen exposes the
toggle today; checked on Welcome and the album editor only).

Component classes (`@layer components` in style.css): `pa-topbar`, `pa-iconbtn`, `pa-btn`, `pa-seg` /
`pa-seg-item`, `pa-tab`, `pa-tile`, `pa-section`, `pa-label`, `pa-hint`, `pa-kbd`, plus the existing
`pa-panel`, `pa-input`, `pa-chip`, `pa-code`.

Primitives (`src/components/ui`): `AppButton` (primary / secondary / ghost / danger, optional icon),
`AppIconButton` (required label → tooltip + aria), `AppSegmented`, `AppTabs` (icon + label, optional
stacked), `AppSlider`, `AppColorPicker`, `AppDropdown`, `AppModal` (Esc closes), `AppToast`,
`AppTooltip` (teleported, never clipped, shortcut hint), `AppProgress`, `AppEmptyState`, `AppIcon`.

Icons: `src/components/ui/icons.ts` holds the path data; the grid, stroke convention and a number of
outlines are taken or adapted from the open-source **Lucide** set (ISC licence; a fork of Feather, MIT),
the rest are drawn to match. The licence texts are in `THIRD_PARTY_NOTICES.md` at the repository root. Emoji that are *content* stay: emoji stickers and theme/proverb
category emblems. (The shape-mask picker now draws previews from the real mask geometry.)

## 5. Screens — what changed, why, and what moved

"Kept" means the existing pattern is the convention users expect; only its styling changed.

### Album editor (`AlbumEditorView`, `PageStrip`, `PagePanel`, tray)
Layout **kept** (pages left · page centre · selection/page panel right · album tray bottom) — it is convention 1 and 11.

| Change | Why |
|---|---|
| Top bar reads left→right: Home · album name + save state · Undo/Redo · Zoom (− % + Fit) · utilities (Statistics, Shortcuts as icon buttons; Select images, Connect AI as quiet buttons) · Preview · Save · **Export** (the only accent button) | One primary per screen; utilities stop competing with it |
| New **insert bar** above the page: Photo · Text · Sticker, and the page stepper ("Page n of m" with previous/next) | "Add" is where users of these apps look — next to the canvas, always visible, not inside a panel tab |
| Right panel tabs are icon + label (Layers, Layout, Design, Text, Page); layers are a quiet 32px list; the selected row is tinted, not ringed | Find a section by shape; the list recedes |
| Page strip: 2px accent outline on the active page, no glow; status glyphs are icons; context menu on a raised surface | Selection = accent, nothing else is |
| Canvas well is the darkest surface; Fabric selection handles use the accent | The page is the brightest thing on screen |
| Preview, music picker, recording overlay, statistics and shortcuts dialogs restyled; shortcuts shown as key caps | Same system everywhere |

### Selected photo (`PropertiesPanel`) and text (`TextPropertiesPanel`)
| Change | Why |
|---|---|
| Header = back button + "Photo" + file name; directly below, on every tab, **Erase / restore** (and **Clear** when a mask exists) | The headline editing feature was the last control of the first tab |
| Icon + label tabs: Move, Adjust, Filters, Frame, Shadow, Caption | Six 10.5px text tabs were unreadable |
| Each tab is split into named sections (Frame · Position & size · Rotate & flip · Opacity; Light · Colour · Detail; …) | Progressive grouping instead of one long column |
| Sliders show live values, tint when changed, reset on double-click; bipolar sliders fill from zero | Conventions 4 |
| Two-way choices are segmented controls; "Add border / Add shadow" are secondary, "Remove" is quiet | Only real primaries are filled |

### Erase / restore studio (`CutoutEditor`) — template only, brush logic untouched
| Change | Why |
|---|---|
| Tool choice is one large segmented control with icons: **Erase · Restore · Pan** (E / R / Space) | The mode you are in must be unmistakable |
| Order: Tool → Brush (Size, Opacity, Hardness) → History → View → Automatic → Sticker | Most-used first; one-off actions last |
| **Apply** is the only accent button, pinned in a footer with Cancel; the body scrolls, the footer never does | The AI button used to be the first filled button and Apply sat mid-panel |
| Shortcuts shown as key caps | Keyboard affordance without a manual |

### Pixart (`PixartView`)
Slim top bar (Home · name · Undo/Redo · Zoom · Open another… · **Save image**), the same insert bar and the same panels as the album editor; the start screen is an empty state with one button.

### Welcome (`WelcomeView`)
Order is now **Start → Your albums → Tools**: one large "New album" button, the resume-collage row, album cards (cover, name, one meta line, delete on hover/focus), an empty state that says what to do, then four tool cards with an icon and a one-line purpose. Gradient, glow and emoji removed.

### Setup wizard, Export, Collage, Duplicate finders
Flows **kept**; brought to the system. Wizard: numbered stepper with done/current/upcoming states, pinned footer with Back (quiet) and Next (accent). Export: sectioned form, warning callout for the print checklist, pinned footer with **Export**. Collage: step context in the top bar, one primary per phase, insert bar in the edit phase. Duplicate finders: first-run empty state, review-first results, a pinned action bar with the marked count beside the one action; red is used only on what will be moved.

### Controls that moved (old place → new place)
| Control | From | To |
|---|---|---|
| Page label "Page n of m" | editor top bar, centre | insert bar, right (with new previous/next buttons) |
| Add photo (album editor) | full-width button in the Layers tab | insert bar "Photo"; a small "Add photo" stays in the Layers header |
| Add photo (Pixart) | top bar | insert bar "Photo"; the Layers one stays |
| Keyboard-shortcuts dialog | `?` key only | also a top-bar icon button |
| Erase / restore, Clear erasing (+ hint) | bottom of the Move tab | action row under the panel header, all tabs |
| Opacity slider (photo) | between rotation and flip | its own "Opacity" section |
| Bend (text) | after Colour | "Spacing & shape" section |
| Remove background (studio) | top of the panel, filled | "Automatic" section, secondary |
| Apply (studio) | middle of the panel | pinned footer (Cancel added beside it, same as close) |
| Save as sticker (studio, sticker mode) | panel body | footer primary (there is no Apply in that mode) |
| Design tab order | Patterns, Frames, stickers | stickers first, then Patterns, Frames & corners |
| Quick tools (Welcome) | above the album list | below it |
| Reveal folder / Refresh (Welcome) | text links | icon buttons in the "Your albums" header |
| Version (Welcome) | footer | header, right |
| Move N to duplicate folder | Duplicate Finder top bar | pinned bottom action bar, right |
| Pick folder (Duplicate Finder) | top bar | centre empty state; "Change folder…" stays in the top bar |
| Set counts (Duplicate Finder) | strictness row | bottom action bar, left |

| Hint text (Pixart, Collage) | top bar | right end of the insert bar, shortened |
| Text panel sections | Content, font, size, weight, colour, align, spacing, line height, rotation, opacity, bend… in one column | Content · Typography · Spacing & shape · Rotation & opacity · Legibility |
| Toasts | bottom-right | top-centre below the bars (they covered the pinned primary actions) |

Renamed labels (same handlers): page-panel tab "Proverb" → "Text"; "+ Add" → "Add text"; "Cover / Contain" → "Fill frames / Fit whole";
"Focus ↔ / ↕" → "Focus horizontal / vertical"; "Clear erasing" → "Clear"; "Color" → "Colour"; "Export now" → "Export";
"Generate Album" → "Generate album"; "Delete project?" → "Delete album?"; "New Album Project" → "New album";
Folder duplicates "Similarity ≥" → "Minimum similarity"; Duplicate Finder "Move N to /duplicate" → "Move N to duplicate folder" and its
confirm button "Move" → "Move N"; "Pick folder…" → "Choose folder…" (Duplicate Finder) / "Change…" once a folder is loaded (Collage).

New entry points to existing functions: zoom **Fit** in the editor, Pixart and Collage (`editor.resetZoom`), page previous/next
(`editor.setPage`), Text / Sticker insert buttons (open the matching page-panel tab), insert-bar Photo in Collage (`useAddPhoto`),
Cancel beside Apply / Export, **New scan** in Folder duplicates results (clears the report, returning to the folder list).

## 6. Non-template changes

Presentation-only unless marked **behaviour**; listed so they can be audited.

- `PagePanel.vue` — optional `tab` v-model (prop `tab`, emit `update:tab`) so a host view can open a tab; without it the panel keeps its own state. Noted in `MODULES.md`.
- `AlbumEditorView.vue`, `PixartView.vue`, `CollageView.vue` — a `pageTab` ref, `openPageTab()`, page stepper, and `useAddPhoto()` for the insert bar.
- `composables/keyboard.ts` (new) — `MOD` (platform modifier for tooltips), `isTextEntry()`, `isRangeInput()`; shared by the three editor screens.
- `AlbumCanvas.vue` — five colour literals for Fabric selection / crop / drop outlines changed from the old purple to the accent; no logic touched.
- `AppSlider.vue` — double-click reset, fill computation, `customReset` + `reset` event, `tint` switch.
- `maskShapes.maskPathData` is imported by `PropertiesPanel` to draw the mask previews (pure function, engine unchanged).
- Icon fields and option arrays for tabs / segmented controls in several panels; one tooltip-text computed in the wizard; a frequency-label map in the review step.

Small **behaviour** changes (each is a fix or a guard, none changes data):

| Change | Where |
|---|---|
| Shortcuts stand down while typing: Backspace / Delete / arrows / undo no longer act on the page when the focus is in a text field, textarea, number field or select (previously Backspace in the Caption box deleted the selected photo). Escape and Save still work; sliders and checkboxes do not block shortcuts, and a focused slider keeps its arrow keys | `AlbumEditorView.onKey` |
| `?` is ignored during Preview (the dialog would open under the slideshow) | `AlbumEditorView.onKey` |
| Esc closes an open dialog first (capture phase), ignoring IME composition | `AppModal` |
| Preview controls fade out after 3s without pointer movement and return on move / click / focus | `AlbumEditorView` |
| Double-click on "Manual zoom in frame" returns the photo to automatic fit (keeps focal point and cover zoom) | `PropertiesPanel.resetManualZoom` |
| Double-click reset on sliders (to the control's creation default: shadow 0 / 8 / 24, new-text opacity 95%, line height 130%, JPEG quality 95, similarity 70, strictness 5, …) | `AppSlider` callers |
| The page-panel tab persists across select → back (the host owns it) | `PagePanel` + hosts |
| Tooltips appear on keyboard focus only, not after a mouse click | `AppTooltip` |
| Wizard Back is disabled while generating; Collage Download is disabled while saving; Export settings are locked while exporting; Collage Clear is disabled when there is nothing to clear | wizard, Collage, Export |
| Toasts moved top-centre | `AppToast` |

## 7. Known gaps

- The light ramp (no screen exposes the toggle) was checked on Welcome and the album editor only; the other screens are unverified in light.
- Text sliders (letter spacing, line height, opacity) reset to the "Add text" defaults; generated titles/captions start from other values, so those three do not show the "changed" tint.
- Number fields for X / Y / W / H show unrounded values, as before.
- Selecting a text block through the page panel's pencil opens an empty properties panel — this predates the redesign (the canvas selection request does not carry the object type) and needs a logic fix, which is out of scope here.
