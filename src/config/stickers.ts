/**
 * stickers.ts — SVG sticker registry, loaded from real files.
 *
 * Decorative SVG stickers live in `assets/sticker/*.svg` and are inlined at
 * build time (Vite `?raw`), exactly like the overlays. Unlike overlays, stickers
 * are full-colour standalone art and are NOT theme-tinted.
 *
 * IMPORTANT — non-square stickers: a sticker may be any shape. Its intrinsic
 * width/height are read from the `<svg width="…" height="…">` attributes so the
 * editor can place it at the correct aspect ratio and never stretch it.
 */

const RAW = import.meta.glob('../../assets/sticker/*.svg', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

export interface SvgSticker {
  /** Unique id = file basename without extension. */
  id: string;
  /** Human label for the picker. */
  label: string;
  /** Intrinsic width from the <svg> tag (px). */
  w: number;
  /** Intrinsic height from the <svg> tag (px). */
  h: number;
  /** Raw SVG markup. */
  svg: string;
}

/** Read intrinsic width/height from the opening <svg> tag (falls back to viewBox, then 100×100). */
function dimsOf(svg: string): { w: number; h: number } {
  const open = svg.match(/<svg[^>]*>/i)?.[0] ?? '';
  const w = Number(open.match(/\bwidth\s*=\s*"([\d.]+)"/i)?.[1]);
  const h = Number(open.match(/\bheight\s*=\s*"([\d.]+)"/i)?.[1]);
  if (w > 0 && h > 0) return { w, h };
  const vb = open.match(/viewBox\s*=\s*"[\d.\s]*?([\d.]+)\s+([\d.]+)"/i);
  if (vb) return { w: Number(vb[1]) || 100, h: Number(vb[2]) || 100 };
  return { w: 100, h: 100 };
}

function labelOf(id: string): string {
  return id.replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** All SVG stickers, sorted by label. */
export const SVG_STICKERS: SvgSticker[] = Object.entries(RAW)
  .map(([path, svg]) => {
    const id = path.split('/').pop()!.replace(/\.svg$/i, '');
    const { w, h } = dimsOf(svg);
    return { id, label: labelOf(id), w, h, svg };
  })
  .sort((a, b) => a.label.localeCompare(b.label));

const BY_ID = new Map(SVG_STICKERS.map((s) => [s.id, s]));

export function getSticker(id: string): SvgSticker | undefined {
  return BY_ID.get(id);
}

/** A data URL for a sticker (for <img> previews and Fabric image loading). */
export function stickerDataUrl(id: string): string | null {
  const s = BY_ID.get(id);
  if (!s) return null;
  return `data:image/svg+xml;utf8,${encodeURIComponent(s.svg.trim())}`;
}
