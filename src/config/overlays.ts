/**
 * overlays.ts — Themeable SVG decoration art, loaded from real files.
 *
 * The SVG sources live in `assets/overlays/*.svg` and are inlined at BUILD TIME
 * via Vite's `import.meta.glob(..., { query: '?raw' })`. This means:
 *   • the files physically exist on disk (and are referenced by patterns.json's
 *     `asset` field), and
 *   • they still work in dev and in the packaged app with no runtime fs / file://
 *     access (Vite bakes the string into the bundle).
 *
 * Each file may use the tokens `{{C}}` (theme accent colour) and `{{C2}}`
 * (secondary colour) which are substituted at render time by `overlayDataUrl`.
 *
 * A `pattern` of type `svg_overlay` in patterns.json maps to a file by id:
 * the pattern id equals the SVG file's basename (e.g. `floral_corner` ⇄
 * `assets/overlays/floral_corner.svg`).
 */

// Eagerly inline every overlay SVG as a raw string, keyed by file path.
const RAW = import.meta.glob('../../assets/overlays/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

/** id (file basename, no extension) → raw SVG markup (with {{C}} tokens). */
export const OVERLAY_SVGS: Record<string, string> = Object.fromEntries(
  Object.entries(RAW).map(([path, svg]) => {
    const base = path.split('/').pop()!.replace(/\.svg$/i, '');
    return [base, svg];
  }),
);

/** Sorted list of available overlay ids (handy for panels / debugging). */
export const OVERLAY_IDS: string[] = Object.keys(OVERLAY_SVGS).sort();

/**
 * Resolve an overlay SVG to a data URL with theme colours substituted.
 * @param id     overlay id (= file basename)
 * @param color  primary colour → replaces `{{C}}`
 * @param color2 secondary colour → replaces `{{C2}}` (defaults to `color`)
 */
export function overlayDataUrl(id: string, color: string, color2?: string): string | null {
  const svg = OVERLAY_SVGS[id];
  if (!svg) return null;
  const filled = svg
    .replace(/\{\{C2\}\}/g, color2 ?? color)
    .replace(/\{\{C\}\}/g, color)
    .trim();
  return `data:image/svg+xml;utf8,${encodeURIComponent(filled)}`;
}
