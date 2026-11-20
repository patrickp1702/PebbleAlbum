/**
 * maskBlend.ts
 * -----------------------------------------------------------------------------
 * The ONE compositing step of the Filter brush (`PageImage.filterMask`):
 *
 *     result = original · (1 − m) + filtered · m        (m = mask alpha 0..1)
 *
 * done with plain 2D-canvas compositing, so it is identical whichever Fabric
 * filter backend (WebGL or Canvas2D) produced the filtered pixels:
 *   1. `target` (holding the FILTERED pixels) ← destination-in mask  → F·m
 *   2. scratch ← original, then destination-out mask                → O·(1−m)
 *   3. `target` ← scratch with 'lighter' (additive)                 → F·m + O·(1−m)
 * Canvas pixels are premultiplied, so the additive step is an exact lerp in
 * premultiplied space — the alpha of a partly ERASED photo (original and
 * filtered share it) is preserved: a·m + a·(1−m) = a.
 *
 * Used by pageRenderer (editor canvas, thumbnails, export, page-turn preview)
 * and by the brush studio's live preview. Renderer-only (DOM canvas); no store
 * or Fabric imports.
 */

export interface BlendRect { x: number; y: number; w: number; h: number }

/**
 * Blend `original` back into `target` (which holds the filtered pixels) through
 * `mask`, in place. `mask` and `original` are drawn stretched over the whole
 * target (mask = un-flipped source space, same as the erase mask). With `rect`,
 * only that region of the target is touched (other pixels stay as they are);
 * `scratch` is an optional reusable canvas (resized as needed) to avoid an
 * allocation per call — without it a temporary canvas is created and released.
 */
export function blendThroughMask(
  target: HTMLCanvasElement,
  original: CanvasImageSource,
  mask: CanvasImageSource,
  rect?: BlendRect | null,
  scratch?: HTMLCanvasElement | null,
): void {
  const W = target.width; const H = target.height;
  if (!W || !H) return;
  const r = rect ?? { x: 0, y: 0, w: W, h: H };
  if (r.w <= 0 || r.h <= 0) return;
  const tc = target.getContext('2d');
  if (!tc) return;
  const own = !scratch;
  const sc = scratch ?? document.createElement('canvas');
  if (sc.width < r.w || sc.height < r.h) { sc.width = Math.max(sc.width, r.w); sc.height = Math.max(sc.height, r.h); }
  const sx = sc.getContext('2d');
  if (!sx) return;

  // 2. O·(1−m) for the region, drawn at scratch (0,0). The full-size original /
  //    mask are positioned so that the region's top-left lands at the origin.
  //    Clipped: destination-out/-in are unbounded in Chromium.
  sx.save();
  sx.setTransform(1, 0, 0, 1, 0, 0);
  sx.globalCompositeOperation = 'source-over';
  sx.clearRect(0, 0, r.w, r.h);
  sx.beginPath(); sx.rect(0, 0, r.w, r.h); sx.clip();
  sx.imageSmoothingEnabled = true; sx.imageSmoothingQuality = 'high';
  sx.drawImage(original, -r.x, -r.y, W, H);
  sx.globalCompositeOperation = 'destination-out';
  sx.drawImage(mask, -r.x, -r.y, W, H);
  sx.restore();

  // 1 + 3 on the target, clipped to the region.
  tc.save();
  tc.setTransform(1, 0, 0, 1, 0, 0);
  tc.beginPath(); tc.rect(r.x, r.y, r.w, r.h); tc.clip();
  tc.imageSmoothingEnabled = true; tc.imageSmoothingQuality = 'high';
  tc.globalCompositeOperation = 'destination-in';
  tc.drawImage(mask, 0, 0, W, H);
  tc.globalCompositeOperation = 'lighter';
  tc.drawImage(sc, 0, 0, r.w, r.h, r.x, r.y, r.w, r.h);
  tc.restore();

  if (own) { sc.width = 0; sc.height = 0; } // release the temporary backing store
}
