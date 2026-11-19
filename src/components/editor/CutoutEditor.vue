<script setup lang="ts">
/**
 * CutoutEditor.vue — PicsArt-style Erase / Restore studio (fullscreen modal).
 *
 * Two modes:
 *  - **Page image** (`imageId` set): a NON-DESTRUCTIVE, IN-CONTEXT mask editor.
 *    The photo is drawn exactly where it sits on the page (placement, rotation,
 *    flip, frame clip, effects, opacity) over a static render of everything
 *    BELOW it, so the user sees what they are blending into. Only the erase
 *    MASK is edited; "Apply" saves it under `.pebble_masks/` and points
 *    `pi.eraseMask` at it through a history command. The source photo is never
 *    touched, so Restore can bring back anything erased in an earlier session.
 *  - **Sticker** (no `imageId`): the photo alone on a checkerboard; output is a
 *    transparent PNG saved to the global My Stickers library.
 *
 * Brushes — **Erase** and **Restore** — each with Size (SCREEN px, so the ring
 * keeps its size while zooming) / Opacity / Hardness. A stroke's dabs
 * accumulate on their own layer at full alpha and the stroke is composited into
 * the mask ONCE on pointer-up at the brush opacity, so overlaps inside one
 * stroke never exceed the chosen opacity while repeated strokes build up
 * "layer by layer" (100% removes outright). Optional one-click AI background
 * removal (client-side, @imgly WASM model) just sets the mask.
 *
 * ⚠ Pointer → photo pixels goes through the INVERSE of the full matrix
 * (dpr-free view pan/zoom × page placement × rotation × flip about the photo
 * centre — identical to Fabric's), so the dab lands exactly under the cursor at
 * any zoom/rotation/flip. The mask lives in UN-FLIPPED source-pixel space (the
 * same space the renderer bakes it in), which the inverse gives for free.
 *
 * ⚠ The working resolution EQUALS the saved-mask resolution (≤ MASK_MAX), so
 * a mask that is reopened and re-applied is copied 1:1 — never resampled
 * (an upscale→downscale round trip softened hard edges on every Apply).
 */
import { ref, onMounted, onBeforeUnmount, computed } from 'vue';
import { FabricImage } from 'fabric';
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { useAppStore } from '@/stores/appStore';
import { computeImagePlacement, renderPageStatic, applyEffects, displayRectOf } from '@/engine/pageRenderer';
import { maskPathData, buildMaskPath } from '@/engine/maskShapes';
import { loadImageDataUrl } from '@/engine/imageLoader';
import AppSlider from '@/components/ui/AppSlider.vue';
import AppButton from '@/components/ui/AppButton.vue';
import type { AlbumPage, PageImage } from '@shared/pebble.types';

const props = defineProps<{ filename: string; imageId?: string | null }>();
const emit = defineEmits<{ (e: 'close'): void }>();

const project = useProjectStore();
const editor = useEditorStore();
const app = useAppStore();

const MASK_MAX = 2048;   // long-side cap of the SAVED mask (stretched over the photo)
/** ⚠ Working cap = saved-mask cap: more buys nothing (the mask is saved at
 *  ≤ MASK_MAX) and cost ~400 MB of canvases at 4096². */
const WORK_MAX = MASK_MAX;
const UNDO_DEPTH = 30;
const UNDO_MAX_BYTES = 192 * 1024 * 1024; // across BOTH stacks; oldest dropped first
const BACKDROP_MAX = 2400; // long-side px of the static page backdrop

const host = ref<HTMLDivElement | null>(null);
const view = ref<HTMLCanvasElement | null>(null);
const loading = ref(true);
const aiBusy = ref(false);
const saving = ref(false);
const tool = ref<'erase' | 'restore' | 'pan'>('erase');
const brushSize = ref(80);     // SCREEN px (diameter)
const brushOpacity = ref(40);  // % per stroke
const brushHardness = ref(30); // % (0 = fully feathered, 100 = crisp edge)
const canUndo = ref(false);
const canRedo = ref(false);
/** Mask changed since it was opened/applied (Esc asks before discarding). */
const edited = ref(false);
const showPage = ref(true);
const stickerName = ref('');
const spaceHeld = ref(false);

/** The page image being edited (null in sticker mode). Snapshot at open. */
let pi: PageImage | null = null;
let page: AlbumPage | null = null;
const inContext = ref(false);

// Working buffers (capped resolution, allocated ONCE — never per frame).
let src: HTMLCanvasElement | null = null;      // original pixels (sticker / AI input)
let fx: HTMLCanvasElement | null = null;       // src with the photo's effects (display only)
let mask: HTMLCanvasElement | null = null;     // committed alpha (white, alpha = keep)
let stroke: HTMLCanvasElement | null = null;   // in-progress stroke (dabs at full alpha)
let eff: HTMLCanvasElement | null = null;      // scratch: mask ± stroke at brush opacity
let composed: HTMLCanvasElement | null = null; // fx masked by eff — what is drawn
let W = 0; let H = 0;
/** Page (album px) size; equals W×H in sticker mode (photo space = page space). */
let AW = 0; let AH = 0;
let backdrop: HTMLImageElement | null = null;

/** Photo px → page px: placement × rotation × flip (identity in sticker mode). */
let P = new DOMMatrix();
/** Uniform album-px-per-photo-px of the placement (1 in sticker mode). */
let placeScale = 1;
/**
 * The page's clip of this photo, mirrored from pageRenderer's priority order:
 * clipPolygon (page px) > maskId shape (fitted to displayRectOf) > slotRect
 * (rounded by the border radius) > a free photo's rounded corners (PHOTO px,
 * so they rotate/flip with it). `bounds` (page px) drives the initial fit.
 */
let clip: { path: Path2D; space: 'page' | 'photo'; bounds: { x: number; y: number; width: number; height: number } | null } | null = null;

// View transform: screen(CSS px) = zoom * page + (ox, oy).
let zoom = 1; let ox = 0; let oy = 0;

interface Box { x0: number; y0: number; x1: number; y1: number }
interface MaskEdit { x: number; y: number; data: ImageData }
const undoStack: MaskEdit[] = [];
const redoStack: MaskEdit[] = [];

// Stroke state (tool / opacity / radius captured at pointer-down).
let drawing = false; let panning = false;
let strokeErase = true; let strokeAlpha = 1; let strokeR = 1; let strokeHard = 0.3;
let strokeBox: Box | null = null;
/** The ONE pointer driving the current stroke/pan (others are ignored). */
let activePointer: number | null = null;
let lastX = 0; let lastY = 0;           // last stamped dab (photo px) / last pan point (screen)
let cursor: { x: number; y: number } | null = null; // screen px, for the brush ring
let raf = 0; let needsPaint = true;
/** Region of `composed` that must be rebuilt (mask or stroke changed). */
let composeBox: Box | null = null;

const isErase = computed(() => tool.value === 'erase');
const panMode = computed(() => tool.value === 'pan' || spaceHeld.value);

function makeCanvas(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
}
function loadImg(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  return new Promise((res, rej) => { img.onload = () => res(img); img.onerror = () => rej(new Error('load')); img.src = url; });
}
function unionBox(a: Box | null, b: Box): Box {
  return a ? { x0: Math.min(a.x0, b.x0), y0: Math.min(a.y0, b.y0), x1: Math.max(a.x1, b.x1), y1: Math.max(a.y1, b.y1) } : { ...b };
}
/** Integer, canvas-clamped rect of a box (null when empty). */
function clampBox(b: Box): { x: number; y: number; w: number; h: number } | null {
  const x = Math.max(0, Math.floor(b.x0)); const y = Math.max(0, Math.floor(b.y0));
  const x1 = Math.min(W, Math.ceil(b.x1)); const y1 = Math.min(H, Math.ceil(b.y1));
  return x1 > x && y1 > y ? { x, y, w: x1 - x, h: y1 - y } : null;
}
const FULL = (): Box => ({ x0: 0, y0: 0, x1: W, y1: H });
function markCompose(b: Box) { composeBox = unionBox(composeBox, b); }
function requestPaint() { needsPaint = true; }

/**
 * Photo px → page px, exactly as Fabric draws the photo (originX/Y = left/top,
 * flipX/flipY + positive scale): translate to the top-left, rotate about it,
 * scale uniformly, then mirror about the photo's OWN centre.
 */
function placementMatrix(p: PageImage, w: number, h: number): { m: DOMMatrix; scale: number } {
  const { scale, left, top } = computeImagePlacement(p, w, h);
  const m = new DOMMatrix()
    .translate(left, top)
    .rotate(p.position.rotation || 0)
    .scale(scale, scale)
    .translate(w / 2, h / 2)
    .scale(p.position.flipX ? -1 : 1, p.position.flipY ? -1 : 1)
    .translate(-w / 2, -h / 2);
  return { m, scale: Math.abs(scale) || 1 };
}
function viewMatrix(): DOMMatrix { return new DOMMatrix([zoom, 0, 0, zoom, ox, oy]); }
/** Screen (CSS px, relative to the canvas) → photo px, via the full inverse. */
function screenToPhoto(sx: number, sy: number): { x: number; y: number } {
  const q = viewMatrix().multiply(P).inverse().transformPoint(new DOMPoint(sx, sy));
  return { x: q.x, y: q.y };
}
/** Brush radius in photo px (size is in SCREEN px, total scale is uniform). */
function brushRadiusPhoto(): number { return Math.max(0.5, (brushSize.value / 2) / (zoom * placeScale)); }

async function loadAll() {
  const folder = project.meta?.sourceFolder ?? '';
  const found = props.imageId ? project.findImage(props.imageId) : null;
  pi = found?.image ?? null; page = found?.page ?? null;
  inContext.value = !!pi;
  const abs = `${folder}/${pi?.filename ?? props.filename}`;
  try {
    // The ORIGINAL file (best quality for the sticker output). Formats Chromium
    // can't decode (TIFF, …) fall back to the Sharp pipeline — EXIF-rotated,
    // exactly what the page canvas shows.
    let img: HTMLImageElement;
    try {
      img = await loadImg(await window.pebble.readImageBase64(abs));
    } catch {
      img = await loadImg(await window.pebble.readImageBase64(await window.pebble.generateThumbnail(abs, WORK_MAX)));
    }
    const k = Math.min(1, WORK_MAX / Math.max(img.naturalWidth, img.naturalHeight));
    W = Math.max(1, Math.round(img.naturalWidth * k));
    H = Math.max(1, Math.round(img.naturalHeight * k));
    src = makeCanvas(W, H); src.getContext('2d')!.drawImage(img, 0, 0, W, H);
  } catch {
    app.toast('Could not load the photo.', 'error');
    emit('close');
    return;
  }
  mask = makeCanvas(W, H); stroke = makeCanvas(W, H); eff = makeCanvas(W, H); composed = makeCanvas(W, H);
  const mc = mask.getContext('2d')!;
  mc.fillStyle = '#fff'; mc.fillRect(0, 0, W, H);

  if (pi && project.meta) {
    AW = project.meta.albumWidth; AH = project.meta.albumHeight;
    const pm = placementMatrix(pi, W, H); P = pm.m; placeScale = pm.scale;
    // Framed photo → clip to its cell (clipPolygon / shape masks ignored here).
    clip = buildClip(pi);
    // Resume a previous session: the saved mask is the starting state (raw PNG
    // — the thumbnail loader would turn it into an alpha-less JPEG).
    if (pi.eraseMask) {
      try {
        const m = await loadImg(await window.pebble.readImageBase64(`${folder}/${pi.eraseMask}`));
        mc.clearRect(0, 0, W, H);
        if (m.naturalWidth === W && m.naturalHeight === H) {
          mc.drawImage(m, 0, 0); // same resolution → exact 1:1 copy (no resampling)
        } else {
          mc.imageSmoothingQuality = 'high';
          mc.drawImage(m, 0, 0, W, H); // stretched over the WHOLE photo
        }
      } catch { app.toast('Could not read the saved erase mask — starting from the full photo.', 'warning'); }
    }
    // Effects for display only (the mask is independent of them).
    try {
      const fimg = new FabricImage(src);
      try {
        applyEffects(fimg, pi);
        const el = fimg.getElement() as CanvasImageSource;
        // COPY first, then dispose (frees its WebGL textures from Fabric's cache).
        if (el !== src) { fx = makeCanvas(W, H); fx.getContext('2d')!.drawImage(el, 0, 0, W, H); }
      } finally {
        fimg.dispose();
      }
    } catch { fx = null; }
    void buildBackdrop();
  } else {
    AW = W; AH = H; P = new DOMMatrix(); placeScale = 1;
  }
  fitView();
  markCompose(FULL());
  loading.value = false;
  requestPaint();
}

/**
 * Static render of what lies UNDER this photo: images below it in z-order
 * (visible ones), decorations except stickers, no text. Rendered once.
 */
async function buildBackdrop() {
  if (!pi || !page || !project.meta || !project.theme) return;
  const meta = project.meta;
  const ordered = [...page.images].sort((a, b) => a.zIndex - b.zIndex); // same stable order as the renderer
  const idx = ordered.findIndex((i) => i.id === pi!.id);
  const below = ordered.slice(0, Math.max(0, idx)).filter((i) => i.visible);
  const under: AlbumPage = {
    ...page, images: below,
    decorations: page.decorations.filter((d) => d.type !== 'sticker'),
    textBlocks: [], proverb: undefined,
  };
  try {
    const k = Math.min(1, BACKDROP_MAX / Math.max(meta.albumWidth, meta.albumHeight));
    const url = await renderPageStatic(under, meta, project.theme, (f) => loadImageDataUrl(meta.sourceFolder, f, 1600), k);
    backdrop = await loadImg(url);
    requestPaint();
  } catch { backdrop = null; }
}

/** The page's clip for this photo (see `clip`), or null when unclipped. */
function buildClip(p: PageImage): typeof clip {
  if (p.clipPolygon && p.clipPolygon.length >= 3) {
    const path = new Path2D();
    p.clipPolygon.forEach((q, i) => (i ? path.lineTo(q.x, q.y) : path.moveTo(q.x, q.y)));
    path.closePath();
    const xs = p.clipPolygon.map((q) => q.x); const ys = p.clipPolygon.map((q) => q.y);
    const x = Math.min(...xs); const y = Math.min(...ys);
    return { path, space: 'page', bounds: { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y } };
  }
  if (p.maskId) {
    // EXACTLY the renderer's clip: buildMaskPath(maskId, displayRectOf(…)) drawn
    // the way Fabric draws a Path — its own matrix, minus its pathOffset. (Fabric
    // aligns the path's BOUNDING BOX to the rect, so shapes whose bbox is inset
    // — star, hexagon… — are NOT at a plain translate(rect.x, rect.y).)
    const rect = displayRectOf(p, W, H);
    const fp = buildMaskPath(p.maskId, rect);
    const m = fp.calcTransformMatrix(); const o = fp.pathOffset;
    const path = new Path2D();
    path.addPath(new Path2D(maskPathData(p.maskId, rect.width, rect.height)),
      new DOMMatrix([m[0], m[1], m[2], m[3], m[4], m[5]]).translate(-o.x, -o.y));
    return { path, space: 'page', bounds: rect };
  }
  if (p.slotRect) {
    const f = p.slotRect; const radius = p.border?.radius ?? 0;
    const path = new Path2D();
    if (radius > 0) path.roundRect(f.x, f.y, f.width, f.height, radius); else path.rect(f.x, f.y, f.width, f.height);
    return { path, space: 'page', bounds: { ...f } };
  }
  if (p.border && p.border.radius > 0) {
    const path = new Path2D();
    path.roundRect(0, 0, W, H, p.border.radius / placeScale); // album px → photo px
    return { path, space: 'photo', bounds: null };
  }
  return null;
}

/** Fit the photo's visible on-page bounds with a comfortable margin. */
function fitView() {
  if (!host.value || !W) return;
  const vw = host.value.clientWidth; const vh = host.value.clientHeight;
  const pts = [[0, 0], [W, 0], [0, H], [W, H]].map(([x, y]) => P.transformPoint(new DOMPoint(x, y)));
  let x0 = Math.min(...pts.map((p) => p.x)); let x1 = Math.max(...pts.map((p) => p.x));
  let y0 = Math.min(...pts.map((p) => p.y)); let y1 = Math.max(...pts.map((p) => p.y));
  const cb = clip?.bounds;
  if (cb) {
    x0 = Math.max(x0, cb.x); y0 = Math.max(y0, cb.y);
    x1 = Math.min(x1, cb.x + cb.width); y1 = Math.min(y1, cb.y + cb.height);
    if (x1 <= x0 || y1 <= y0) { x0 = cb.x; y0 = cb.y; x1 = x0 + cb.width; y1 = y0 + cb.height; }
  }
  const bw = Math.max(1, x1 - x0); const bh = Math.max(1, y1 - y0);
  // Page images get a wider margin so some of the page shows around the photo.
  const m = inContext.value ? Math.max(64, Math.min(vw, vh) * 0.14) : 24;
  zoom = Math.max(1e-4, Math.min((vw - 2 * m) / bw, (vh - 2 * m) / bh));
  ox = vw / 2 - zoom * (x0 + bw / 2);
  oy = vh / 2 - zoom * (y0 + bh / 2);
  requestPaint();
}

/**
 * Rebuild `composed` inside a region only: eff = mask ± stroke (at the brush
 * opacity, exactly what pointer-up will commit), composed = fx ∩ eff. Clipped,
 * because destination-in is UNBOUNDED in Chromium and would wipe the rest.
 */
function recompose(b: Box) {
  if (!mask || !stroke || !eff || !composed || !src) return;
  const r = clampBox(b);
  if (!r) return;
  const ec = eff.getContext('2d')!;
  ec.save();
  ec.beginPath(); ec.rect(r.x, r.y, r.w, r.h); ec.clip();
  ec.clearRect(r.x, r.y, r.w, r.h);
  ec.drawImage(mask, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
  if (drawing) {
    ec.globalAlpha = strokeAlpha;
    ec.globalCompositeOperation = strokeErase ? 'destination-out' : 'source-over';
    ec.drawImage(stroke, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
  }
  ec.restore();
  const cc = composed.getContext('2d')!;
  cc.save();
  cc.beginPath(); cc.rect(r.x, r.y, r.w, r.h); cc.clip();
  cc.clearRect(r.x, r.y, r.w, r.h);
  cc.drawImage(fx ?? src, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
  cc.globalCompositeOperation = 'destination-in';
  cc.drawImage(eff, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
  cc.restore();
}

function paint() {
  raf = requestAnimationFrame(paint);
  if (!view.value || !host.value || !composed) return;
  // Recompose ONLY when the mask/stroke changed — never on pan/zoom/cursor.
  if (composeBox) { recompose(composeBox); composeBox = null; needsPaint = true; }
  if (!needsPaint) return;
  needsPaint = false;
  const dpr = window.devicePixelRatio || 1;
  const vw = host.value.clientWidth; const vh = host.value.clientHeight;
  const cw = Math.round(vw * dpr); const ch = Math.round(vh * dpr);
  if (view.value.width !== cw || view.value.height !== ch) { view.value.width = cw; view.value.height = ch; }
  const ctx = view.value.getContext('2d')!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, cw, ch);
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  const screen = new DOMMatrix().scale(dpr, dpr).multiply(viewMatrix()); // page px → device px

  // Backdrop: the page under the photo (or nothing over the checkerboard).
  if (inContext.value) {
    ctx.setTransform(screen);
    if (showPage.value) {
      ctx.fillStyle = page?.backgroundColor || '#ffffff';
      ctx.fillRect(0, 0, AW, AH);
      if (backdrop) ctx.drawImage(backdrop, 0, 0, AW, AH);
    }
  }

  // The masked photo, in page coordinates, clipped exactly as the page clips
  // it — so the user never paints where the page would hide the result.
  ctx.save();
  if (clip) {
    ctx.setTransform(clip.space === 'page' ? screen : screen.multiply(P));
    ctx.clip(clip.path);
  }
  ctx.setTransform(screen.multiply(P));
  ctx.globalAlpha = pi ? pi.opacity ?? 1 : 1;
  ctx.drawImage(composed, 0, 0);
  ctx.restore();

  // Thin outline of the photo's full extent (erased parts stay locatable).
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const vm = viewMatrix().multiply(P);
  const c = [[0, 0], [W, 0], [W, H], [0, H]].map(([x, y]) => vm.transformPoint(new DOMPoint(x, y)));
  ctx.beginPath(); c.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y))); ctx.closePath();
  ctx.setLineDash([4, 4]); ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.stroke(); ctx.setLineDash([]);

  // Brush cursor: outer ring = diameter, inner ring = hard core.
  if (cursor && !panMode.value && !panning) {
    const R = brushSize.value / 2;
    const ring = (rad: number, dash: number[]) => {
      ctx.setLineDash(dash);
      ctx.beginPath(); ctx.arc(cursor!.x, cursor!.y, rad, 0, Math.PI * 2);
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.stroke();
      ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(255,255,255,0.95)'; ctx.stroke();
    };
    ring(R, []);
    const hard = brushHardness.value / 100;
    if (hard > 0.02 && hard < 0.98 && R * hard > 2) ring(R * hard, [3, 3]);
    ctx.setLineDash([]);
  }
}

/**
 * Stamp one brush dab onto the stroke layer (photo px). Hardness = radius of
 * the fully-opaque core; outside it alpha falls off as (1 − t)² to 0 at the rim
 * — a Gaussian-like tail that keeps a soft brush feathered ACROSS a stroke
 * even though overlapping dabs accumulate (smoothstep/linear saturate to a
 * hard-looking edge: measured feather ≈ 40% of r vs ≈ 73% with (1 − t)²).
 * ≥99.5% is a solid antialiased disc: a radial gradient with r0 == r1 paints
 * NOTHING per the canvas spec (why the old code capped hardness at 95%).
 */
function dab(x: number, y: number) {
  if (!stroke) return;
  const r = strokeR; const hard = strokeHard;
  const c = stroke.getContext('2d')!;
  if (hard >= 0.995) {
    c.fillStyle = '#fff';
  } else {
    const g = c.createRadialGradient(x, y, r * hard, x, y, r);
    for (let i = 0; i <= 8; i++) {
      const t = i / 8;
      g.addColorStop(t, `rgba(255,255,255,${((1 - t) * (1 - t)).toFixed(4)})`);
    }
    c.fillStyle = g;
  }
  c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill();
  const b = { x0: x - r - 1, y0: y - r - 1, x1: x + r + 1, y1: y + r + 1 };
  strokeBox = unionBox(strokeBox, b);
  markCompose(b);
}

function localPoint(e: PointerEvent | WheelEvent): { x: number; y: number } {
  const rect = view.value!.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

// ---- Undo / redo: dirty-rectangle snapshots of the mask ----------------------
function snapshot(b: Box): MaskEdit | null {
  const r = clampBox(b);
  if (!r || !mask) return null;
  return { x: r.x, y: r.y, data: mask.getContext('2d')!.getImageData(r.x, r.y, r.w, r.h) };
}
function syncUndoFlags() { canUndo.value = undoStack.length > 0; canRedo.value = redoStack.length > 0; }
/** Enforce depth (undo) and the total byte budget (both stacks, oldest first). */
function trimHistory() {
  while (undoStack.length > UNDO_DEPTH) undoStack.shift();
  const bytes = (s: MaskEdit[]) => s.reduce((n, e) => n + e.data.data.byteLength, 0);
  let total = bytes(undoStack) + bytes(redoStack);
  while (total > UNDO_MAX_BYTES && undoStack.length + redoStack.length > 1) {
    const dropped = undoStack.length ? undoStack.shift()! : redoStack.shift()!;
    total -= dropped.data.data.byteLength;
  }
}
/** Record the mask region `b` BEFORE it changes (clears redo). */
function pushUndo(b: Box) {
  const s = snapshot(b);
  if (!s) return;
  undoStack.push(s);
  redoStack.length = 0;
  trimHistory();
  syncUndoFlags();
}
/** Pop from one stack, store the current pixels of that region on the other. */
function swapEdit(from: MaskEdit[], to: MaskEdit[]) {
  if (!mask || drawing) return;
  const e = from.pop();
  if (!e) return;
  const b = { x0: e.x, y0: e.y, x1: e.x + e.data.width, y1: e.y + e.data.height };
  const cur = snapshot(b);
  if (cur) to.push(cur);
  mask.getContext('2d')!.putImageData(e.data, e.x, e.y);
  edited.value = true;
  markCompose(b);
  trimHistory();
  syncUndoFlags();
}
function undo() { swapEdit(undoStack, redoStack); }
function redo() { swapEdit(redoStack, undoStack); }

// ---- Pointer ----------------------------------------------------------------
function onPointerDown(e: PointerEvent) {
  if (loading.value || aiBusy.value) return;
  // A second finger/pen while a stroke or pan is running is ignored (it used to
  // reset the stroke box and leave ghost dabs that were committed later).
  if (drawing || panning) return;
  activePointer = e.pointerId;
  view.value!.setPointerCapture(e.pointerId);
  const s = localPoint(e);
  cursor = s;
  if (panMode.value || e.button === 1) { panning = true; lastX = s.x; lastY = s.y; requestPaint(); return; }
  if (e.button !== 0 || !stroke) { activePointer = null; return; }
  drawing = true;
  strokeErase = isErase.value;
  strokeAlpha = brushOpacity.value / 100;
  strokeHard = Math.max(0, Math.min(1, brushHardness.value / 100));
  strokeR = brushRadiusPhoto();
  strokeBox = null;
  // A single click still stamps one dab.
  const p = screenToPhoto(s.x, s.y);
  dab(p.x, p.y); lastX = p.x; lastY = p.y;
  requestPaint();
}

function onPointerMove(e: PointerEvent) {
  if (activePointer !== null && e.pointerId !== activePointer) return;
  const s = localPoint(e);
  cursor = s;
  if (panning) { ox += s.x - lastX; oy += s.y - lastY; lastX = s.x; lastY = s.y; requestPaint(); return; }
  if (!drawing) { requestPaint(); return; }
  // Coalesced events = every hardware sample, not one per frame (accuracy).
  const evs = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
  const rect = view.value!.getBoundingClientRect();
  const samples = evs.length ? evs.map((c) => ({ x: c.clientX - rect.left, y: c.clientY - rect.top })) : [s];
  // Dab spacing: 12% of the radius for hard brushes (scallop-free crisp edge),
  // up to 30% for soft ones (less overlap ⇒ the feather stays wide). The
  // remainder carries over to the next sample so spacing stays uniform.
  const step = Math.max(0.35, strokeR * (0.12 + 0.18 * (1 - strokeHard)));
  for (const q of samples) {
    const p = screenToPhoto(q.x, q.y);
    const dx = p.x - lastX; const dy = p.y - lastY;
    const dist = Math.hypot(dx, dy);
    if (dist < step) continue;
    const n = Math.floor(dist / step);
    for (let i = 1; i <= n; i++) dab(lastX + (dx * i * step) / dist, lastY + (dy * i * step) / dist);
    lastX += (dx * n * step) / dist; lastY += (dy * n * step) / dist;
  }
  requestPaint();
}

/** Commit the stroke ONCE at the brush opacity — repeated strokes accumulate. */
function endStroke() {
  if (panning) { panning = false; requestPaint(); return; }
  if (!drawing || !mask || !stroke) return;
  const r = strokeBox ? clampBox(strokeBox) : null;
  if (r) {
    const b = { x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h };
    pushUndo(b);
    const mc = mask.getContext('2d')!;
    mc.save();
    mc.globalAlpha = strokeAlpha;
    mc.globalCompositeOperation = strokeErase ? 'destination-out' : 'source-over';
    mc.drawImage(stroke, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h); // both ops are bounded
    mc.restore();
    stroke.getContext('2d')!.clearRect(r.x, r.y, r.w, r.h);
    markCompose(b);
    edited.value = true;
  }
  drawing = false; // before the recompose, so the stroke isn't applied twice
  strokeBox = null;
  requestPaint();
}
function onPointerUp(e: PointerEvent) {
  if (activePointer !== null && e.pointerId !== activePointer) return;
  endStroke();
  activePointer = null;
  if (view.value?.hasPointerCapture(e.pointerId)) view.value.releasePointerCapture(e.pointerId);
}
/** pointercancel (OS gesture, palm rejection…): DISCARD the in-progress stroke. */
function onPointerCancel(e: PointerEvent) {
  if (activePointer !== null && e.pointerId !== activePointer) return;
  if (drawing && stroke) {
    const r = strokeBox ? clampBox(strokeBox) : null;
    if (r) {
      stroke.getContext('2d')!.clearRect(r.x, r.y, r.w, r.h);
      markCompose({ x0: r.x, y0: r.y, x1: r.x + r.w, y1: r.y + r.h });
    }
    drawing = false; strokeBox = null;
  }
  panning = false;
  activePointer = null;
  requestPaint();
}
/** Capture lost without an up (e.g. element hidden): commit, like an up. */
function onLostCapture(e: PointerEvent) {
  if (activePointer !== null && e.pointerId !== activePointer) return;
  endStroke();
  activePointer = null;
}
/** Leaving only hides the ring; a captured stroke keeps going (and ends on up). */
function onPointerLeave() { if (!drawing && !panning) { cursor = null; requestPaint(); } }

function onWheel(e: WheelEvent) {
  e.preventDefault();
  const m = localPoint(e);
  // Smooth exponential zoom (trackpads send small deltas, mice ~100).
  const k = Math.exp(-Math.max(-300, Math.min(300, e.deltaY)) * 0.0015);
  // Clamp the TOTAL screen-px-per-photo-px to a sane range.
  const nz = Math.min(32 / placeScale, Math.max(0.01 / placeScale, zoom * k));
  // Zoom about the cursor: the page point under it stays put.
  ox = m.x - ((m.x - ox) / zoom) * nz;
  oy = m.y - ((m.y - oy) / zoom) * nz;
  zoom = nz;
  cursor = m;
  requestPaint();
}

// ---- Whole-mask operations ----------------------------------------------------
/** One-click AI background removal (client-side model). Sets the whole mask. */
async function removeBackgroundAI() {
  if (!src || !mask || aiBusy.value) return;
  aiBusy.value = true;
  try {
    const { removeBackground } = await import('@imgly/background-removal');
    const blob: Blob = await new Promise((res) => src!.toBlob((b) => res(b!), 'image/png'));
    const out = await removeBackground(blob);
    const url = URL.createObjectURL(out);
    const img = await loadImg(url);
    URL.revokeObjectURL(url);
    pushUndo(FULL());
    const mc = mask.getContext('2d')!;
    mc.clearRect(0, 0, W, H);
    mc.drawImage(img, 0, 0, W, H);
    // Keep only the alpha: flood the kept region white.
    mc.globalCompositeOperation = 'source-in';
    mc.fillStyle = '#fff'; mc.fillRect(0, 0, W, H);
    mc.globalCompositeOperation = 'source-over';
    edited.value = true;
    markCompose(FULL());
    app.toast('Background removed — refine with Erase/Restore.', 'success');
  } catch {
    app.toast('Background removal failed (the model downloads on first use — check your connection).', 'error');
  } finally {
    aiBusy.value = false;
  }
}

/** Restore everything (undoable inside the studio). */
function resetMask() {
  if (!mask || drawing) return;
  pushUndo(FULL());
  const mc = mask.getContext('2d')!;
  mc.clearRect(0, 0, W, H);
  mc.fillStyle = '#fff'; mc.fillRect(0, 0, W, H);
  edited.value = true;
  markCompose(FULL());
}

// ---- Output -------------------------------------------------------------------
/** Full-res RAW photo × mask as a PNG data URL (sticker output). */
function resultDataUrl(): string {
  const out = makeCanvas(W, H);
  const oc = out.getContext('2d')!;
  oc.drawImage(src!, 0, 0);
  oc.globalCompositeOperation = 'destination-in';
  oc.drawImage(mask!, 0, 0);
  return out.toDataURL('image/png');
}

/** True when nothing is erased (every alpha = 255) — early-exit scan. */
function isFullyOpaque(c: HTMLCanvasElement): boolean {
  const d = c.getContext('2d')!.getImageData(0, 0, c.width, c.height).data;
  for (let i = 3; i < d.length; i += 4) if (d[i] < 255) return false;
  return true;
}

/**
 * Save ONLY the mask (long side ≤ MASK_MAX) and point the page image at it via
 * a history command. A fully opaque mask clears `eraseMask` instead of saving.
 */
async function applyMask() {
  if (!pi || !project.meta || !mask || saving.value || drawing) return;
  // Nothing changed → just close: no new file, no history entry.
  if (!edited.value) { emit('close'); return; }
  saving.value = true;
  try {
    // W×H is already ≤ MASK_MAX → save the mask itself, 1:1 (no resampling).
    let out = mask;
    if (Math.max(W, H) > MASK_MAX) {
      const k = MASK_MAX / Math.max(W, H);
      out = makeCanvas(Math.max(1, Math.round(W * k)), Math.max(1, Math.round(H * k)));
      const oc = out.getContext('2d')!;
      oc.imageSmoothingQuality = 'high';
      oc.drawImage(mask, 0, 0, out.width, out.height);
    }
    const next = isFullyOpaque(out)
      ? undefined
      : (await window.pebble.saveEraseMask(project.meta.sourceFolder, pi.id, out.toDataURL('image/png'))).relativePath;
    if (next !== pi.eraseMask) editor.setEraseMask(pi, next, next ? 'Erase / restore photo' : 'Clear erasing');
    edited.value = false;
    app.toast(next ? 'Erasing applied — reopen anytime to restore.' : 'Nothing erased — photo shown in full.', 'success');
    emit('close');
  } catch {
    app.toast('Could not save the erase mask.', 'error');
  } finally {
    saving.value = false;
  }
}

/** Save to the global My Stickers library (reusable in every project). */
async function saveAsSticker() {
  try {
    const base = (pi?.filename ?? props.filename).replace(/\.[^.]+$/, '').split('/').pop() || 'sticker';
    const s = await window.pebble.saveSticker(resultDataUrl(), stickerName.value || base);
    app.toast(`Saved to My Stickers as "${s.name}".`, 'success');
  } catch {
    app.toast('Could not save the sticker.', 'error');
  }
}

function requestClose() {
  // eslint-disable-next-line no-alert
  if (edited.value && inContext.value && !window.confirm('Discard your unapplied erase/restore changes?')) return;
  emit('close');
}

function setBrushSize(v: number) { brushSize.value = Math.round(Math.min(500, Math.max(4, v))); requestPaint(); }

/** Only TEXT entry swallows shortcuts — sliders/checkboxes/buttons must not
 *  (after dragging a slider the range input keeps focus). */
const NON_TEXT_INPUTS = new Set(['range', 'checkbox', 'radio', 'button', 'submit', 'reset', 'color', 'file', 'image']);
function isTyping(t: EventTarget | null): t is HTMLElement {
  if (!(t instanceof HTMLElement)) return false;
  if (t.isContentEditable || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
  return t instanceof HTMLInputElement && !NON_TEXT_INPUTS.has(t.type);
}

function onKey(e: KeyboardEvent) {
  const t = e.target;
  if (isTyping(t)) {
    if (e.key === 'Escape') t.blur();
    return;
  }
  const meta = e.metaKey || e.ctrlKey;
  const k = e.key.toLowerCase();
  if (e.key === 'Escape') { e.preventDefault(); requestClose(); }
  else if (meta && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); }
  else if (meta && k === 'y') { e.preventDefault(); redo(); }
  else if (meta) return;
  else if (e.key === ' ') {
    // Space pans — it must not toggle a focused checkbox / press a button.
    e.preventDefault();
    if (t instanceof HTMLElement && t !== document.body) t.blur();
    if (!spaceHeld.value) { spaceHeld.value = true; requestPaint(); }
  }
  else if (e.key === '[') { e.preventDefault(); setBrushSize(brushSize.value / 1.15); }
  else if (e.key === ']') { e.preventDefault(); setBrushSize(brushSize.value * 1.15); }
  else if (k === 'e') { tool.value = 'erase'; requestPaint(); }
  else if (k === 'r') { tool.value = 'restore'; requestPaint(); }
}
function onKeyUp(e: KeyboardEvent) {
  if (e.key === ' ' && !isTyping(e.target)) { e.preventDefault(); spaceHeld.value = false; requestPaint(); }
}
function onResize() { requestPaint(); }

onMounted(() => {
  void loadAll();
  raf = requestAnimationFrame(paint);
  window.addEventListener('keydown', onKey);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('resize', onResize);
});
onBeforeUnmount(() => {
  cancelAnimationFrame(raf);
  window.removeEventListener('keydown', onKey);
  window.removeEventListener('keyup', onKeyUp);
  window.removeEventListener('resize', onResize);
});
</script>

<template>
  <div class="fixed inset-0 z-[90] bg-black/80 flex">
    <!-- Canvas area: the page under the photo, or a checkerboard -->
    <div ref="host" :class="['relative flex-1 overflow-hidden', inContext && showPage ? 'bg-[#16161c]' : 'pa-checker']">
      <canvas ref="view" class="absolute inset-0 w-full h-full touch-none"
              :style="{ cursor: panMode ? (panning ? 'grabbing' : 'grab') : 'none' }"
              @pointerdown="onPointerDown" @pointermove="onPointerMove" @pointerup="onPointerUp"
              @pointercancel="onPointerCancel" @lostpointercapture="onLostCapture" @pointerleave="onPointerLeave"
              @wheel="onWheel" @contextmenu.prevent />
      <div v-if="loading" class="absolute inset-0 flex items-center justify-center text-white/80">Loading photo…</div>
      <div v-if="aiBusy" class="absolute inset-0 flex items-center justify-center bg-black/50 text-white text-sm">
        ✨ Removing background… (first run downloads the model)
      </div>
    </div>

    <!-- Tool rail -->
    <div class="w-72 shrink-0 bg-pebble-surface border-l border-pebble-border flex flex-col">
      <div class="px-3 py-2.5 border-b border-pebble-border flex items-center justify-between">
        <div>
          <div class="text-sm font-medium">{{ inContext ? '✎ Erase / restore' : '✂ Cutout studio' }}</div>
          <div class="text-2xs text-pebble-text-dim truncate max-w-[180px]">{{ filename }}</div>
        </div>
        <button class="h-7 px-2 rounded bg-pebble-surface-2 border border-pebble-border text-xs hover:border-pebble-accent" @click="requestClose">✕</button>
      </div>

      <div class="flex-1 overflow-auto p-3 space-y-3 text-sm">
        <AppButton size="sm" block :disabled="aiBusy || loading" @click="removeBackgroundAI">✨ Remove background (AI)</AppButton>

        <div>
          <div class="text-xs text-pebble-text-dim mb-1">Brush</div>
          <div class="flex rounded bg-pebble-bg p-0.5 text-2xs">
            <button v-for="t in (['erase','restore','pan'] as const)" :key="t" @click="tool = t"
                    :class="['flex-1 py-1 rounded capitalize', tool === t ? 'bg-pebble-accent text-white' : 'text-pebble-text-dim']">
              {{ t === 'erase' ? '⌫ Erase' : t === 'restore' ? '↺ Restore' : '✋ Pan' }}
            </button>
          </div>
        </div>

        <AppSlider label="Size" :min="4" :max="500" :model-value="brushSize" unit="px" @update:model-value="setBrushSize" />
        <AppSlider label="Opacity" :min="1" :max="100" v-model="brushOpacity" unit="%" />
        <AppSlider label="Hardness" :min="0" :max="100" v-model="brushHardness" unit="%" />
        <p class="text-2xs text-pebble-text-dim leading-relaxed">
          Low opacity + soft hardness, then brush the edges/corners in passes —
          each pass fades a little more, blending the photo into the page.
          100% opacity erases outright; Restore paints the photo back.
          <b>[ ]</b> size · <b>E</b>/<b>R</b> erase/restore · hold <b>Space</b> to pan · scroll to zoom.
        </p>

        <div class="flex gap-2">
          <button v-for="b in ([{ id: 'undo', on: canUndo, label: '↶ Undo', act: undo }, { id: 'redo', on: canRedo, label: '↷ Redo', act: redo }])" :key="b.id"
                  :disabled="!b.on" @click="b.act()"
                  :class="['flex-1 py-1.5 rounded-lg text-xs font-medium border transition',
                           b.on ? 'bg-pebble-surface-2 border-pebble-accent/70 text-pebble-text hover:bg-pebble-accent/15'
                                : 'bg-transparent border-pebble-border/50 text-pebble-text-dim/50 cursor-not-allowed']">
            {{ b.label }}
          </button>
        </div>
        <div class="flex gap-2">
          <AppButton size="sm" variant="ghost" block :disabled="loading" @click="resetMask">Reset (restore everything)</AppButton>
        </div>
        <div class="flex items-center justify-between gap-2">
          <label v-if="inContext" class="flex items-center gap-1.5 text-xs">
            <input type="checkbox" v-model="showPage" @change="requestPaint()" /> Show page
          </label>
          <button class="ml-auto h-7 px-2 rounded bg-pebble-surface-2 border border-pebble-border text-xs hover:border-pebble-accent" @click="fitView">⤢ Fit view</button>
        </div>

        <div class="pt-2 border-t border-pebble-border space-y-2">
          <AppButton v-if="inContext" size="sm" block :disabled="saving || loading" @click="applyMask">✓ Apply</AppButton>
          <p v-if="inContext" class="text-2xs text-pebble-text-dim -mt-1">Non-destructive: the original photo is kept, so you can reopen and restore anytime.</p>
          <label class="text-xs block">Sticker name
            <input v-model="stickerName" class="pa-input w-full mt-1 py-1" placeholder="my sticker" />
          </label>
          <AppButton size="sm" variant="secondary" block :disabled="loading" @click="saveAsSticker">☆ Save as sticker</AppButton>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.pa-checker {
  background-color: #202028;
  background-image:
    linear-gradient(45deg, #2e2e3a 25%, transparent 25%, transparent 75%, #2e2e3a 75%),
    linear-gradient(45deg, #2e2e3a 25%, transparent 25%, transparent 75%, #2e2e3a 75%);
  background-size: 24px 24px;
  background-position: 0 0, 12px 12px;
}
</style>
