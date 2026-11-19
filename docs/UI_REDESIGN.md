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
toggle today; it is not visually verified).

Component classes (`@layer components` in style.css): `pa-topbar`, `pa-iconbtn`, `pa-btn`, `pa-seg` /
`pa-seg-item`, `pa-tab`, `pa-tile`, `pa-section`, `pa-label`, `pa-hint`, `pa-kbd`, plus the existing
`pa-panel`, `pa-input`, `pa-chip`, `pa-code`.

Primitives (`src/components/ui`): `AppButton` (primary / secondary / ghost / danger, optional icon),
`AppIconButton` (required label → tooltip + aria), `AppSegmented`, `AppTabs` (icon + label, optional
stacked), `AppSlider`, `AppColorPicker`, `AppDropdown`, `AppModal` (Esc closes), `AppToast`,
`AppTooltip` (teleported, never clipped, shortcut hint), `AppProgress`, `AppEmptyState`, `AppIcon`.

Icons: `src/components/ui/icons.ts` holds the path data; the grid, stroke convention and a number of
outlines follow the open-source **Lucide** set (ISC licence; a fork of Feather, MIT), the rest are
drawn to match. Emoji that are *content* stay: emoji stickers, the shape-mask glyph picker
(`engine/maskShapes.ts`), theme/proverb category emblems.

## 5. Screens — what changed, why, and what moved

See the tables below; "kept" means the existing pattern is the convention and only its styling changed.

<!-- SCREENS -->
