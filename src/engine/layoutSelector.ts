/**
 * layoutSelector.ts
 * -----------------------------------------------------------------------------
 * Chooses the best layout template for a group of images. Scoring blends:
 *   - compatibility (image count within [minImages, maxImages])
 *   - label affinity (hero/featured roles favour layouts with a dominant slot)
 *   - variety (penalise reusing a layout that was just used)
 */
import layoutsData from '@/config/layouts.json';
import type { LayoutTemplate, LayoutCategory } from '@shared/layout.types';
import type { ParsedImageLabels } from '@shared/pebble.types';
import { hasFlag } from './filenameParser';

export const LAYOUTS = layoutsData as unknown as LayoutTemplate[];

export function getLayout(id: string): LayoutTemplate | undefined {
  return LAYOUTS.find((l) => l.id === id);
}

export function layoutsByCategory(cat: LayoutCategory): LayoutTemplate[] {
  return LAYOUTS.filter((l) => l.category === cat);
}

/** Largest relative slot area in a template (proxy for "has a hero slot"). */
function maxSlotArea(t: LayoutTemplate): number {
  return t.slots.reduce((m, s) => Math.max(m, s.w * s.h), 0);
}

export interface LayoutScoreContext {
  /** Layout ids used on the last few pages, newest last. */
  recentLayoutIds: string[];
  /** How strongly to vary layouts (0..1). */
  variety: number;
  /** Restrict to a category (e.g. 'spread' for interior pages). */
  category?: LayoutCategory;
  /** Album width/height ratio, used to compute true slot aspect ratios. */
  albumAspect?: number;
}

/** An image's layout-relevant info: parsed labels + its real aspect ratio. */
export interface LayoutImageItem { labels: ParsedImageLabels; aspect: number }

/**
 * Aspect-fit penalty: pair the layout's slot aspect ratios with the images'
 * aspect ratios (both sorted) and sum the mismatch. Lower mismatch ⇒ less crop.
 */
function aspectMismatch(t: LayoutTemplate, items: LayoutImageItem[], albumAspect: number): number {
  const n = Math.min(t.slots.length, items.length);
  if (n === 0) return 0;
  const slotAR = t.slots.map((s) => (s.w / s.h) * albumAspect).sort((a, b) => b - a);
  const imgAR = items.map((it) => it.aspect).sort((a, b) => b - a);
  let sum = 0;
  for (let i = 0; i < n; i += 1) sum += Math.abs(Math.log((slotAR[i] || 1) / (imgAR[i] || 1)));
  return sum / n;
}

/** Score a single layout for a group of images (higher is better). */
export function scoreLayout(
  t: LayoutTemplate,
  items: LayoutImageItem[],
  ctx: LayoutScoreContext,
): number {
  const count = items.length;
  if (count < t.minImages || count > t.maxImages) return -Infinity;
  if (ctx.category && t.category !== ctx.category) return -Infinity;

  let score = 10;
  // Prefer templates whose slot count closely matches the image count.
  score -= Math.abs(t.slots.length - count) * 1.0;

  // Aspect fit is the PRIMARY factor: strongly prefer layouts whose slots match
  // the image shapes, so portraits land in portrait slots and landscapes in wide
  // slots. This is what prevents the auto layout from over-cropping photos.
  score -= aspectMismatch(t, items, ctx.albumAspect ?? 1.5) * 12;

  // Hero/featured affinity.
  const wantsHero = items.some(
    (it) => it.labels.role === 'hero' || it.labels.role === 'featured' || hasFlag(it.labels, 'fullpage'),
  );
  const dominance = maxSlotArea(t);
  if (wantsHero) score += dominance > 0.45 ? 4 : -2;

  // Creative layouts get a small boost when polaroid/filmstrip labels present.
  if (t.category === 'creative') {
    const creativeHint = items.some(
      (it) => it.labels.borderStyle === 'polaroid' || it.labels.borderStyle === 'filmstrip',
    );
    score += creativeHint ? 3 : 0.5;
  }

  // Variety penalty: discourage repeating recent layouts.
  const recencyIdx = ctx.recentLayoutIds.lastIndexOf(t.id);
  if (recencyIdx >= 0) {
    const distance = ctx.recentLayoutIds.length - recencyIdx; // 1 = most recent
    score -= (ctx.variety * 6) / distance;
  }
  return score;
}

/**
 * Select a layout for a group. When `random` is true, picks weighted-randomly
 * from the top three candidates for organic variety; otherwise the top scorer.
 */
export function selectLayout(
  items: LayoutImageItem[],
  ctx: LayoutScoreContext,
  random = false,
): LayoutTemplate {
  const albumAspect = ctx.albumAspect ?? 1.5;
  const ranked = LAYOUTS
    .map((t) => ({ t, s: scoreLayout(t, items, ctx), m: aspectMismatch(t, items, albumAspect) }))
    .filter((r) => r.s > -Infinity)
    .sort((a, b) => b.s - a.s);

  if (ranked.length === 0) {
    // Fallback: single full page never fails for >=1 images.
    return getLayout('single_full')!;
  }
  if (!random || ranked.length === 1) return ranked[0].t;

  // CRITICAL: only randomise among layouts that fit the photos' aspect well, so
  // variety never comes at the cost of jamming portraits into landscape slots.
  const minMismatch = Math.min(...ranked.map((r) => r.m));
  const goodFit = ranked.filter((r) => r.m <= minMismatch + 0.18);
  const pool = (goodFit.length ? goodFit : ranked).slice(0, 3);
  const weights = pool.map((_, i) => pool.length - i);
  const total = weights.reduce((a, b) => a + b, 0);
  let r = Math.random() * total;
  for (let i = 0; i < pool.length; i += 1) {
    r -= weights[i];
    if (r <= 0) return pool[i].t;
  }
  return pool[0].t;
}
