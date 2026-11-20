/**
 * pageRenderer.ts
 * -----------------------------------------------------------------------------
 * Shared Fabric.js object construction used by BOTH the interactive editor
 * canvas and the static full-DPI exporter. Keeping object building in one place
 * guarantees the preview and the export match pixel-for-pixel.
 */
import { StaticCanvas, FabricImage, Textbox, Rect, Path, Polygon, Shadow, Gradient, config, util, getFilterBackend, setFilterBackend, Canvas2dFilterBackend, type FabricObject } from 'fabric';
import type { AlbumPage, AlbumMeta, PageImage, TextBlock } from '@shared/pebble.types';
import type { Theme } from '@shared/theme.types';
import { drawPattern, getPattern, resolveColor, type RenderEnv } from './decoEngine';
import { buildEffectsFilters } from './fabricFilters';
import { buildMaskPath, maskPathData } from './maskShapes';
import { buildCurvedTextGroup } from './curvedText';
import { getThemeFilterCSS } from './themeEngine';
import { overlayDataUrl } from '@/config/overlays';
import { stickerDataUrl } from '@/config/stickers';
import { borderFrameDataUrl, getBorderFrame } from './borderFrames';
import { blendThroughMask } from './maskBlend';

/** Loader that turns a project-relative filename into a data URL. */
export type ImageLoader = (filename: string) => Promise<string>;

/** Build a procedural decoration background as a data URL (or null if none). */
export function buildBackgroundDataUrl(page: AlbumPage, meta: AlbumMeta, theme: Theme): string | null {
  if (typeof document === 'undefined') return null;
  const drawables = page.decorations.filter((d) => d.visible && d.renderer && getPattern(d.renderer)?.type === 'canvas_draw');
  if (!drawables.length) return null;
  const scale = Math.min(1, 1400 / meta.albumWidth);
  const cv = document.createElement('canvas');
  cv.width = Math.round(meta.albumWidth * scale);
  cv.height = Math.round(meta.albumHeight * scale);
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  const env: RenderEnv = { w: cv.width, h: cv.height, theme, seed: hashId(page.id) };
  for (const d of drawables) if (d.renderer) drawPattern(d.renderer, ctx, env);
  return cv.toDataURL('image/png');
}

/**
 * Build the theme's distinct page background (gradient or faint pattern) as a
 * data URL, or null for a plain solid background. This is what makes each
 * template look different — not just recoloured. Drawn as the very first layer.
 */
export function buildThemeBackground(meta: AlbumMeta, theme: Theme): string | null {
  if (typeof document === 'undefined') return null;
  const bg = theme.background;
  if (!bg || bg.type === 'solid') return null;
  const scale = Math.min(1, 1400 / meta.albumWidth);
  const cv = document.createElement('canvas');
  cv.width = Math.round(meta.albumWidth * scale);
  cv.height = Math.round(meta.albumHeight * scale);
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  const base = bg.base ?? theme.colors.background;

  if (bg.type === 'gradient') {
    const angle = ((bg.angle ?? 135) * Math.PI) / 180;
    const x = Math.cos(angle); const y = Math.sin(angle);
    const g = ctx.createLinearGradient(
      cv.width / 2 - (x * cv.width) / 2, cv.height / 2 - (y * cv.height) / 2,
      cv.width / 2 + (x * cv.width) / 2, cv.height / 2 + (y * cv.height) / 2,
    );
    g.addColorStop(0, bg.from ?? base);
    g.addColorStop(1, bg.to ?? theme.colors.surface);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cv.width, cv.height);
  } else {
    // pattern: solid base + a faint procedural pattern on top.
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, cv.width, cv.height);
    if (bg.pattern) drawPattern(bg.pattern, ctx, { w: cv.width, h: cv.height, theme, seed: 1 });
  }
  return cv.toDataURL('image/png');
}

/**
 * Per-page background (gradient or faint pattern texture), overriding the theme
 * background. Returns a data URL or null when the page uses a plain/solid bg.
 */
export function buildPageBackgroundDataUrl(page: AlbumPage, meta: AlbumMeta, theme: Theme): string | null {
  if (typeof document === 'undefined') return null;
  if (!page.backgroundGradient && !page.backgroundPattern) return null;
  const scale = Math.min(1, 1400 / meta.albumWidth);
  const cv = document.createElement('canvas');
  cv.width = Math.round(meta.albumWidth * scale);
  cv.height = Math.round(meta.albumHeight * scale);
  const ctx = cv.getContext('2d');
  if (!ctx) return null;
  const base = page.backgroundColor || theme.colors.background;
  if (page.backgroundGradient) {
    const angle = ((page.backgroundGradient.angle ?? 135) * Math.PI) / 180;
    const x = Math.cos(angle); const y = Math.sin(angle);
    const g = ctx.createLinearGradient(
      cv.width / 2 - (x * cv.width) / 2, cv.height / 2 - (y * cv.height) / 2,
      cv.width / 2 + (x * cv.width) / 2, cv.height / 2 + (y * cv.height) / 2,
    );
    g.addColorStop(0, page.backgroundGradient.from);
    g.addColorStop(1, page.backgroundGradient.to);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, cv.width, cv.height);
  } else {
    ctx.fillStyle = base;
    ctx.fillRect(0, 0, cv.width, cv.height);
  }
  if (page.backgroundPattern) drawPattern(page.backgroundPattern, ctx, { w: cv.width, h: cv.height, theme, seed: 2 });
  return cv.toDataURL('image/png');
}

function hashId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i += 1) h = (h * 31 + id.charCodeAt(i)) | 0;
  return Math.abs(h) % 100000;
}

/**
 * Re-run an image's current filter stack, guarding against the WebGL backend's
 * texture-size limit. Fabric's GL helper canvas is `config.textureSize` square;
 * filtering an image LARGER than that silently truncates the output (a 6000px
 * tall photo lost its bottom third in the preview/export). Oversized images are
 * routed through the pixel-correct (CPU) Canvas2D backend instead.
 */
export function applyFiltersSafe(img: FabricImage): void {
  const limit = config.textureSize || 4096;
  const oversized = (img.width || 0) > limit || (img.height || 0) > limit;
  if (!oversized) {
    try { img.applyFilters(); } catch { /* filter backend unavailable */ }
    return;
  }
  let prev: ReturnType<typeof getFilterBackend> | null = null;
  try { prev = getFilterBackend(); } catch { prev = null; }
  try {
    setFilterBackend(new Canvas2dFilterBackend());
    img.applyFilters();
  } catch { /* filter backend unavailable */ } finally {
    if (prev) setFilterBackend(prev);
  }
}

/**
 * (Re)apply the FULL effects pipeline — named preset + adjust sliders — to a
 * live Fabric image. Used by the initial build and by the editor's in-place
 * effects updates (no canvas rebuild ⇒ no flicker while dragging a slider).
 */
export function applyEffects(img: FabricImage, pi: PageImage): void {
  const stack = buildEffectsFilters(pi.effects);
  // @ts-expect-error fabric filter typing is loose across the union
  img.filters = stack;
  if (stack.length || (img as unknown as { __hadFilters?: boolean }).__hadFilters) applyFiltersSafe(img);
  (img as unknown as { __hadFilters?: boolean }).__hadFilters = stack.length > 0;
  applyFilterMask(img);
}

/** The decoded Filter-brush mask attached to a Fabric photo by buildImageObject. */
type WithFilterMask = { pebbleFilterMask?: CanvasImageSource | null };

/**
 * ONE scratch canvas for applyFilterMask, reused across calls so a slider drag
 * does not allocate a photo-sized canvas per tick. Resized as needed; dropped
 * after a blend larger than SCRATCH_KEEP_PX (full-DPI export pages) so a huge
 * backing store is never retained.
 */
const SCRATCH_KEEP_PX = 2600 * 2600;
let blendScratch: HTMLCanvasElement | null = null;

/**
 * Filter brush (`PageImage.filterMask`): after Fabric has filtered the photo,
 * blend the ORIGINAL pixels back in through the mask, in place on Fabric's
 * filtered canvas (see maskBlend.ts) — result = original·(1−m) + filtered·m.
 * Runs after EVERY (re)filter, so the in-place slider updates, the initial
 * build and the restore after hold-to-compare all agree. When the filter stack
 * is empty Fabric draws the original element itself → nothing to blend
 * (hold-to-compare clears the stack, so it shows the original as before).
 * Pure 2D compositing on the 2D canvas Fabric hands back from BOTH backends
 * (WebGL copies its output into it), so no GL texture is created or leaked.
 */
export function applyFilterMask(img: FabricImage): void {
  const mask = (img as unknown as WithFilterMask).pebbleFilterMask;
  if (!mask) return;
  const el = img.getElement() as unknown;
  const orig = (img as unknown as { _originalElement?: unknown })._originalElement;
  if (!orig || el === orig || !(el instanceof HTMLCanvasElement)) return; // unfiltered → original shows
  try {
    if (!blendScratch) blendScratch = document.createElement('canvas');
    blendThroughMask(el, orig as CanvasImageSource, mask, null, blendScratch);
    img.set('dirty', true);
  } catch { /* 2D canvas unavailable → leave the fully filtered photo */ }
  if (blendScratch && blendScratch.width * blendScratch.height > SCRATCH_KEEP_PX) {
    blendScratch.width = 0; blendScratch.height = 0; blendScratch = null;
  }
}

/**
 * Build a Fabric image object. The source image is scaled UNIFORMLY (no stretch)
 * using its stored display box, and — when the image belongs to a slot — clipped
 * to the slot frame so it fills the frame and crops cleanly. Free images are not
 * clipped and remain fully movable.
 */
/**
 * The single source of truth for where a photo sits and how big it is, given the
 * photo's TRUE pixel size. Shared by the initial render and by in-place edits so
 * they can never disagree. ⚠⚠ Returns a UNIFORM scale → the photo never stretches.
 */
export function computeImagePlacement(pi: PageImage, imgW: number, imgH: number): { scale: number; left: number; top: number } {
  const iw = imgW || 1; const ih = imgH || 1;
  if (pi.slotRect && !pi.manual) {
    const f = pi.slotRect;
    const fCover = Math.max(f.width / iw, f.height / ih);
    const fContain = Math.min(f.width / iw, f.height / ih);
    // 'auto': fill the cell, but fit the WHOLE photo when filling would crop more
    // than ~1.7× (big photo in a small cell) — so it's never over-zoomed.
    const baseFit = pi.fit === 'cover' ? fCover
      : pi.fit === 'contain' ? fContain
        : (fCover / fContain > 1.7 ? fContain : fCover);
    const zoom = pi.coverZoom && pi.coverZoom > 0 ? pi.coverZoom : 1;
    const scale = baseFit * zoom;
    const dispW = iw * scale; const dispH = ih * scale;
    const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
    const fx = pi.focus ? clamp01(pi.focus.x) : 0.5;
    const fy = pi.focus ? clamp01(pi.focus.y) : 0.5;
    // Put the focal point at the frame centre, then clamp so the frame stays
    // covered (when the photo is larger than the frame on that axis); when the
    // photo is smaller than the frame on an axis (contain), centre it.
    let left = f.x + f.width / 2 - fx * dispW;
    let top = f.y + f.height / 2 - fy * dispH;
    left = dispW >= f.width ? Math.min(f.x, Math.max(f.x + f.width - dispW, left)) : f.x + (f.width - dispW) / 2;
    top = dispH >= f.height ? Math.min(f.y, Math.max(f.y + f.height - dispH, top)) : f.y + (f.height - dispH) / 2;
    return { scale, left, top };
  }
  // MANUAL slot photo, or FREE photo: the stored display box drives a uniform scale.
  const rw = pi.position.width / iw; const rh = pi.position.height / ih;
  const scale = pi.fit === 'contain' ? Math.min(rw, rh) : Math.max(rw, rh);
  return { scale, left: pi.position.x, top: pi.position.y };
}

/**
 * Erase-mask loader (PicsArt-style non-destructive eraser, see
 * `PageImage.eraseMask`). ⚠ Masks are read as the RAW PNG — NEVER through
 * `loadImageDataUrl` / `generateThumbnail`: that pipeline may emit JPEG, which
 * has no alpha channel and would turn the mask into "keep everything".
 * Cached by absolute path; safe because every mask save writes a NEW uniquely
 * named file (a changed mask is a changed path, so a hit is never stale).
 * The cache is a small LRU (each entry is a multi-MB base64 PNG and every Apply
 * creates a new path, so an unbounded map only ever grew). Erase and filter
 * masks have SEPARATE caches, so a page of photos with both never thrashes.
 * Resolves `null` for "no mask" — including a missing/unreadable file, which
 * must degrade to the plain photo, not a missing-photo placeholder. Failures
 * are not cached, so a mask written moments later is still picked up.
 * ⚠ A path that could escape the album folder (absolute, drive letter, `..`
 * segment, NUL) is refused as "no mask": a hand-edited .pebble must not be able
 * to make the renderer read arbitrary files.
 */
const MASK_CACHE_MAX = 12; // per cache
const eraseMaskCache = new Map<string, Promise<string | null>>();
const filterMaskCache = new Map<string, Promise<string | null>>();

/** True for a project-relative path that stays inside the album folder. */
function isSafeRelativePath(rel: string): boolean {
  if (!rel || rel.includes('\0')) return false;
  if (/^[\\/]/.test(rel) || /^[a-zA-Z]:/.test(rel)) return false; // absolute / UNC / drive
  return !rel.split(/[\\/]+/).some((seg) => seg === '..');
}

function loadMaskPng(cache: Map<string, Promise<string | null>>, sourceFolder: string | undefined, maskPath: string | undefined): Promise<string | null> {
  if (!maskPath || typeof window === 'undefined' || !window.pebble) return Promise.resolve(null);
  if (!isSafeRelativePath(maskPath)) return Promise.resolve(null);
  const abs = `${sourceFolder ?? ''}/${maskPath}`;
  const hit = cache.get(abs);
  if (hit) {
    // LRU touch: re-insert so it becomes the most recently used entry.
    cache.delete(abs);
    cache.set(abs, hit);
    return hit;
  }
  const p = window.pebble.readImageBase64(abs).catch(() => {
    if (cache.get(abs) === p) cache.delete(abs);
    return null;
  });
  cache.set(abs, p);
  while (cache.size > MASK_CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
  return p;
}

export function loadEraseMask(sourceFolder: string | undefined, maskPath: string | undefined): Promise<string | null> {
  return loadMaskPng(eraseMaskCache, sourceFolder, maskPath);
}

/** Filter-brush mask loader (`PageImage.filterMask`): the same raw-PNG, LRU-cached,
 *  path-guarded loader as the erase mask (same storage rules), with its own cache. */
export function loadFilterMask(sourceFolder: string | undefined, maskPath: string | undefined): Promise<string | null> {
  return loadMaskPng(filterMaskCache, sourceFolder, maskPath);
}

/**
 * Bake an erase mask INTO the photo's pixels before Fabric ever sees it: the
 * photo is drawn at its natural size, then the mask (alpha = keep) is drawn
 * stretched over the whole canvas with `destination-in`, so erased areas become
 * transparent. Because the result is just "a photo with alpha" of the SAME
 * pixel size, everything downstream keeps working unchanged: the placement math
 * (`computeImagePlacement` sees identical width/height), filters + in-place
 * effects updates + hold-to-compare (they filter this baked element), the drop
 * shadow (follows the erased silhouette), clipPaths and shape masks.
 */
async function bakeEraseMask(dataUrl: string, maskUrl: string, crossOrigin: 'anonymous' | null): Promise<HTMLCanvasElement> {
  const [photo, mask] = await Promise.all([
    util.loadImage(dataUrl, { crossOrigin }),
    util.loadImage(maskUrl),
  ]);
  const w = photo.naturalWidth || photo.width;
  const h = photo.naturalHeight || photo.height;
  if (!w || !h || !(mask.naturalWidth || mask.width)) throw new Error('Undecodable photo or erase mask');
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  if (!ctx) throw new Error('2D canvas unavailable');
  ctx.drawImage(photo, 0, 0, w, h);
  ctx.globalCompositeOperation = 'destination-in';
  ctx.drawImage(mask, 0, 0, w, h); // stretched over the WHOLE source photo
  ctx.globalCompositeOperation = 'source-over';
  return cv;
}

/**
 * Build a Fabric image object for a page photo. `maskUrl` (from
 * `loadEraseMask`) is the optional erase mask; it is baked into the pixels
 * first (see bakeEraseMask). An undecodable mask falls back to the plain photo.
 * With no mask the photo loads exactly as it always has.
 * `filterMaskUrl` (from `loadFilterMask`) is the optional Filter-brush mask: it
 * is decoded once and kept on the object, and `applyEffects` blends the
 * original back in through it after every filter pass (see applyFilterMask).
 * An undecodable filter mask falls back to "filter everywhere".
 */
export async function buildImageObject(pi: PageImage, dataUrl: string, maskUrl?: string | null, filterMaskUrl?: string | null): Promise<FabricImage> {
  // Only set crossOrigin for remote URLs; doing so for file:// or data: URLs can
  // make Chromium fail the load.
  const remote = /^https?:/i.test(dataUrl);
  let img: FabricImage | null = null;
  if (maskUrl) {
    try { img = new FabricImage(await bakeEraseMask(dataUrl, maskUrl, remote ? 'anonymous' : null)); } catch { img = null; /* bad mask → plain photo */ }
  }
  if (!img) img = await FabricImage.fromURL(dataUrl, remote ? { crossOrigin: 'anonymous' } : {});
  if (filterMaskUrl) {
    try {
      const fm = await util.loadImage(filterMaskUrl);
      if (fm.naturalWidth || fm.width) (img as unknown as WithFilterMask).pebbleFilterMask = fm;
    } catch { /* bad filter mask → filter everywhere */ }
  }
  const { position } = pi;
  const imgW = img.width || 1;
  const imgH = img.height || 1;
  const { scale, left, top } = computeImagePlacement(pi, imgW, imgH);

  // ⚠ Flips are set EXPLICITLY (flipX/flipY + positive scale), never as a
  // negative scale: Fabric v6's `_set` TOGGLES flipX/flipY every time it is given
  // a negative scale, so re-applying the same "negative scale" on an in-place
  // update un-flipped (then re-flipped…) the photo. The flip mirrors the content
  // about the object's CENTRE; left/top/box stay where they are.
  img.set({
    left, top,
    scaleX: Math.abs(scale), scaleY: Math.abs(scale),
    flipX: !!position.flipX, flipY: !!position.flipY,
    angle: position.rotation,
    opacity: pi.opacity,
    originX: 'left',
    originY: 'top',
  });

  // Clip the photo to its frame (absolute canvas coords). Angled slots use a
  // polygon clip for diagonal/creative cuts; shape masks (circle/heart/star…)
  // clip to their path; slots use a rounded rect; free photos use a RELATIVE
  // rounded clip so the rounding rotates with the photo.
  if (pi.clipPolygon && pi.clipPolygon.length >= 3) {
    img.clipPath = new Polygon(pi.clipPolygon.map((p) => ({ x: p.x, y: p.y })), { absolutePositioned: true });
  } else if (pi.maskId) {
    // The mask is fitted to the photo's VISIBLE bounds (not the raw slot), so a
    // contain-fit photo in a big slot gets the shape on the photo itself.
    img.clipPath = buildMaskPath(pi.maskId, displayRectOf(pi, imgW, imgH));
  } else if (pi.slotRect) {
    const r = pi.slotRect;
    const radius = pi.border?.radius ?? 0;
    img.clipPath = new Rect({
      left: r.x, top: r.y, width: r.width, height: r.height,
      rx: radius, ry: radius, absolutePositioned: true,
    });
  } else if (pi.border && pi.border.radius > 0) {
    // Free/rotated photo: relative rounded clip (inherits the image's rotation),
    // so corner radius is respected even on a tilted photo.
    const r = pi.border.radius / (Math.abs(scale) || 1);
    img.clipPath = new Rect({ width: img.width, height: img.height, rx: r, ry: r, originX: 'center', originY: 'center' });
  }

  applyEffects(img, pi);
  if (pi.shadow) {
    img.set('shadow', new Shadow({
      color: pi.shadow.color, blur: pi.shadow.blur,
      offsetX: pi.shadow.offsetX, offsetY: pi.shadow.offsetY,
    }));
  }
  (img as unknown as { pebbleId: string; pebbleType: string }).pebbleId = pi.id;
  (img as unknown as { pebbleType: string }).pebbleType = 'image';
  return img;
}

/** Frame rect for an image: the slot frame if present, else the image box. */
function frameOf(pi: PageImage) {
  return pi.slotRect ?? { x: pi.position.x, y: pi.position.y, width: pi.position.width, height: pi.position.height };
}

export interface ChromeRect { x: number; y: number; width: number; height: number }

/**
 * The photo's VISIBLE bounds: where the pixels actually are on the page —
 * the true display box (from the same placement math as the photo itself)
 * intersected with the slot frame when there is one. Borders, decorative
 * frames and the vignette are drawn on THIS rect, so they hug the image
 * exactly like the shadow does — a contain-fit photo inside a full-page cover
 * slot gets its frame on the photo, not around the whole page.
 */
export function displayRectOf(pi: PageImage, imgW: number, imgH: number): ChromeRect {
  const { scale, left, top } = computeImagePlacement(pi, imgW || 1, imgH || 1);
  const disp = { x: left, y: top, width: (imgW || 1) * Math.abs(scale), height: (imgH || 1) * Math.abs(scale) };
  const f = pi.slotRect;
  if (!f) return disp;
  const x1 = Math.max(f.x, disp.x); const y1 = Math.max(f.y, disp.y);
  const x2 = Math.min(f.x + f.width, disp.x + disp.width);
  const y2 = Math.min(f.y + f.height, disp.y + disp.height);
  if (x2 <= x1 || y2 <= y1) return { x: f.x, y: f.y, width: f.width, height: f.height };
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

/**
 * A stroked outline that TRACES the shape mask (dotted ellipse, dashed heart…).
 * Used for both line borders and — as a stylised fallback — decorative frames
 * on masked photos, so the frame follows the shape instead of staying a
 * rectangle around the old frame.
 */
function buildMaskOutline(pi: PageImage, rect: ChromeRect, opts: { color: string; width: number; dash?: number[] | null; round?: boolean }): Path {
  const p = new Path(maskPathData(pi.maskId!, rect.width, rect.height), {
    left: rect.x, top: rect.y, originX: 'left', originY: 'top',
    angle: pi.slotRect ? 0 : pi.position.rotation,
    fill: 'transparent', stroke: opts.color, strokeWidth: opts.width,
    selectable: false, evented: false, objectCaching: false,
  });
  if (opts.dash) p.strokeDashArray = opts.dash;
  if (opts.round) p.strokeLineCap = 'round';
  (p as unknown as { pebbleId: string; pebbleType: string }).pebbleId = pi.id;
  (p as unknown as { pebbleType: string }).pebbleType = 'border';
  return p;
}

/**
 * Build the border. It hugs the photo's VISIBLE bounds (pass `rect` from
 * displayRectOf — falls back to the slot/box), follows the photo's rotation
 * (free photos), respects corner radius, and supports solid / dashed / dotted
 * styles. When a shape mask is active the border TRACES the mask outline.
 */
export function buildBorderRect(pi: PageImage, rect?: ChromeRect): FabricObject | null {
  // 'pattern' borders are decorative SVG frames (see buildBorderFrameImage).
  if (!pi.border || pi.border.style === 'none' || pi.border.style === 'pattern' || pi.border.width <= 0) return null;
  const useFrame = !!pi.slotRect;
  const f = rect ?? frameOf(pi);
  const w = pi.border.width;
  if (pi.maskId) {
    // Follow the mask shape: same stroke styling, drawn along the mask path.
    const dash = pi.border.style === 'dashed' ? [w * 2.2, w * 1.6]
      : pi.border.style === 'dotted' ? [0.1, w * 1.8] : null;
    return buildMaskOutline(pi, f, { color: pi.border.color, width: w, dash, round: pi.border.style === 'dotted' });
  }
  // Gradient or solid stroke.
  let stroke: NonNullable<ConstructorParameters<typeof Rect>[0]>['stroke'] = pi.border.color;
  if (pi.border.gradient) {
    const a = ((pi.border.gradient.angle ?? 0) * Math.PI) / 180;
    const dx = Math.cos(a) / 2; const dy = Math.sin(a) / 2;
    stroke = new Gradient({
      type: 'linear', gradientUnits: 'percentage',
      coords: { x1: 0.5 - dx, y1: 0.5 - dy, x2: 0.5 + dx, y2: 0.5 + dy },
      colorStops: [
        { offset: 0, color: pi.border.gradient.from },
        { offset: 1, color: pi.border.gradient.to },
      ],
    });
  }
  const opts: ConstructorParameters<typeof Rect>[0] = {
    left: f.x, top: f.y, width: f.width, height: f.height,
    angle: useFrame ? 0 : pi.position.rotation,
    originX: 'left', originY: 'top',
    fill: 'transparent', stroke, strokeWidth: w,
    rx: pi.border.radius, ry: pi.border.radius,
    selectable: false, evented: false,
  };
  if (pi.border.style === 'dashed') opts.strokeDashArray = [w * 2.2, w * 1.6];
  else if (pi.border.style === 'dotted') { opts.strokeDashArray = [0.1, w * 1.8]; opts.strokeLineCap = 'round'; }
  return new Rect(opts);
}

/**
 * Build a decorative border-FRAME for `style: 'pattern'` borders, on the
 * photo's VISIBLE bounds (pass `rect` from displayRectOf). The SVG is generated
 * at the rect's exact pixel size so the motif tiles without stretching. On a
 * shape-masked photo the motif can't bend around the shape, so the frame
 * renders as a dotted outline TRACING the mask instead (same colour/weight).
 */
export async function buildBorderFrameImage(pi: PageImage, rect?: ChromeRect): Promise<FabricObject | null> {
  if (!pi.border || pi.border.style !== 'pattern' || !pi.border.frameId) return null;
  const f = rect ?? frameOf(pi);
  const def = getBorderFrame(pi.border.frameId);
  const t = Math.max(8, (pi.border.width || 18) * (def?.thicknessFactor ?? 1));
  if (pi.maskId) {
    const w = Math.max(4, Math.round(t * 0.45));
    const p = buildMaskOutline(pi, f, { color: pi.border.color, width: w, dash: [0.1, w * 1.9], round: true });
    (p as unknown as { pebbleType: string }).pebbleType = 'borderframe';
    return p;
  }
  const url = borderFrameDataUrl(pi.border.frameId, f.width, f.height, pi.border.color, t);
  if (!url) return null;
  const img = await FabricImage.fromURL(url);
  img.set({
    left: f.x, top: f.y, originX: 'left', originY: 'top',
    angle: pi.slotRect ? 0 : pi.position.rotation,
    scaleX: 1, scaleY: 1, selectable: false, evented: false,
  });
  (img as unknown as { pebbleId: string; pebbleType: string }).pebbleId = pi.id;
  (img as unknown as { pebbleType: string }).pebbleType = 'borderframe';
  return img;
}

/**
 * Per-image VIGNETTE overlay: a radial-gradient rect over the photo's frame
 * (transparent centre → darkened edges). Fabric has no vignette filter, so this
 * object — built identically by the editor and the exporter — provides it.
 */
export function buildVignetteOverlay(pi: PageImage, rect?: ChromeRect): Rect | null {
  const amount = Math.max(0, Math.min(1, pi.effects?.vignette ?? 0));
  if (!amount) return null;
  const f = rect ?? frameOf(pi);
  const cx = f.width / 2; const cy = f.height / 2;
  const r = Math.sqrt(cx * cx + cy * cy);
  const overlay = new Rect({
    left: f.x, top: f.y, width: f.width, height: f.height,
    originX: 'left', originY: 'top',
    angle: pi.slotRect ? 0 : pi.position.rotation,
    rx: pi.border?.radius ?? 0, ry: pi.border?.radius ?? 0,
    selectable: false, evented: false,
    fill: new Gradient({
      type: 'radial',
      coords: { x1: cx, y1: cy, r1: r * 0.45, x2: cx, y2: cy, r2: r },
      colorStops: [
        { offset: 0, color: 'rgba(0,0,0,0)' },
        { offset: 1, color: `rgba(0,0,0,${(0.85 * amount).toFixed(3)})` },
      ],
    }),
  });
  if (pi.maskId) overlay.clipPath = buildMaskPath(pi.maskId, f);
  (overlay as unknown as { pebbleId: string; pebbleType: string }).pebbleId = pi.id;
  (overlay as unknown as { pebbleType: string }).pebbleType = 'vignette';
  return overlay;
}

/** True for full-page wash decorations that must sit BEHIND photos. */
function isWashOverlay(id: string, mode?: string): boolean {
  return mode === 'center_background' || id.includes('wash');
}

async function placeOverlay(
  out: FabricImage[], url: string, left: number, top: number, w: number, h: number,
  opacity: number, angle = 0, originX: 'left' | 'center' | 'right' = 'left', originY: 'top' | 'center' | 'bottom' = 'top',
) {
  const img = await FabricImage.fromURL(url);
  img.set({ left, top, angle, originX, originY, opacity, selectable: false, evented: false,
    scaleX: w / (img.width || 1), scaleY: h / (img.height || 1) });
  out.push(img);
}

/**
 * Background wash overlays (soft, low-opacity) — added BEFORE photos so they
 * never tint or cover the images.
 */
export async function buildSvgBackgroundObjects(page: AlbumPage, meta: AlbumMeta, theme: Theme): Promise<FabricImage[]> {
  const out: FabricImage[] = [];
  const W = meta.albumWidth; const H = meta.albumHeight;
  const accent = resolveColor('theme.accent', theme);
  for (const d of page.decorations) {
    if (!d.visible) continue;
    const def = getPattern(d.renderer ?? '');
    if (!def || def.type !== 'svg_overlay') continue;
    if (!isWashOverlay(def.id, def.mode as string)) continue;
    const url = overlayDataUrl(def.id, accent);
    if (!url) continue;
    await placeOverlay(out, url, 0, 0, W, H, Math.min(0.12, (def.opacity as number) ?? 0.1));
  }
  return out;
}

/**
 * Edge/frame SVG decorations (corners, frames, scallop bands, ribbons) — added
 * ON TOP of photos but only at the page edges, so they never cover the subject.
 */
export async function buildSvgOverlayObjects(page: AlbumPage, meta: AlbumMeta, theme: Theme): Promise<FabricImage[]> {
  const out: FabricImage[] = [];
  const W = meta.albumWidth; const H = meta.albumHeight;
  const accent = resolveColor('theme.accent', theme);
  for (const d of page.decorations) {
    if (!d.visible) continue;
    const def = getPattern(d.renderer ?? '');
    if (!def || def.type !== 'svg_overlay') continue;
    if (isWashOverlay(def.id, def.mode as string)) continue; // handled as background
    const url = overlayDataUrl(def.id, accent);
    if (!url) continue;
    const opacity = (def.opacity as number) ?? d.opacity ?? 0.85;
    const positions = def.positions as string[] | undefined;
    const mode = def.mode as string | undefined;

    if (def.id === 'scallop_border') {
      // Thin decorative bands at the very top and bottom only (never stretched
      // across the whole page).
      const band = H * 0.05;
      await placeOverlay(out, url, 0, 0, W, band, opacity);
      await placeOverlay(out, url, 0, H, W, band, opacity, 180, 'right', 'top');
    } else if (positions && positions.length) {
      const s = (def.scaleFactor as number) ?? 0.18;
      const cw = W * s; const ch = cw;
      for (const pos of positions) {
        if (pos === 'top-left') await placeOverlay(out, url, 0, 0, cw, ch, opacity, 0);
        else if (pos === 'top-right') await placeOverlay(out, url, W, 0, cw, ch, opacity, 90);
        else if (pos === 'bottom-right') await placeOverlay(out, url, W, H, cw, ch, opacity, 180);
        else if (pos === 'bottom-left') await placeOverlay(out, url, 0, H, cw, ch, opacity, 270);
        else if (pos === 'top') await placeOverlay(out, url, 0, 0, W, H * 0.06, opacity);
        else if (pos === 'bottom') await placeOverlay(out, url, 0, H, W, H * 0.06, opacity, 0, 'left', 'bottom');
      }
    } else if (mode === 'full_frame') {
      // Ornate/lace frames are edge-only by design (transparent centre).
      await placeOverlay(out, url, 0, 0, W, H, Math.min(0.7, opacity));
    }
  }
  return out;
}

/** A decoration with the shape the sticker builders need. */
type StickerDeco = { id: string; params: Record<string, unknown>; position: { x: number; y: number; width: number; height: number; rotation: number }; opacity: number };

/** Build a sticker/object decoration (emoji or unicode glyph) as a Fabric text. */
export function buildStickerObject(d: StickerDeco): Textbox {
  const glyph = String(d.params.emoji ?? d.params.glyph ?? '★');
  const t = new Textbox(glyph, {
    left: d.position.x, top: d.position.y,
    fontSize: d.position.width || 80, angle: d.position.rotation,
    opacity: d.opacity, editable: false, fill: '#000',
  });
  (t as unknown as { pebbleId: string; pebbleType: string }).pebbleId = d.id;
  (t as unknown as { pebbleType: string }).pebbleType = 'decoration';
  return t;
}

/**
 * Build a sticker object. When the decoration references an SVG sticker
 * (`params.svg = '<id>'`) it is loaded as an image and scaled UNIFORMLY to fit
 * its box — so a non-square sticker keeps its true aspect ratio and never
 * stretches. Otherwise it falls back to the emoji/glyph text sticker.
 */
export async function buildStickerObjectAsync(d: StickerDeco): Promise<FabricImage | Textbox> {
  // Custom (cutout) sticker: an absolute PNG path from the My Stickers library.
  const file = typeof d.params.file === 'string' ? d.params.file : undefined;
  if (file) {
    try {
      const dataUrl = await window.pebble.readImageBase64(file);
      const img = await FabricImage.fromURL(dataUrl);
      const iw = img.width || 1; const ih = img.height || 1;
      const scale = Math.min((d.position.width || iw) / iw, (d.position.height || ih) / ih);
      img.set({
        left: d.position.x, top: d.position.y, originX: 'left', originY: 'top',
        scaleX: scale, scaleY: scale, angle: d.position.rotation, opacity: d.opacity,
      });
      (img as unknown as { pebbleId: string; pebbleType: string }).pebbleId = d.id;
      (img as unknown as { pebbleType: string }).pebbleType = 'decoration';
      return img;
    } catch { /* missing file → fall through to the glyph fallback */ }
  }
  const svgId = typeof d.params.svg === 'string' ? d.params.svg : undefined;
  if (svgId) {
    const url = stickerDataUrl(svgId);
    if (url) {
      const img = await FabricImage.fromURL(url);
      const iw = img.width || 1; const ih = img.height || 1;
      const scale = Math.min((d.position.width || iw) / iw, (d.position.height || ih) / ih);
      img.set({
        left: d.position.x, top: d.position.y, originX: 'left', originY: 'top',
        scaleX: scale, scaleY: scale, angle: d.position.rotation, opacity: d.opacity,
      });
      (img as unknown as { pebbleId: string; pebbleType: string }).pebbleId = d.id;
      (img as unknown as { pebbleType: string }).pebbleType = 'decoration';
      return img;
    }
  }
  return buildStickerObject(d);
}

/** Build a Fabric Textbox for a text block. */
export function buildTextObject(tb: TextBlock): FabricObject {
  const s = tb.style;
  // PicsArt-style "Bend": non-zero curve renders each character along an arc.
  if (s.curve) return buildCurvedTextGroup(tb);
  const opts: ConstructorParameters<typeof Textbox>[1] = {
    left: tb.position.x, top: tb.position.y, width: tb.position.width,
    angle: tb.position.rotation,
    fontFamily: s.fontFamily, fontSize: s.fontSize,
    fontWeight: s.fontWeight, fontStyle: s.fontStyle,
    fill: s.color, textAlign: s.align,
    lineHeight: s.lineHeight, charSpacing: s.letterSpacing * 10,
    opacity: s.opacity,
  };
  // Legibility kit: background plate, outline (stroke behind fill), drop shadow.
  if (s.background) opts.backgroundColor = s.background;
  if (s.textStroke && s.textStroke.width > 0) {
    opts.stroke = s.textStroke.color; opts.strokeWidth = s.textStroke.width; opts.paintFirst = 'stroke';
  }
  const t = new Textbox(tb.content, opts);
  if (s.textShadow) {
    t.set('shadow', new Shadow({ color: s.textShadow.color, blur: s.textShadow.blur, offsetX: s.textShadow.offsetX, offsetY: s.textShadow.offsetY }));
  }
  (t as unknown as { pebbleId: string; pebbleType: string }).pebbleId = tb.id;
  (t as unknown as { pebbleType: string }).pebbleType = 'text';
  return t;
}

/**
 * Render a page to a full-resolution PNG data URL on an offscreen StaticCanvas.
 * Used by the exporter; `dpiScale` multiplies album px to reach target DPI.
 */
export async function renderPageStatic(
  page: AlbumPage, meta: AlbumMeta, theme: Theme, load: ImageLoader, dpiScale = 1,
): Promise<string> {
  // ⚠ Scale via the VIEWPORT TRANSFORM (exactly like the interactive editor),
  // NOT via a toDataURL `multiplier`. A fractional multiplier does not scale
  // `absolutePositioned` clipPaths, so clipped photos were truncated to their top
  // portion in the low-res page-turn preview (cream page showing below). Sizing
  // the canvas + zooming the viewport keeps clips correct at any scale (down or up).
  const s = dpiScale > 0 ? dpiScale : 1;
  const canvas = new StaticCanvas(undefined, {
    width: Math.max(1, Math.round(meta.albumWidth * s)),
    height: Math.max(1, Math.round(meta.albumHeight * s)),
    backgroundColor: page.backgroundColor || theme.colors.background,
  });
  if (s !== 1) canvas.setViewportTransform([s, 0, 0, s, 0, 0]);

  // Page background: a per-page gradient/texture overrides the theme background;
  // otherwise the theme's distinct background shows when no solid colour is set.
  {
    const pageBg = buildPageBackgroundDataUrl(page, meta, theme)
      || (!page.backgroundColor ? buildThemeBackground(meta, theme) : null);
    if (pageBg) {
      const tImg = await FabricImage.fromURL(pageBg);
      tImg.set({ left: 0, top: 0, scaleX: meta.albumWidth / (tImg.width || 1), scaleY: meta.albumHeight / (tImg.height || 1), selectable: false, evented: false });
      canvas.add(tImg);
    }
  }

  const bg = buildBackgroundDataUrl(page, meta, theme);
  if (bg) {
    const bgImg = await FabricImage.fromURL(bg);
    bgImg.set({ left: 0, top: 0, scaleX: meta.albumWidth / (bgImg.width || 1), scaleY: meta.albumHeight / (bgImg.height || 1), selectable: false });
    canvas.add(bgImg);
  }
  // ALL decoration art (washes + corners/frames/scallop borders) sits BEHIND the
  // photos so patterns never cover the images. Only stickers go in front.
  for (const wb of await buildSvgBackgroundObjects(page, meta, theme)) canvas.add(wb);
  for (const ov of await buildSvgOverlayObjects(page, meta, theme)) canvas.add(ov);

  const ordered = [...page.images].sort((a, b) => a.zIndex - b.zIndex);
  for (const pi of ordered) {
    if (!pi.visible) continue;
    try {
      // eslint-disable-next-line no-await-in-loop
      const url = await load(pi.filename);
      // Erase mask (raw PNG, never the thumbnail pipeline) — null when absent/unreadable.
      // eslint-disable-next-line no-await-in-loop
      const maskUrl = await loadEraseMask(meta.sourceFolder, pi.eraseMask);
      // Filter-brush mask (same rules) — null → filter everywhere.
      // eslint-disable-next-line no-await-in-loop
      const fxMaskUrl = await loadFilterMask(meta.sourceFolder, pi.filterMask);
      // eslint-disable-next-line no-await-in-loop
      const obj = await buildImageObject(pi, url, maskUrl, fxMaskUrl);
      canvas.add(obj);
      const chromeRect = displayRectOf(pi, obj.width || 1, obj.height || 1);
      const vig = buildVignetteOverlay(pi, chromeRect);
      if (vig) canvas.add(vig);
      const border = buildBorderRect(pi, chromeRect);
      if (border) canvas.add(border);
      // eslint-disable-next-line no-await-in-loop
      const frame = await buildBorderFrameImage(pi, chromeRect);
      if (frame) canvas.add(frame);
    } catch { /* missing image — skip in export */ }
  }

  // Sticker / object decorations (emoji glyphs + SVG art) — the only decorations
  // in front of the photos.
  for (const d of page.decorations) {
    if (d.visible && d.type === 'sticker') {
      // eslint-disable-next-line no-await-in-loop
      canvas.add(await buildStickerObjectAsync(d));
    }
  }

  for (const tb of page.textBlocks) if (tb.visible) canvas.add(buildTextObject(tb));
  if (page.proverb) {
    canvas.add(buildTextObject({
      id: `${page.id}-prov`, content: page.proverb, type: 'proverb',
      position: { x: meta.albumWidth * 0.1, y: meta.albumHeight * 0.86, width: meta.albumWidth * 0.8, height: 80, rotation: 0 },
      style: {
        fontFamily: theme.fonts.display, fontSize: Math.round(meta.albumHeight * 0.03),
        fontWeight: 'normal', fontStyle: 'italic', color: theme.colors.text, align: 'center',
        letterSpacing: 0, lineHeight: 1.3, textTransform: 'none', opacity: 0.9,
      },
      zIndex: 200, visible: true, locked: false,
    }));
  }

  canvas.renderAll();
  // Canvas is already at the target pixel size via the viewport transform, so no
  // multiplier here (which would re-introduce the clipPath-scaling bug).
  const url = canvas.toDataURL({ format: 'png', multiplier: 1 });
  canvas.dispose();
  return url;
}

/** CSS filter for quick DOM previews (e.g. wizard / thumbnails). */
export { getThemeFilterCSS };
