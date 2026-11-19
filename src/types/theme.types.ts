/**
 * theme.types.ts — Theme token model. Themes drive colors, fonts, default
 * borders, default filters and decoration choices across the whole album.
 */

export interface ThemeFonts {
  /** Display / heading font (e.g. for titles + proverbs). */
  display: string;
  /** Body / UI font for captions and supporting text. */
  body: string;
}

export interface ThemeColors {
  background: string;
  surface: string;
  accent: string;
  /** Secondary overlay/wash colour used by pattern renderers. */
  overlay: string;
  border: string;
  text: string;
  textMuted: string;
}

export interface ThemeBorderDefaults {
  style: 'solid' | 'double' | 'dashed' | 'dotted' | 'none';
  width: number;
  color: string;
  radius: number;
  padding: number;
}

export interface Theme {
  id: string;
  name: string;
  description: string;
  colors: ThemeColors;
  fonts: ThemeFonts;
  /** Default colour filter applied to images unless overridden. */
  defaultFilter: string;
  /** Default decoration pattern ids placed on pages. */
  decorations: string[];
  border: ThemeBorderDefaults;
  /** Duotone pair for `duotone` labelled images. */
  duotone?: { highlight: string; shadow: string };
  /** Background texture asset id (optional). */
  texture?: string;
  /** Suggested object stickers (emoji glyphs) for this theme. */
  stickers?: string[];
  /** Built-in proverb category suggested for this theme. */
  proverbCategory?: string;
  /** Distinct page background treatment (gives each template its own look). */
  background?: ThemeBackground;
}

/** A theme's page background: a flat colour, a gradient, or a faint pattern. */
export interface ThemeBackground {
  type: 'solid' | 'gradient' | 'pattern';
  /** gradient endpoints + angle (deg). */
  from?: string;
  to?: string;
  angle?: number;
  /** pattern: a decoEngine canvas_draw renderer id drawn faintly over the base. */
  pattern?: string;
  /** base fill for gradient/pattern; defaults to colors.background. */
  base?: string;
}
