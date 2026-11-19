/**
 * fabricFilters.ts
 * -----------------------------------------------------------------------------
 * Maps the persisted image effects to Fabric.js v6 image filter stacks:
 *  - `buildFilterStack(id, strength)` — a NAMED preset (bw, sepia, kodachrome…)
 *    with a 0..1 strength that interpolates every parameter toward neutral.
 *  - `buildAdjustmentFilters(effects)` — the per-image ADJUST sliders
 *    (exposure/brightness/contrast/highlights/shadows/saturation/temperature/
 *    tint/hue/sharpen/blur/grain + colour wash) as a composable stack.
 *  - `buildEffectsFilters(effects)` — preset + adjustments combined; the single
 *    entry point used by the renderer.
 * Kept separate from themeEngine so the pure theme logic stays DOM/Fabric-free.
 */
import { filters } from 'fabric';
import type { ImageEffects } from '@shared/pebble.types';

/** Linear interpolation toward a neutral value (s = 0 → neutral, 1 → full). */
const mix = (neutral: number, full: number, s: number) => neutral + (full - neutral) * s;

// Warm / cool colour matrices (4x5 row-major) used by ColorMatrix, at strength s.
const warmMatrix = (s: number) => [
  mix(1, 1.1, s), 0, 0, 0, 0,
  0, 1.0, 0, 0, 0,
  0, 0, mix(1, 0.85, s), 0, 0,
  0, 0, 0, 1, 0,
];
const coolMatrix = (s: number) => [
  mix(1, 0.9, s), 0, 0, 0, 0,
  0, 1.0, 0, 0, 0,
  0, 0, mix(1, 1.15, s), 0, 0,
  0, 0, 0, 1, 0,
];

/** Metadata for every named preset, grouped for the UI. */
export interface FilterPresetDef { id: string; label: string; category: 'basic' | 'film' | 'mono' | 'color' | 'mood' }
export const FILTER_PRESETS: FilterPresetDef[] = [
  { id: 'none', label: 'Original', category: 'basic' },
  { id: 'auto_enhance', label: 'Enhance', category: 'basic' },
  { id: 'vivid', label: 'Vivid', category: 'basic' },
  { id: 'portrait_glow', label: 'Glow', category: 'basic' },
  { id: 'kodachrome', label: 'Kodak', category: 'film' },
  { id: 'technicolor', label: 'Techni', category: 'film' },
  { id: 'polaroid', label: 'Polaroid', category: 'film' },
  { id: 'vintage', label: 'Vintage', category: 'film' },
  { id: 'brownie', label: 'Brownie', category: 'film' },
  { id: 'lomo', label: 'Lomo', category: 'film' },
  { id: 'matte_film', label: 'Matte', category: 'film' },
  { id: 'bw', label: 'B&W', category: 'mono' },
  { id: 'noir', label: 'Noir', category: 'mono' },
  { id: 'silver', label: 'Silver', category: 'mono' },
  { id: 'sepia', label: 'Sepia', category: 'mono' },
  { id: 'warm', label: 'Warm', category: 'color' },
  { id: 'warm_skin', label: 'Golden', category: 'color' },
  { id: 'cool', label: 'Cool', category: 'color' },
  { id: 'muted', label: 'Muted', category: 'color' },
  { id: 'faded', label: 'Faded', category: 'mood' },
  { id: 'fade', label: 'Airy', category: 'mood' },
  { id: 'dramatic', label: 'Drama', category: 'mood' },
  { id: 'chrome', label: 'Chrome', category: 'mood' },
  { id: 'cinematic', label: 'Cinema', category: 'mood' },
];

/**
 * Build a fresh preset filter stack (filters are stateful, so never share
 * instances). `strength` 0..1 interpolates every parameter toward neutral so a
 * preset can be dialled in like PicsArt/Instagram intensity sliders.
 */
export function buildFilterStack(filterId: string, strength = 1): unknown[] {
  const s = Math.max(0, Math.min(1, strength));
  if (s === 0) return [];
  switch (filterId) {
    case 'bw': return s >= 1 ? [new filters.Grayscale()] : [new filters.Saturation({ saturation: -s })];
    case 'noir': return [
      ...(s >= 1 ? [new filters.Grayscale()] : [new filters.Saturation({ saturation: -s })]),
      new filters.Contrast({ contrast: 0.35 * s }), new filters.Brightness({ brightness: -0.06 * s }),
    ];
    case 'silver': return [
      ...(s >= 1 ? [new filters.Grayscale()] : [new filters.Saturation({ saturation: -s })]),
      new filters.Brightness({ brightness: 0.12 * s }), new filters.Contrast({ contrast: -0.08 * s }),
    ];
    case 'sepia': return s >= 1 ? [new filters.Sepia()] : [new filters.Saturation({ saturation: -0.6 * s }), new filters.ColorMatrix({ matrix: warmMatrix(s) })];
    case 'vivid': return [new filters.Saturation({ saturation: 0.6 * s }), new filters.Contrast({ contrast: 0.2 * s })];
    case 'muted': return [new filters.Saturation({ saturation: -0.4 * s })];
    case 'warm': return [new filters.ColorMatrix({ matrix: warmMatrix(s) })];
    case 'cool': return [new filters.ColorMatrix({ matrix: coolMatrix(s) })];
    case 'faded': return [new filters.Brightness({ brightness: 0.15 * s }), new filters.Saturation({ saturation: -0.3 * s }), new filters.Contrast({ contrast: -0.1 * s })];
    case 'dramatic': return [new filters.Contrast({ contrast: 0.4 * s }), new filters.Brightness({ brightness: -0.05 * s })];
    // Fabric v6 has no Vignette filter; the lomo vignette is applied separately
    // via the per-image vignette overlay. Approximate the tone here.
    case 'lomo': return [new filters.Saturation({ saturation: 0.4 * s }), new filters.Contrast({ contrast: 0.3 * s }), new filters.Brightness({ brightness: -0.05 * s })];
    case 'chrome': return [new filters.Contrast({ contrast: 0.3 * s }), new filters.Brightness({ brightness: 0.1 * s }), new filters.Saturation({ saturation: -0.2 * s })];
    case 'fade': return [new filters.Brightness({ brightness: 0.25 * s }), new filters.Saturation({ saturation: -0.5 * s }), new filters.Contrast({ contrast: -0.2 * s })];
    // One-tap polish: a gentle lift to brightness/contrast/saturation.
    case 'auto_enhance': return [new filters.Brightness({ brightness: 0.06 * s }), new filters.Contrast({ contrast: 0.12 * s }), new filters.Saturation({ saturation: 0.15 * s })];
    // Soft, bright portrait look (no harsh contrast).
    case 'portrait_glow': return [new filters.Brightness({ brightness: 0.1 * s }), new filters.Contrast({ contrast: -0.05 * s }), new filters.Saturation({ saturation: 0.05 * s })];
    // Warm, skin-friendly cast for mixed-white-balance event photos.
    case 'warm_skin': return [new filters.ColorMatrix({ matrix: warmMatrix(s) }), new filters.Saturation({ saturation: 0.08 * s }), new filters.Brightness({ brightness: 0.03 * s })];
    // Matte film: lifted blacks, desaturated, low contrast.
    case 'matte_film': return [new filters.Contrast({ contrast: -0.15 * s }), new filters.Brightness({ brightness: 0.06 * s }), new filters.Saturation({ saturation: -0.18 * s })];
    // Teal-and-orange blockbuster grade.
    case 'cinematic': return [
      new filters.Contrast({ contrast: 0.18 * s }),
      new filters.ColorMatrix({ matrix: [
        mix(1, 1.06, s), 0, 0, 0, 0,
        0, 1, 0, 0, 0,
        0, 0, mix(1, 1.08, s), 0, mix(0, -0.02, s),
        0, 0, 0, 1, 0,
      ] }),
      new filters.Saturation({ saturation: 0.12 * s }),
    ];
    // Fabric's classic film emulations (full-strength only below 1 we blend via matrix-less approx).
    case 'kodachrome': return [new filters.Kodachrome()];
    case 'technicolor': return [new filters.Technicolor()];
    case 'polaroid': return [new filters.Polaroid()];
    case 'vintage': return [new filters.Vintage()];
    case 'brownie': return [new filters.Brownie()];
    default: return [];
  }
}

/** Identity-preserving sharpen kernel blended by amount a (0..1). */
const sharpenKernel = (a: number) => [
  0, -a, 0,
  -a, 1 + 4 * a, -a,
  0, -a, 0,
];

/**
 * Build the ADJUST slider stack from persisted effects. Every value has a
 * neutral default, so untouched images produce an empty stack (fast path).
 */
export function buildAdjustmentFilters(e: ImageEffects): unknown[] {
  const out: unknown[] = [];
  const exposure = e.exposure ?? 0;
  if (exposure) {
    const g = 1 + Math.max(-0.9, Math.min(1, exposure));
    out.push(new filters.ColorMatrix({ matrix: [g, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, g, 0, 0, 0, 0, 0, 1, 0] }));
  }
  if (e.brightness) out.push(new filters.Brightness({ brightness: Math.max(-1, Math.min(1, e.brightness)) }));
  if (e.contrast) out.push(new filters.Contrast({ contrast: Math.max(-1, Math.min(1, e.contrast)) }));
  const highlights = e.highlights ?? 0;
  if (highlights) {
    // Scale + counter-offset: raises/crushes the top end far more than the low end.
    const k = 0.35 * Math.max(-1, Math.min(1, highlights));
    out.push(new filters.ColorMatrix({ matrix: [1 + k, 0, 0, 0, -k * 0.25, 0, 1 + k, 0, 0, -k * 0.25, 0, 0, 1 + k, 0, -k * 0.25, 0, 0, 0, 1, 0] }));
  }
  const shadows = e.shadows ?? 0;
  if (shadows) {
    // Gamma primarily moves the low/mid end: >1 lifts shadows, <1 crushes them.
    const g = 1 + 0.6 * Math.max(-1, Math.min(1, shadows));
    out.push(new filters.Gamma({ gamma: [g, g, g] }));
  }
  if (e.saturation) out.push(new filters.Saturation({ saturation: Math.max(-1, Math.min(1, e.saturation)) }));
  const temperature = e.temperature ?? 0;
  if (temperature) out.push(new filters.ColorMatrix({ matrix: temperature > 0 ? warmMatrix(temperature) : coolMatrix(-temperature) }));
  const tint = e.tint ?? 0;
  if (tint) {
    const t = 0.25 * Math.max(-1, Math.min(1, tint));
    // +tint → magenta (raise R/B, lower G); −tint → green.
    out.push(new filters.ColorMatrix({ matrix: [1 + t * 0.6, 0, 0, 0, 0, 0, 1 - t, 0, 0, 0, 0, 0, 1 + t * 0.6, 0, 0, 0, 0, 0, 1, 0] }));
  }
  const hue = e.hue ?? 0;
  if (hue) out.push(new filters.HueRotation({ rotation: (Math.max(-180, Math.min(180, hue)) * Math.PI) / 180 }));
  // Legacy neutral is 1 (multiplier); anything above sharpens.
  const sharpenAmt = Math.max(0, Math.min(1, (e.sharpness ?? 1) - 1));
  if (sharpenAmt > 0.01) out.push(new filters.Convolute({ matrix: sharpenKernel(sharpenAmt) }));
  if (e.blur) out.push(new filters.Blur({ blur: Math.max(0, Math.min(1, e.blur / 25)) }));
  if (e.noise) out.push(new filters.Noise({ noise: Math.round(Math.max(0, Math.min(1, e.noise)) * 180) }));
  if (e.tintColor && e.tintOpacity) out.push(new filters.BlendColor({ color: e.tintColor, alpha: Math.max(0, Math.min(1, e.tintOpacity)), mode: 'tint' }));
  if (e.duotoneHighlight && e.duotoneShadow) {
    out.push(new filters.Grayscale());
    out.push(new filters.BlendColor({ color: e.duotoneHighlight, alpha: 0.5, mode: 'lighten' }));
    out.push(new filters.BlendColor({ color: e.duotoneShadow, alpha: 0.5, mode: 'darken' }));
  }
  return out;
}

/** The full stack for an image: named preset first, then the adjust sliders. */
export function buildEffectsFilters(e: ImageEffects): unknown[] {
  const preset = e.filter && e.filter !== 'none' ? buildFilterStack(e.filter, e.filterStrength ?? 1) : [];
  return [...preset, ...buildAdjustmentFilters(e)];
}
