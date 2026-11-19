/**
 * icons.ts — the app's ONE icon set, as inline-SVG path data (no dependency, no
 * network, no icon font). Rendered only by ui/AppIcon.vue.
 * -----------------------------------------------------------------------------
 * Every glyph is drawn on a 24×24 grid as an OPEN STROKE (no fills): round caps
 * and joins, one stroke weight chosen by AppIcon. That single convention is
 * what makes the set read as one family — the UI no longer mixes emoji and
 * assorted unicode symbols as icons.
 *
 * Attribution: the grid, stroke convention and a number of the glyph outlines
 * follow the open-source Lucide icon set (https://lucide.dev, ISC licence,
 * itself a fork of Feather, MIT); the rest are drawn here to match.
 *
 * To add an icon: add ONE entry to ICONS below (path `d` data; several
 * sub-paths may be joined in one string). Use `circle()` / `rect()` for the
 * primitives so the file stays readable.
 */

/** Circle as path data. */
const circle = (cx: number, cy: number, r: number): string =>
  `M${cx - r} ${cy}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0z`;

/** (Rounded) rectangle as path data. */
const rect = (x: number, y: number, w: number, h: number, rx = 0): string =>
  rx === 0
    ? `M${x} ${y}h${w}v${h}h${-w}z`
    : `M${x + rx} ${y}h${w - 2 * rx}a${rx} ${rx} 0 0 1 ${rx} ${rx}v${h - 2 * rx}a${rx} ${rx} 0 0 1 ${-rx} ${rx}h${-(w - 2 * rx)}a${rx} ${rx} 0 0 1 ${-rx} ${-rx}v${-(h - 2 * rx)}a${rx} ${rx} 0 0 1 ${rx} ${-rx}z`;

const RING = circle(12, 12, 9);
const LENS = `${circle(11, 11, 7)}M21 21l-4.3-4.3`;

export const ICONS = {
  // --- navigation / chrome ---------------------------------------------------
  menu: 'M4 6h16M4 12h16M4 18h16',
  home: 'M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  'chevron-left': 'M15 18l-6-6 6-6',
  'chevron-right': 'M9 18l6-6-6-6',
  'chevron-down': 'M6 9l6 6 6-6',
  'chevron-up': 'M18 15l-6-6-6 6',
  'arrow-left': 'M19 12H5M12 19l-7-7 7-7',
  'arrow-right': 'M5 12h14M12 5l7 7-7 7',
  'arrow-up': 'M12 19V5M5 12l7-7 7 7',
  'arrow-down': 'M12 5v14M19 12l-7 7-7-7',
  x: 'M18 6 6 18M6 6l12 12',
  check: 'M20 6 9 17l-5-5',
  'check-circle': `${RING}M8.5 12.5l2.5 2.5 4.5-5`,
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
  grip: 'M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  search: LENS,
  'zoom-in': `${LENS}M11 8v6M8 11h6`,
  'zoom-out': `${LENS}M8 11h6`,
  maximize: 'M8 3H5a2 2 0 0 0-2 2v3M16 3h3a2 2 0 0 1 2 2v3M8 21H5a2 2 0 0 1-2-2v-3M16 21h3a2 2 0 0 0 2-2v-3',
  keyboard: `${rect(2, 6, 20, 12, 2)}M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10`,
  help: `${RING}M9.5 9.5a2.5 2.5 0 1 1 3.6 2.2c-.7.4-1.1.9-1.1 1.8M12 17h.01`,
  info: `${RING}M12 11v5M12 8h.01`,
  alert: 'M12 3.5 2.5 20h19zM12 10v4.5M12 17.5h.01',
  clock: `${RING}M12 7v5l3 2`,
  sliders: `M3 6h11M18 6h3M3 12h3M10 12h11M3 18h9M16 18h5${circle(16, 6, 2)}${circle(8, 12, 2)}${circle(14, 18, 2)}`,

  // --- history / transfer ----------------------------------------------------
  undo: 'M9 14 4 9l5-5M4 9h10.5a5.5 5.5 0 0 1 0 11H11',
  redo: 'M15 14l5-5-5-5M20 9H9.5a5.5 5.5 0 0 0 0 11H13',
  'rotate-cw': 'M21 12a9 9 0 1 1-2.6-6.4L21 8M21 3v5h-5',
  'rotate-ccw': 'M3 12a9 9 0 1 0 2.6-6.4L3 8M3 3v5h5',
  repeat: 'M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  save: 'M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2zM17 21v-8H7v8M7 3v5h8',
  copy: `${rect(9, 9, 12, 12, 2)}M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1`,
  trash: 'M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6',

  // --- media -----------------------------------------------------------------
  play: 'M6 4l14 8-14 8z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  music: `M9 18V5l12-2v13${circle(6, 18, 3)}${circle(18, 16, 3)}`,
  film: `${rect(3, 5, 13, 14, 2)}M16 10l5-3v10l-5-3`,
  camera: `M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z${circle(12, 13.5, 3.5)}`,

  // --- objects ---------------------------------------------------------------
  image: `${rect(3, 3, 18, 18, 2)}${circle(9, 9, 2)}M21 15l-5-5L5 21`,
  'image-plus': `M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h7M16 5h6M19 2v6${circle(9, 9, 2)}M21 15l-3.1-3.1a2 2 0 0 0-2.8 0L6 21`,
  images: `M18 22H4a2 2 0 0 1-2-2V6${rect(6, 2, 16, 16, 2)}${circle(11, 7, 1.5)}M22 13l-2.6-2.6a2 2 0 0 0-2.8 0L10 17`,
  type: 'M4 7V5h16v2M12 5v14M9 19h6',
  sticker: `${RING}M8 14s1.5 2 4 2 4-2 4-2M9 9h.01M15 9h.01`,
  quote: 'M10 7H6a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3v1a3 3 0 0 1-3 3M20 7h-4a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3v1a3 3 0 0 1-3 3',
  page: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5',
  note: 'M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h6',
  book: 'M5 3h13a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1H5zM9 3v18M13 8h3',
  folder: 'M3 7a2 2 0 0 1 2-2h4l2 2.5h8a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  folders: 'M8 5a2 2 0 0 1 2-2h2.5l2 2.5H20a2 2 0 0 1 2 2V15a2 2 0 0 1-2 2H10a2 2 0 0 1-2-2zM4 8v11a2 2 0 0 0 2 2h12',
  bot: `${rect(4, 8, 16, 12, 2)}M12 8V4M12 4h.01M9 13v2M15 13v2M2 14h2M20 14h2`,
  chart: 'M5 20v-9M12 20V4M19 20v-6M3 20h18',
  star: 'M12 2.5l2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z',
  lock: `${rect(4, 11, 16, 10, 2)}M8 11V7a4 4 0 0 1 8 0v4`,
  unlock: `${rect(4, 11, 16, 10, 2)}M8 11V7a4 4 0 0 1 7.5-2`,
  eye: `M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z${circle(12, 12, 3)}`,
  'eye-off': 'M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3 3.9M6.3 6.3C3.6 8.1 2 12 2 12s3.5 7 10 7c1.8 0 3.4-.5 4.7-1.3M9.9 9.9a3 3 0 0 0 4.2 4.2',

  // --- editing tools ---------------------------------------------------------
  sparkles: 'M12 3l1.8 4.7 4.7 1.8-4.7 1.8L12 16l-1.8-4.7-4.7-1.8 4.7-1.8zM19 15l.8 2.2 2.2.8-2.2.8L19 21l-.8-2.2-2.2-.8 2.2-.8z',
  eraser: 'M7 21l-4.3-4.3c-1-1-1-2.5 0-3.4l9.6-9.6c1-1 2.5-1 3.4 0l5.6 5.6c1 1 1 2.5 0 3.4L13 21M22 21H7M5 11l9 9',
  brush: 'M9.06 11.9l8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z',
  pencil: 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z',
  move: 'M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20',
  crop: 'M6 2v14a2 2 0 0 0 2 2h14M18 22V8a2 2 0 0 0-2-2H2',
  scissors: `${circle(6, 6, 3)}${circle(6, 18, 3)}M20 4 8.1 15.9M14.5 14.5 20 20M8.1 8.1 12 12`,
  'flip-h': 'M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h3M16 3h3a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-3M12 20v2M12 14v2M12 8v2M12 2v2',
  'flip-v': 'M21 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v3M21 16v3a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-3M4 12H2M10 12H8M16 12h-2M22 12h-2',
  sun: `${circle(12, 12, 4)}M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4`,
  filters: `${circle(9, 9, 6)}${circle(15, 15, 6)}`,
  frame: `${rect(3, 3, 18, 18, 1)}${rect(7, 7, 10, 10)}`,
  shadow: `${rect(3, 3, 13, 13, 2)}M8 20.5h10.5a2 2 0 0 0 2-2V8`,
  caption: `${rect(3, 4, 18, 12, 2)}M6 20h12`,
  compare: `${rect(3, 4, 18, 16, 2)}M12 2v20`,
  palette: 'M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.93 0 1.65-.75 1.65-1.69 0-.44-.18-.84-.44-1.13-.29-.29-.44-.65-.44-1.13a1.64 1.64 0 0 1 1.67-1.67h2c3.05 0 5.56-2.5 5.56-5.55C21.97 6.01 17.46 2 12 2zM13.5 6.5h.01M17.5 10.5h.01M8.5 7.5h.01M6.5 12.5h.01',
  'align-left': 'M4 6h16M4 12h10M4 18h14',
  'align-center': 'M4 6h16M7 12h10M5 18h14',
  'align-right': 'M4 6h16M10 12h10M6 18h14',

  // --- structure -------------------------------------------------------------
  layers: 'M12 2 2 7l10 5 10-5zM2 12l10 5 10-5M2 17l10 5 10-5',
  layout: `${rect(3, 3, 18, 18, 2)}M3 9h18M9 21V9`,
  grid: `${rect(3, 3, 7, 7, 1)}${rect(14, 3, 7, 7, 1)}${rect(14, 14, 7, 7, 1)}${rect(3, 14, 7, 7, 1)}`,
  collage: `${rect(3, 3, 8, 11, 1)}${rect(14, 3, 7, 6, 1)}${rect(14, 12, 7, 9, 1)}${rect(3, 17, 8, 4, 1)}`,
} as const;

export type IconName = keyof typeof ICONS;
