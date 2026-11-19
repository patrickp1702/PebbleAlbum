/**
 * collageComposer.ts
 * -----------------------------------------------------------------------------
 * Pure composition: given a layout template, a set of source images, the active
 * theme and album meta, produce a fully-populated {@link AlbumPage}. All slot
 * fractions are converted to absolute album pixels here so the canvas and the
 * exporter can render identically.
 *
 * This module performs NO Fabric.js / DOM work — keeping it pure makes album
 * generation fast, deterministic, and unit-testable.
 */
import { v4 as uuid } from 'uuid';
import type {
  AlbumPage, AlbumMeta, ImageRecord, PageImage, TextBlock,
  ImageEffects, BorderConfig, PageType, ProverbPosition,
} from '@shared/pebble.types';
import type { LayoutTemplate, LayoutSlot } from '@shared/layout.types';
import type { Theme } from '@shared/theme.types';
import { hasFlag } from './filenameParser';

/** Default, neutral effect stack. */
export function defaultEffects(filter = 'none'): ImageEffects {
  return {
    filter, brightness: 0, contrast: 0, saturation: 0, sharpness: 1,
    vignette: 0, blur: 0, noise: 0, tintOpacity: 0,
  };
}

function borderFromTheme(theme: Theme): BorderConfig {
  return {
    style: theme.border.style === 'none' ? 'none' : theme.border.style,
    width: theme.border.width,
    color: theme.border.color,
    radius: theme.border.radius,
    padding: theme.border.padding,
    innerGlow: undefined,
    outerGlow: undefined,
  };
}

/**
 * Resolve the effective filter for an image. Photos are left UNFILTERED unless
 * the filename explicitly requests one (e.g. `_bw`, `_sepia`). We deliberately
 * do NOT apply the theme's default filter — auto-tinting every photo looks bad.
 */
export function resolveFilter(rec: ImageRecord, _theme: Theme): string {
  const lbl = rec.parsedLabels;
  if (hasFlag(lbl, 'nofilter')) return 'none';
  return lbl.filter ?? 'none';
}

export interface ComposeOptions {
  /** Force theme border on every image. */
  borderOnAll?: boolean;
  /** Drop shadow on every image. */
  shadowOnAll?: boolean;
  /** Caption strategy. */
  captionStyle?: 'none' | 'filename' | 'exif' | 'custom';
}

/** Convert a layout slot (0..1) into an absolute pixel rectangle. */
function slotRect(slot: LayoutSlot, meta: AlbumMeta) {
  return {
    x: slot.x * meta.albumWidth,
    y: slot.y * meta.albumHeight,
    width: slot.w * meta.albumWidth,
    height: slot.h * meta.albumHeight,
  };
}

/** Rectangle helper. */
interface Rect { x: number; y: number; width: number; height: number }

/**
 * Cover-fit an image of aspect (imgW:imgH) over a frame: scale uniformly so the
 * image fully covers the frame, centered. Returns the displayed image box.
 * Preserves aspect ratio — the image is NEVER stretched.
 */
export function coverBox(frame: Rect, imgW: number, imgH: number): Rect {
  const ar = imgW > 0 && imgH > 0 ? imgW / imgH : frame.width / frame.height;
  const frameAr = frame.width / frame.height;
  let w: number; let h: number;
  if (ar > frameAr) { h = frame.height; w = h * ar; } else { w = frame.width; h = w / ar; }
  return { x: frame.x + (frame.width - w) / 2, y: frame.y + (frame.height - h) / 2, width: w, height: h };
}

/** Choose a display box for the given fit mode. */
export function boxForFit(frame: Rect, imgW: number, imgH: number, mode: 'cover' | 'contain' | 'fill' = 'cover'): Rect {
  if (mode === 'fill') return { ...frame };
  return mode === 'contain' ? containBox(frame, imgW, imgH) : coverBox(frame, imgW, imgH);
}

/** Aspect ratio helper (guards divide-by-zero). */
export function aspectOf(w: number, h: number): number { return w > 0 && h > 0 ? w / h : 1; }

/**
 * Parse a CSS-style clip-path polygon (e.g. "polygon(0 0, 65% 0, 45% 100%, 0 100%)")
 * into absolute-px points relative to a slot frame. Percentages map to the frame;
 * bare numbers are treated as px offsets from the frame origin.
 */
export function parseClipPath(clip: string, frame: Rect): { x: number; y: number }[] | undefined {
  const m = clip.match(/polygon\(([^)]*)\)/i);
  if (!m) return undefined;
  const pts = m[1].split(',').map((pair) => pair.trim().split(/\s+/));
  const coord = (v: string, span: number, origin: number): number => {
    if (v.endsWith('%')) return origin + (parseFloat(v) / 100) * span;
    return origin + parseFloat(v);
  };
  const out = pts
    .filter((p) => p.length >= 2)
    .map((p) => ({ x: coord(p[0], frame.width, frame.x), y: coord(p[1], frame.height, frame.y) }));
  return out.length >= 3 ? out : undefined;
}

/** Contain-fit: scale uniformly so the whole image fits inside the frame. */
export function containBox(frame: Rect, imgW: number, imgH: number): Rect {
  const ar = imgW > 0 && imgH > 0 ? imgW / imgH : frame.width / frame.height;
  const frameAr = frame.width / frame.height;
  let w: number; let h: number;
  if (ar > frameAr) { w = frame.width; h = w / ar; } else { h = frame.height; w = h * ar; }
  return { x: frame.x + (frame.width - w) / 2, y: frame.y + (frame.height - h) / 2, width: w, height: h };
}

/**
 * Compose a single page.
 * @param pageIndex zero-based index used for ordering.
 * @param type page type (cover/spread/single/...)
 */
export function composePage(
  layout: LayoutTemplate,
  images: ImageRecord[],
  theme: Theme,
  meta: AlbumMeta,
  pageIndex: number,
  type: PageType,
  options: ComposeOptions = {},
): AlbumPage {
  const pageId = uuid();
  const pageImages: PageImage[] = [];

  // Aspect-aware assignment: pair the widest slots with the widest (landscape)
  // images and the tallest slots with portrait images, so cover-fit crops as
  // little as possible. This is what stops auto-generated pages from looking
  // over-cropped/"stretched".
  const n = Math.min(layout.slots.length, images.length);
  const slotAspect = layout.slots.map((s) => (s.w * meta.albumWidth) / (s.h * meta.albumHeight));
  const imgAspect = images.map((r) => aspectOf(r.width, r.height));
  const slotsByAspect = layout.slots.map((_, i) => i).sort((a, b) => slotAspect[b] - slotAspect[a]);
  const imgsByAspect = images.map((_, i) => i).sort((a, b) => imgAspect[b] - imgAspect[a]);
  const slotToImg: number[] = new Array(layout.slots.length).fill(-1);
  const assigned = new Set<number>();
  for (let k = 0; k < n; k += 1) {
    slotToImg[slotsByAspect[k]] = imgsByAspect[k];
    assigned.add(imgsByAspect[k]);
  }

  layout.slots.forEach((slot, i) => {
    const rec = slotToImg[i] >= 0 ? images[slotToImg[i]] : undefined;
    if (!rec) return; // fewer images than slots — leave slot empty
    const rect = slotRect(slot, meta);
    const lbl = rec.parsedLabels;

    const forcedBorder =
      slot.borderForce ||
      (options.borderOnAll ? 'theme' : undefined) ||
      (lbl.borderStyle && lbl.borderStyle !== 'none' ? lbl.borderStyle : undefined);

    let border: BorderConfig | null = null;
    if (forcedBorder && !hasFlag(lbl, 'noborder')) {
      border = forcedBorder === 'theme' ? borderFromTheme(theme) : { ...borderFromTheme(theme) };
      if (forcedBorder === 'polaroid') { border.style = 'solid'; border.color = '#ffffff'; border.padding = 14; }
      if (forcedBorder === 'filmstrip') { border.style = 'solid'; border.color = '#111111'; border.padding = 12; }
    } else if (!hasFlag(lbl, 'noborder') && theme.border.style !== 'none') {
      // Auto-apply the theme's frame so generated pages look designed, not bare.
      border = borderFromTheme(theme);
    }
    // Angled/diagonal slots use a polygon clip — a rectangular border would look wrong.
    const clipPolygon = slot.clipPath ? parseClipPath(slot.clipPath, rect) : undefined;
    if (clipPolygon) border = null;

    const caption =
      options.captionStyle === 'filename'
        ? rec.filename.replace(/\.[^.]+$/, '')
        : options.captionStyle === 'exif'
          ? rec.exif?.dateTaken
          : lbl.captionText;

    // Rotated slots (e.g. scattered polaroids) use contain-fit without a hard
    // clip; axis-aligned slots use cover-fit clipped to the slot frame. Either
    // way the image keeps its aspect ratio and is never stretched.
    const rotation = slot.rotation ?? lbl.rotate ?? 0;
    // Crop guard: if the photo's aspect is wildly different from the slot's
    // (e.g. a portrait in a wide slot), cover-fit would crop to a sliver. In
    // that case fall back to contain (letterbox) so the whole subject is kept.
    const slotAR = rect.width / rect.height;
    const imgAR = aspectOf(rec.width, rec.height);
    const mismatch = Math.abs(Math.log(slotAR / (imgAR || 1)));
    // Letterbox (show the WHOLE photo) whenever the slot shape differs from the
    // photo by more than ~1.35x. This avoids the heavy "zoomed/cropped" look on
    // portraits placed in squarish/landscape cells — only well-matched photos
    // are cover-cropped to fill.
    const useContain = rotation !== 0 || mismatch > 0.3;
    const fitMode: 'cover' | 'contain' = useContain ? 'contain' : 'cover';
    const box = useContain
      ? containBox(rect, rec.width, rec.height)
      : coverBox(rect, rec.width, rec.height);

    pageImages.push({
      id: uuid(),
      filename: rec.relativePath,
      slotId: slot.id,
      position: {
        x: box.x, y: box.y, width: box.width, height: box.height,
        rotation,
        scaleX: 1, scaleY: 1, flipX: false, flipY: false,
      },
      slotRect: rotation === 0 ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : undefined,
      clipPolygon,
      fit: fitMode,
      crop: { x: 0, y: 0, width: 1, height: 1 },
      parsedLabels: lbl,
      overrides: {},
      effects: {
        ...defaultEffects(resolveFilter(rec, theme)),
        vignette: hasFlag(lbl, 'vignette') || hasFlag(lbl, 'spotlight') ? 0.4 : 0,
        blur: hasFlag(lbl, 'blurbg') ? 18 : 0,
        tintColor: lbl.colorTint,
        tintOpacity: lbl.colorTint ? 0.3 : 0,
        duotoneHighlight: hasFlag(lbl, 'duotone') ? theme.duotone?.highlight : undefined,
        duotoneShadow: hasFlag(lbl, 'duotone') ? theme.duotone?.shadow : undefined,
      },
      border,
      shadow: options.shadowOnAll
        ? { offsetX: 0, offsetY: 8, blur: 24, spread: 0, color: '#000000', opacity: 0.35 }
        : null,
      caption: hasFlag(lbl, 'nocaption') ? undefined : caption ?? undefined,
      opacity: slot.opacity ?? (hasFlag(lbl, 'blurbg') ? 0.5 : 1),
      zIndex: slot.zIndex ?? i,
      visible: true,
    });
  });

  // Overflow: images assigned to this page that don't fit the layout are kept
  // as not-placed entries (visible:false) so they stay mapped to the page and
  // appear in the page's bin for the user to place later.
  images.forEach((rec, i) => {
    if (assigned.has(i)) return;
    pageImages.push({
      id: uuid(),
      filename: rec.relativePath,
      slotId: 'unplaced',
      position: { x: 0, y: 0, width: rec.width, height: rec.height, rotation: 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false },
      fit: 'cover',
      crop: { x: 0, y: 0, width: 1, height: 1 },
      parsedLabels: rec.parsedLabels,
      overrides: {},
      effects: defaultEffects(resolveFilter(rec, theme)),
      border: null,
      shadow: null,
      opacity: 1,
      zIndex: 1000 + i,
      visible: false,
    });
  });

  const proverbPosition: ProverbPosition = 'standalone';
  const textBlocks: TextBlock[] = [];

  return {
    id: pageId,
    index: pageIndex,
    type,
    layoutId: layout.id,
    // Left undefined so the theme's background (gradient/pattern) is used. A
    // per-page custom colour, when chosen by the user, overrides it.
    backgroundColor: undefined,
    images: pageImages,
    decorations: [],
    textBlocks,
    proverbPosition,
    locked: false,
  };
}
