/**
 * themeEngine.ts
 * -----------------------------------------------------------------------------
 * Theme registry + token application. Maps a theme id to its full token set,
 * injects CSS custom properties onto the document root, supplies CSS filter
 * strings (for fast preview), and supports a user "custom" theme override.
 */
import themesData from '@/config/themes.json';
import type { Theme } from '@shared/theme.types';
import type { AlbumMeta } from '@shared/pebble.types';

export const THEMES = themesData as unknown as Theme[];

export function getTheme(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
}

/** Build the effective theme, applying meta.customTheme when id === 'custom'. */
export function resolveTheme(meta: AlbumMeta): Theme {
  if (meta.theme === 'custom' && meta.customTheme) {
    const base = THEMES[3]; // modern_minimal as the neutral baseline
    return mergeTheme(base, meta.customTheme as Partial<Theme>);
  }
  return getTheme(meta.theme);
}

export function mergeTheme(base: Theme, override: Partial<Theme>): Theme {
  return {
    ...base,
    ...override,
    id: 'custom',
    name: override.name ?? 'Custom',
    colors: { ...base.colors, ...(override.colors ?? {}) },
    fonts: { ...base.fonts, ...(override.fonts ?? {}) },
    border: { ...base.border, ...(override.border ?? {}) },
  };
}

/**
 * Inject theme tokens as CSS variables (e.g. --pa-theme-accent) for Vue
 * components to consume. Safe no-op outside a DOM (e.g. unit tests).
 */
export function injectThemeVars(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const r = document.documentElement.style;
  r.setProperty('--pa-theme-bg', theme.colors.background);
  r.setProperty('--pa-theme-surface', theme.colors.surface);
  r.setProperty('--pa-theme-accent', theme.colors.accent);
  r.setProperty('--pa-theme-overlay', theme.colors.overlay);
  r.setProperty('--pa-theme-border', theme.colors.border);
  r.setProperty('--pa-theme-text', theme.colors.text);
  r.setProperty('--pa-theme-text-muted', theme.colors.textMuted);
  r.setProperty('--pa-theme-font-display', theme.fonts.display);
  r.setProperty('--pa-theme-font-body', theme.fonts.body);
}

/** CSS `filter` string approximating a colour filter (for live preview). */
export function getThemeFilterCSS(filterId: string): string {
  switch (filterId) {
    case 'bw': return 'grayscale(1)';
    case 'sepia': return 'sepia(0.85)';
    case 'vivid': return 'saturate(1.6) contrast(1.15)';
    case 'muted': return 'saturate(0.6)';
    case 'warm': return 'sepia(0.25) saturate(1.2) hue-rotate(-10deg)';
    case 'cool': return 'saturate(1.1) hue-rotate(15deg) brightness(1.02)';
    case 'faded': return 'brightness(1.12) saturate(0.7) contrast(0.9)';
    case 'dramatic': return 'contrast(1.4) brightness(0.95)';
    case 'lomo': return 'saturate(1.4) contrast(1.3)';
    case 'chrome': return 'contrast(1.3) brightness(1.1) saturate(0.8)';
    case 'fade': return 'brightness(1.2) saturate(0.5) contrast(0.85)';
    default: return 'none';
  }
}
