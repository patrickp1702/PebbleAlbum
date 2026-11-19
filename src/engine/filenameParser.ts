/**
 * filenameParser.ts
 * -----------------------------------------------------------------------------
 * Parses descriptive image filenames into structured {@link ParsedImageLabels}.
 *
 * Format:  <descriptive_name>_[label1]_[label2]_..._[labelN].<ext>
 * Labels are case-insensitive and order-independent. Unrecognized tokens are
 * treated as part of the descriptive name. Prefix labels (cap-, pg-, frame-,
 * tint-, ord-, blend-, spread-, r90/r180/r270) are handled specially.
 */
import type {
  ParsedImageLabels, SlotSize, AspectMode, FilterId, PatternId,
  SlotPosition, ImageRole, ImageFlag, BlendMode,
} from '@shared/pebble.types';

/** Lookup tables of single-token labels grouped by the field they populate. */
export const LABEL_MAP = {
  size: { xs: true, sm: true, md: true, lg: true, xl: true, xxl: true } as Record<string, boolean>,
  aspect: { sq: true, land: true, port: true, free: true } as Record<string, boolean>,
  borderStyle: {
    border: true, noborder: true, thin: true, thick: true,
    double: true, rounded: true, polaroid: true, filmstrip: true,
  } as Record<string, boolean>,
  pattern: {
    floral: true, bokeh: true, geometric: true, vintage: true, plain: true,
    lace: true, dots: true, hearts: true, stars: true, leaves: true,
  } as Record<string, boolean>,
  filter: {
    bw: true, sepia: true, vivid: true, muted: true, warm: true, cool: true,
    faded: true, dramatic: true, lomo: true, chrome: true, fade: true,
  } as Record<string, boolean>,
  position: { left: true, right: true, top: true, bottom: true, center: true, fill: true } as Record<string, boolean>,
  role: { cover: true, hero: true, thumb: true, bg: true, accent: true, featured: true } as Record<string, boolean>,
  flags: {
    newpage: true, fullpage: true, proverb: true, skip: true, x: true, noborder: true,
    nocaption: true, nofilter: true, spotlight: true, blurbg: true, duotone: true,
    vignette: true, glow: true, matte: true, textover: true,
  } as Record<string, boolean>,
  rotate: { r90: 90, r180: 180, r270: 270 } as Record<string, 0 | 90 | 180 | 270>,
} as const;

const BLEND_MAP: Record<string, BlendMode> = {
  multiply: 'multiply', screen: 'screen', overlay: 'overlay', softlight: 'soft-light',
};

/** Strip the extension and split into lowercase tokens. */
function tokenize(filename: string): { name: string; tokens: string[] } {
  const dot = filename.lastIndexOf('.');
  const base = dot >= 0 ? filename.slice(0, dot) : filename;
  const tokens = base.split('_').filter(Boolean);
  return { name: base, tokens: tokens.map((t) => t.toLowerCase()) };
}

/**
 * Parse a filename into structured labels.
 * @param filename e.g. `beach_sunset_lg_warm_proverb_cap-our-first-trip.jpg`
 */
export function parseFilename(filename: string): ParsedImageLabels {
  const { tokens } = tokenize(filename);
  const labels: ParsedImageLabels = {};
  const flags: ImageFlag[] = [];

  for (const raw of tokens) {
    // Prefix labels --------------------------------------------------------
    if (raw.startsWith('cap-')) { labels.captionText = raw.slice(4).replace(/-/g, ' '); continue; }
    if (raw.startsWith('pg-')) { labels.pageTag = raw.slice(3); continue; }
    if (raw.startsWith('frame-')) { labels.frameId = raw.slice(6); continue; }
    if (raw.startsWith('tint-')) { labels.colorTint = `#${raw.slice(5).replace('#', '')}`; continue; }
    if (raw.startsWith('ord-')) {
      const n = parseInt(raw.slice(4), 10);
      if (!Number.isNaN(n)) labels.order = n;
      continue;
    }
    if (raw.startsWith('blend-')) {
      const b = BLEND_MAP[raw.slice(6)];
      if (b) labels.blendMode = b;
      continue;
    }
    if (raw === 'spread-left') { labels.position = 'left'; continue; }
    if (raw === 'spread-right') { labels.position = 'right'; continue; }

    // Single-token labels --------------------------------------------------
    if (raw in LABEL_MAP.rotate) { labels.rotate = LABEL_MAP.rotate[raw]; continue; }
    if (LABEL_MAP.size[raw]) { labels.size = raw as SlotSize; continue; }
    if (LABEL_MAP.aspect[raw]) { labels.aspect = raw as AspectMode; continue; }
    if (LABEL_MAP.filter[raw]) { labels.filter = raw as FilterId; continue; }
    if (LABEL_MAP.pattern[raw]) { labels.pattern = raw as PatternId; continue; }
    if (LABEL_MAP.position[raw]) { labels.position = raw as SlotPosition; continue; }
    if (LABEL_MAP.role[raw]) { labels.role = raw as ImageRole; continue; }
    if (LABEL_MAP.borderStyle[raw]) {
      // `border`/`noborder` are also flags; keep both semantics consistent.
      if (raw === 'noborder') { flags.push('noborder'); labels.borderStyle = 'none'; }
      else if (raw === 'border') { labels.borderStyle = 'thin'; }
      else labels.borderStyle = raw as ParsedImageLabels['borderStyle'];
      continue;
    }
    if (LABEL_MAP.flags[raw]) { flags.push(raw as ImageFlag); continue; }
    // Unrecognized → part of descriptive name; ignored for label purposes.
  }

  if (flags.length) labels.flags = Array.from(new Set(flags));
  return labels;
}

/** Convenience predicate used across the engine. */
export function hasFlag(labels: ParsedImageLabels, flag: ImageFlag): boolean {
  return !!labels.flags?.includes(flag);
}

/** Maps the size bucket to a relative weight (0..1) used in layout scoring. */
export const SIZE_WEIGHT: Record<SlotSize, number> = {
  xs: 0.1, sm: 0.2, md: 0.33, lg: 0.5, xl: 0.66, xxl: 1.0,
};
