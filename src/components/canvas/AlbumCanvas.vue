<script setup lang="ts">
/**
 * AlbumCanvas.vue
 * -----------------------------------------------------------------------------
 * Interactive Fabric.js canvas for the active page.
 *
 * Performance model (important):
 *  - The page is rendered ONCE per page change / structural edit
 *    (`editor.canvasRevision`). Moving, scaling or rotating an object does NOT
 *    trigger a full rebuild — Fabric updates the object live and we just write
 *    the new geometry back into the model. This is what removed the multi-second
 *    lag on every drag.
 *  - Images are displayed from a cached medium (≤1600px) thumbnail, not the
 *    multi-megabyte original, so rendering is fast. Full-resolution images are
 *    only used by the exporter.
 *
 * Also supports drag-and-drop: drop an image from the Image Bin anywhere on the
 * page to add it as a free-floating, fully-movable photo for the user to place.
 */
import { ref, onMounted, onBeforeUnmount, watch, computed } from 'vue';
import { Canvas, FabricImage, Rect, Textbox } from 'fabric';
import { v4 as uuid } from 'uuid';
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { useHistoryStore } from '@/stores/historyStore';
import {
  buildImageObject, buildBorderRect, buildBorderFrameImage, buildTextObject, buildBackgroundDataUrl, buildStickerObjectAsync,
  buildSvgOverlayObjects, buildSvgBackgroundObjects, buildThemeBackground, buildPageBackgroundDataUrl, computeImagePlacement,
  buildVignetteOverlay, applyEffects, applyFiltersSafe, displayRectOf, loadEraseMask,
} from '@/engine/pageRenderer';
import { defaultEffects } from '@/engine/collageComposer';
import { buildMaskPath } from '@/engine/maskShapes';
import { loadImageDataUrl } from '@/engine/imageLoader';
import { movePayloadFromDrop, carriedAppearance, applyCarriedAppearance, type CarriedAppearance } from '@/engine/dragMove';
import type { PageImage } from '@shared/pebble.types';
import type { FabricObject } from 'fabric';

const project = useProjectStore();
const editor = useEditorStore();
const history = useHistoryStore();

/** Live Fabric objects per image id — lets us update edits IN PLACE (no rebuild
 *  ⇒ no flicker, no async races, selection preserved). */
type ObjRefs = { img: FabricImage; border: FabricObject | null; handle: FabricObject | null; frame: FabricObject | null; vignette: FabricObject | null };
const objMap = new Map<string, ObjRefs>();

const wrap = ref<HTMLDivElement | null>(null);
const el = ref<HTMLCanvasElement | null>(null);
let canvas: Canvas | null = null;
const loadingCount = ref(0);

const page = computed(() => project.pages[editor.activePageIndex]);

/** Display loader: medium base64 thumbnail via the shared cache. */
async function loadDisplayImage(filename: string): Promise<string> {
  return loadImageDataUrl(project.meta?.sourceFolder ?? '', filename, 1600);
}

/** Fit factor so the album fills the viewport, then apply user zoom on top. */
function fitScale(): number {
  if (!wrap.value || !project.meta) return 1;
  const pad = 64;
  const sx = (wrap.value.clientWidth - pad) / project.meta.albumWidth;
  const sy = (wrap.value.clientHeight - pad) / project.meta.albumHeight;
  return Math.max(0.02, Math.min(sx, sy));
}

let renderToken = 0;
/** While true, programmatic selection changes during a rebuild are ignored so a
 *  re-render does NOT reset the store selection (which used to bounce the right
 *  panel back to the bin when editing). */
let suppressSel = false;
/**
 * Rebuild the canvas WITHOUT flicker: every object (backgrounds, photos,
 * borders, frames, stickers, text) is built OFF-canvas first, then swapped in
 * with a single synchronous clear + add + paint. The old content stays visible
 * for the whole async build, so a rebuild never flashes a blank page (the old
 * code cleared first and added objects as their images loaded).
 */
async function render() {
  if (!canvas || !page.value || !project.meta || !project.theme) return;
  const myToken = ++renderToken; // guard against overlapping async renders
  const keepId = editor.selectedObjectId; // preserve selection across rebuild
  loadingCount.value += 1;
  const stale = () => myToken !== renderToken;
  const done = () => { loadingCount.value -= 1; };

  const objs: FabricObject[] = [];
  const newMap = new Map<string, ObjRefs>();
  const bgColor = page.value.backgroundColor || project.theme.colors.background;

  // Page background: per-page gradient/texture overrides the theme background.
  {
    const pageBg = buildPageBackgroundDataUrl(page.value, project.meta, project.theme)
      || (!page.value.backgroundColor ? buildThemeBackground(project.meta, project.theme) : null);
    if (pageBg) {
      const tImg = await FabricImage.fromURL(pageBg);
      if (stale()) return done();
      tImg.set({ left: 0, top: 0, scaleX: project.meta.albumWidth / (tImg.width || 1), scaleY: project.meta.albumHeight / (tImg.height || 1), selectable: false, evented: false });
      objs.push(tImg);
    }
  }

  // Procedural decoration background (themes' page decorations).
  const bg = buildBackgroundDataUrl(page.value, project.meta, project.theme);
  if (bg) {
    const bgImg = await FabricImage.fromURL(bg);
    if (stale()) return done();
    bgImg.set({
      left: 0, top: 0,
      scaleX: project.meta.albumWidth / (bgImg.width || 1),
      scaleY: project.meta.albumHeight / (bgImg.height || 1),
      selectable: false, evented: false,
    });
    objs.push(bgImg);
  }
  // ALL decoration art (washes + corners/frames/scallop borders) renders BEHIND
  // the photos so patterns never cover the images. Only stickers go in front.
  for (const wb of await buildSvgBackgroundObjects(page.value, project.meta, project.theme)) {
    if (stale()) return done();
    objs.push(wb);
  }
  for (const ov of await buildSvgOverlayObjects(page.value, project.meta, project.theme)) {
    if (stale()) return done();
    objs.push(ov);
  }

  const ordered = [...page.value.images].sort((a, b) => a.zIndex - b.zIndex);
  for (const pi of ordered) {
    if (!pi.visible) continue;
    const inCrop = editor.cropImageId === pi.id;
    const framed = !!pi.slotRect && !pi.free;
    try {
      // eslint-disable-next-line no-await-in-loop
      const url = await loadDisplayImage(pi.filename);
      if (stale()) return done();
      // Non-destructive erase mask: the RAW PNG (alpha = keep), never the JPEG
      // thumbnail pipeline. Missing/unreadable → null → plain photo (no placeholder).
      // eslint-disable-next-line no-await-in-loop
      const maskUrl = await loadEraseMask(project.meta.sourceFolder, pi.eraseMask);
      if (stale()) return done();
      // eslint-disable-next-line no-await-in-loop
      const obj = await buildImageObject(pi, url, maskUrl);
      // Borders / decorative frames / vignette hug the photo's VISIBLE bounds.
      const chromeRect = displayRectOf(pi, obj.width || 1, obj.height || 1);
      let border: FabricObject | null = null;
      let handle: FabricObject | null = null;
      let frame: FabricObject | null = null;
      let vignette: FabricObject | null = null;
      const pushVignette = () => { vignette = buildVignetteOverlay(pi, chromeRect); if (vignette) objs.push(vignette); };
      // Decorative SVG border frame (drawn above the photo, below the handle).
      const buildFrame = async () => {
        const fImg = await buildBorderFrameImage(pi, chromeRect);
        if (stale()) return false;
        if (fImg) { objs.push(fImg); frame = fImg; }
        return true;
      };
      if (framed && !inCrop) {
        // The photo is non-interactive; a transparent frame handle on top is what
        // the user selects / moves / resizes (the "cell").
        obj.set({ selectable: false, evented: false });
        objs.push(obj);
        pushVignette();
        border = buildBorderRect(pi, chromeRect);
        if (border) objs.push(border);
        // eslint-disable-next-line no-await-in-loop
        if (!(await buildFrame())) return done();
        const fr = pi.slotRect!;
        handle = new Rect({
          left: fr.x, top: fr.y, width: fr.width, height: fr.height,
          fill: 'rgba(0,0,0,0.001)', stroke: 'transparent',
          selectable: !page.value.locked, hasControls: !page.value.locked, objectCaching: false,
        });
        (handle as unknown as { pebbleId: string; pebbleType: string }).pebbleId = pi.id;
        (handle as unknown as { pebbleType: string }).pebbleType = 'frame';
        objs.push(handle);
      } else {
        // Free photo, or framed photo in crop mode → photo is directly editable.
        obj.set({ selectable: !page.value.locked, hasControls: !page.value.locked });
        if (inCrop) obj.set({ borderColor: '#6C63FF', cornerColor: '#6C63FF' });
        objs.push(obj);
        if (!inCrop) {
          pushVignette();
          border = buildBorderRect(pi, chromeRect);
          if (border) objs.push(border);
          // eslint-disable-next-line no-await-in-loop
          if (!(await buildFrame())) return done();
        }
        // In crop/adjust mode, draw the cell boundary on TOP so the user can see
        // exactly what will show, while the photo pans/zooms underneath it.
        if (inCrop && pi.slotRect) {
          const r = pi.slotRect;
          const outline = new Rect({
            left: r.x, top: r.y, width: r.width, height: r.height,
            fill: 'transparent', stroke: '#6C63FF', strokeWidth: 2, strokeDashArray: [10, 7],
            rx: pi.border?.radius ?? 0, ry: pi.border?.radius ?? 0,
            selectable: false, evented: false,
          });
          objs.push(outline);
        }
      }
      newMap.set(pi.id, { img: obj, border, handle, frame, vignette });
    } catch {
      objs.push(...buildMissingPlaceholder(pi));
    }
  }

  // Sticker / object decorations (emoji glyphs + SVG art) — the ONLY decorations
  // in front. SVG stickers load asynchronously, so guard against a stale render.
  for (const d of page.value.decorations) {
    if (d.visible && d.type === 'sticker') {
      // eslint-disable-next-line no-await-in-loop
      const s = await buildStickerObjectAsync(d);
      if (stale()) return done();
      s.set({ selectable: !page.value.locked });
      objs.push(s);
    }
  }

  // Text blocks (incl. proverbs) — selectable + movable + rotatable.
  for (const tb of page.value.textBlocks) {
    if (!tb.visible) continue;
    const t = buildTextObject(tb);
    t.set({ selectable: !page.value.locked && !tb.locked, hasControls: !page.value.locked && !tb.locked });
    objs.push(t);
  }
  // Legacy single proverb (older projects) — only when it hasn't been migrated to
  // a text block. New proverbs are added as movable text blocks (see ProverbPanel).
  const hasProverbBlock = page.value.textBlocks.some((t) => t.type === 'proverb' && t.visible);
  if (page.value.proverb && !hasProverbBlock && project.theme) {
    const t = buildTextObject({
      id: `${page.value.id}-prov`, content: page.value.proverb, type: 'proverb',
      position: { x: project.meta.albumWidth * 0.1, y: project.meta.albumHeight * 0.86, width: project.meta.albumWidth * 0.8, height: 80, rotation: 0 },
      style: {
        fontFamily: project.theme.fonts.display, fontSize: Math.round(project.meta.albumHeight * 0.03),
        fontWeight: 'normal', fontStyle: 'italic', color: project.theme.colors.text, align: 'center',
        letterSpacing: 0, lineHeight: 1.3, textTransform: 'none', opacity: 0.9,
      },
      zIndex: 200, visible: true, locked: false,
    });
    t.set({ selectable: false });
    objs.push(t);
  }

  if (stale()) return done();
  // --- Synchronous swap: old page stays on screen until this exact moment. ---
  suppressSel = true;
  canvas.clear();
  canvas.backgroundColor = bgColor;
  for (const o of objs) canvas.add(o);
  objMap.clear();
  for (const [k, v] of newMap) objMap.set(k, v);
  applyZoom();
  // Re-apply the previous selection so editing (which rebuilds the canvas) keeps
  // the same object selected and the properties panel stays open.
  if (keepId) {
    const o = fabricById(keepId) as unknown as object | undefined;
    if (o) canvas.setActiveObject(o as never);
  }
  canvas.renderAll();
  suppressSel = false;
  done();
}

function buildMissingPlaceholder(pi: PageImage): FabricObject[] {
  const r = new Rect({ left: pi.position.x, top: pi.position.y, width: pi.position.width, height: pi.position.height, fill: '#2a2a3e', stroke: '#ff5577', strokeDashArray: [8, 6], selectable: false });
  const label = new Textbox(`Missing: ${pi.filename}`, { left: pi.position.x + 10, top: pi.position.y + 10, width: pi.position.width - 20, fontSize: 18, fill: '#ff8899' });
  return [r, label];
}

function applyZoom() {
  if (!canvas || !project.meta) return;
  const z = fitScale() * editor.zoom;
  canvas.setZoom(z);
  canvas.setDimensions({ width: project.meta.albumWidth * z, height: project.meta.albumHeight * z });
}

/** Find the live Fabric object for a model id (for surgical undo/redo). */
function fabricById(id: string): { left: number; top: number; scaleX: number; scaleY: number; angle: number; set: (o: object) => void } | undefined {
  return canvas?.getObjects().find((o) => (o as unknown as { pebbleId?: string }).pebbleId === id) as never;
}

/**
 * Swap an image's vignette overlay for a freshly built one (the radial gradient
 * is sized in pixels, so geometry/amount changes rebuild it rather than
 * stretching). Keeps it stacked directly above its photo. Synchronous + cheap.
 */
function refreshVignette(refs: ObjRefs, pi: PageImage, rect?: { x: number; y: number; width: number; height: number }) {
  if (!canvas) return;
  const chromeRect = rect ?? displayRectOf(pi, (refs.img.width as number) || 1, (refs.img.height as number) || 1);
  const fresh = buildVignetteOverlay(pi, chromeRect);
  if (refs.vignette) canvas.remove(refs.vignette as never);
  if (fresh) {
    const idx = canvas.getObjects().indexOf(refs.img as never);
    canvas.insertAt(idx + 1, fresh as never);
  }
  refs.vignette = fresh;
}

/**
 * Re-render ONE image's geometry from the model directly onto its live Fabric
 * objects — NO canvas rebuild, so there is no flicker and no async race. This is
 * the heart of smooth editing: the model is the source of truth, and this maps
 * it onto the photo, its clip, border and frame handle in place.
 */
function updateLive(id: string) {
  const refs = objMap.get(id);
  const found = project.findImage(id);
  if (!refs || !found) { editor.requestRender(); return; } // not on canvas → full rebuild
  const pi = found.image;
  // Polygon (diagonal) clips can't be cheaply repositioned; rebuild those.
  if (pi.clipPolygon) { editor.requestRender(); return; }
  const img = refs.img as unknown as { width: number; height: number; set: (o: object) => void; clipPath?: { set: (o: object) => void; dirty?: boolean }; setCoords: () => void; dirty?: boolean };
  const { scale, left, top } = computeImagePlacement(pi, img.width || 1, img.height || 1);
  // ⚠ Explicit flip flags + positive scale. Fabric v6 TOGGLES flipX/flipY on
  // every `set` of a negative scale, so the old `scaleX: -scale` form un-flipped
  // a flipped photo on every other in-place update (e.g. each opacity-slider tick).
  img.set({
    left, top, angle: pi.position.rotation, opacity: pi.opacity,
    scaleX: Math.abs(scale), scaleY: Math.abs(scale),
    flipX: !!pi.position.flipX, flipY: !!pi.position.flipY,
  });
  img.dirty = true; // invalidate Fabric's object cache so the change is painted
  // Borders / frames / vignette / masks all live on the photo's VISIBLE bounds.
  const chromeRect = displayRectOf(pi, img.width || 1, img.height || 1);
  if (pi.maskId) {
    // Shape masks regenerate at the new size (paths don't stretch well).
    (img as unknown as { clipPath?: unknown }).clipPath = buildMaskPath(pi.maskId, chromeRect);
  } else if (pi.slotRect && img.clipPath) {
    const r = pi.slotRect; const radius = pi.border?.radius ?? 0;
    img.clipPath.set({ left: r.x, top: r.y, width: r.width, height: r.height, rx: radius, ry: radius });
    img.clipPath.dirty = true;
  }
  refreshVignette(refs, pi, chromeRect);
  if (refs.border) {
    if (pi.maskId) {
      // Mask-outline borders are Paths — rebuild at the new size instead of
      // stretching (keeps dots/dashes crisp). Synchronous + cheap.
      const fresh = buildBorderRect(pi, chromeRect);
      canvas?.remove(refs.border as never);
      if (fresh) {
        const idx = canvas!.getObjects().indexOf(refs.img as never);
        canvas!.insertAt(idx + 1 + (refs.vignette ? 1 : 0), fresh as never);
      }
      refs.border = fresh;
    } else {
      (refs.border as unknown as { set: (o: object) => void; setCoords: () => void; dirty?: boolean }).set({
        left: chromeRect.x, top: chromeRect.y, width: chromeRect.width, height: chromeRect.height,
        angle: pi.slotRect ? 0 : pi.position.rotation,
      });
      (refs.border as unknown as { setCoords: () => void }).setCoords();
      (refs.border as unknown as { dirty?: boolean }).dirty = true;
    }
  }
  if (refs.handle && pi.slotRect) {
    const r = pi.slotRect;
    (refs.handle as unknown as { set: (o: object) => void; setCoords: () => void }).set({ left: r.x, top: r.y, width: r.width, height: r.height, scaleX: 1, scaleY: 1 });
    (refs.handle as unknown as { setCoords: () => void }).setCoords();
  }
  if (refs.frame) {
    // Decorative frame: reposition + scale to the photo box during live drag
    // (the motif may stretch transiently; commitTransform regenerates it crisp).
    const fo = refs.frame as unknown as { width: number; height: number; set: (o: object) => void; setCoords: () => void; dirty?: boolean };
    fo.set({
      left: chromeRect.x, top: chromeRect.y, angle: pi.slotRect ? 0 : pi.position.rotation,
      scaleX: chromeRect.width / (fo.width || 1), scaleY: chromeRect.height / (fo.height || 1),
    });
    fo.setCoords(); fo.dirty = true;
  }
  img.setCoords();
  // Render immediately (synchronous). requestRenderAll defers to the next rAF,
  // which (combined with object caching) is why slider changes only appeared
  // after a subsequent click — renderAll() paints them right away.
  canvas?.renderAll();
}

/**
 * Crop clamp (per axis):
 *  - If the photo COVERS the frame in that axis, keep the frame inside the photo
 *    (no gaps) — but allow the full pan range, so you CAN bring the photo's top,
 *    bottom, left or right edge to the matching frame edge. (This is the bug fix:
 *    the old centre-clamp stopped a tall/zoomed photo from panning far enough to
 *    reveal its top/bottom.)
 *  - If the photo is SMALLER than the frame (zoomed out), allow free positioning
 *    but keep it overlapping (centre stays within the frame), gaps are fine.
 */
function clampCrop(pos: { x: number; y: number; width: number; height: number }, frame: { x: number; y: number; width: number; height: number }) {
  if (pos.width >= frame.width) {
    pos.x = Math.min(frame.x, Math.max(frame.x + frame.width - pos.width, pos.x));
  } else {
    const cx = pos.x + pos.width / 2;
    const ncx = Math.min(frame.x + frame.width, Math.max(frame.x, cx));
    pos.x += ncx - cx;
  }
  if (pos.height >= frame.height) {
    pos.y = Math.min(frame.y, Math.max(frame.y + frame.height - pos.height, pos.y));
  } else {
    const cy = pos.y + pos.height / 2;
    const ncy = Math.min(frame.y + frame.height, Math.max(frame.y, cy));
    pos.y += ncy - cy;
  }
}

type Geom = { x: number; y: number; width: number; height: number; rotation: number };
function snapshotDeco(id: string): Geom | null {
  const d = page.value?.decorations.find((x) => x.id === id);
  return d ? { ...d.position } : null;
}

function recAspect(filename: string): { w: number; h: number } {
  const r = project.images.find((x) => x.relativePath === filename);
  return { w: r?.width ?? 1000, h: r?.height ?? 1000 };
}

/**
 * Persist a transform. Behaviour:
 *  - FRAME handle moved   → move the whole cell (photo + frame + diagonal clip)
 *  - FRAME handle resized → resize the cell; photo re-covers the new frame
 *  - PHOTO in crop mode, drag   → PAN the photo inside the fixed frame
 *  - PHOTO in crop mode, resize → ZOOM the photo inside the fixed frame
 *  - FREE photo / sticker → move/scale freely
 * Cover-clamped so a framed photo always fills its frame. Undo/redo supported.
 */
function commitTransform(target: { pebbleId?: string; pebbleType?: string; width?: number; height?: number }) {
  if (!target.pebbleId) return;
  const id = target.pebbleId;
  const type = target.pebbleType;
  const o = target as unknown as { left: number; top: number; scaleX: number; scaleY: number; angle: number; width: number; height: number };

  // Stickers / decorations.
  if (type === 'decoration' && page.value) {
    const deco = page.value.decorations.find((d) => d.id === id);
    if (!deco) return;
    const before = snapshotDeco(id)!;
    const after: Geom = { x: o.left, y: o.top, width: (o.width || before.width) * o.scaleX, height: (o.height || before.height) * o.scaleY, rotation: o.angle };
    const set = (g: Geom) => { Object.assign(deco.position, g); const fo = fabricById(id); if (fo) { fo.set({ left: g.x, top: g.y, angle: g.rotation }); canvas?.requestRenderAll(); } project.markDirty(); };
    history.run({ type: 'transform', description: 'Move sticker', execute: () => set(after), undo: () => set(before) });
    return;
  }

  // Text blocks (incl. proverbs): move / scale (→ font size) / rotate.
  if (type === 'text' && page.value) {
    const tb = page.value.textBlocks.find((t) => t.id === id);
    if (!tb) return;
    const sx = o.scaleX || 1; const sy = o.scaleY || 1;
    const before = { x: tb.position.x, y: tb.position.y, rotation: tb.position.rotation, width: tb.position.width, fontSize: tb.style.fontSize };
    const after = {
      x: o.left, y: o.top, rotation: o.angle,
      width: Math.max(20, (o.width || tb.position.width) * sx),
      fontSize: Math.max(6, Math.round(tb.style.fontSize * sy)),
    };
    const apply = (s: typeof before) => {
      tb.position.x = s.x; tb.position.y = s.y; tb.position.rotation = s.rotation;
      tb.position.width = s.width; tb.style.fontSize = s.fontSize;
      project.markDirty(); editor.requestRender();
    };
    history.run({ type: 'transform', description: 'Move text', execute: () => apply(after), undo: () => apply(before) });
    return;
  }

  const found = project.findImage(id);
  if (!found) return;
  const pi = found.image;
  const pos = pi.position;
  const frame = pi.slotRect;
  const poly = pi.clipPolygon;

  const before = { pos: { ...pos }, frame: frame ? { ...frame } : null, poly: poly ? poly.map((p) => ({ ...p })) : null, manual: pi.manual };

  if (type === 'frame' && frame) {
    // The handle's own size is the baseline (NOT the photo box) — otherwise a
    // pure move is misread as a resize because the photo is larger than the cell.
    const nw = (o.width || frame.width) * o.scaleX;
    const nh = (o.height || frame.height) * o.scaleY;
    const isResize = Math.abs(nw - frame.width) > 0.5 || Math.abs(nh - frame.height) > 0.5;
    if (isResize) {
      if (poly) { const sx = nw / frame.width; const sy = nh / frame.height; poly.forEach((p) => { p.x = o.left + (p.x - frame.x) * sx; p.y = o.top + (p.y - frame.y) * sy; }); }
      frame.x = o.left; frame.y = o.top; frame.width = nw; frame.height = nh;
      pi.manual = false; // re-fit the photo to the resized cell (auto)
    } else {
      // Dropped on ANOTHER cell → swap the two photos' frames (drag-to-swap).
      const cx = o.left + frame.width / 2; const cy = o.top + frame.height / 2;
      const outsideOwn = cx < frame.x || cx > frame.x + frame.width || cy < frame.y || cy > frame.y + frame.height;
      const target = outsideOwn ? cellAtPoint(cx, cy, pi.id) : null;
      setSwapHighlight(null);
      if (target) { swapCells(pi.id, target.id); return; }
      // Move the whole cell — auto-fit follows the frame; manual box moves too.
      const dx = o.left - frame.x; const dy = o.top - frame.y;
      frame.x += dx; frame.y += dy; pos.x += dx; pos.y += dy;
      if (poly) poly.forEach((p) => { p.x += dx; p.y += dy; });
    }
  } else if (frame) {
    // Photo in crop mode: switch to MANUAL and write the display box from the
    // live object (uniform-scaled ⇒ proportional ⇒ no stretch). Allows zoom-out.
    pi.manual = true;
    pos.width = (o.width || pos.width) * o.scaleX;
    pos.height = (o.height || pos.height) * o.scaleY;
    pos.x = o.left; pos.y = o.top;
    clampCrop(pos, frame);
  } else {
    // Free photo: move + scale freely.
    pos.x = o.left; pos.y = o.top;
    pos.width = (o.width || pos.width) * o.scaleX; pos.height = (o.height || pos.height) * o.scaleY;
    pos.rotation = o.angle;
  }
  project.markDirty();
  updateLive(id); // in place — no flicker

  const after = { pos: { ...pos }, frame: frame ? { ...frame } : null, poly: poly ? poly.map((p) => ({ ...p })) : null, manual: pi.manual };
  const restore = (s: typeof before) => {
    Object.assign(pos, s.pos);
    if (frame && s.frame) Object.assign(frame, s.frame);
    if (poly && s.poly) s.poly.forEach((p, i) => { poly[i].x = p.x; poly[i].y = p.y; });
    pi.manual = s.manual;
    project.markDirty(); updateLive(id);
    // Decorative frames + mask outlines must regenerate at the new size (no stretch).
    if (pi.border?.style === 'pattern' || pi.maskId) editor.requestRender();
  };
  history.run({
    type: 'transform',
    description: type === 'frame' ? 'Adjust cell' : frame ? 'Adjust photo' : 'Move photo',
    execute: () => restore(after),
    undo: () => restore(before),
  });
}

// ---- Drag-to-swap between cells ---------------------------------------------
/** The other cell currently hovered while dragging a frame handle (swap target). */
let swapTargetId: string | null = null;
let swapHighlight: Rect | null = null;

/** Find another SLOTTED image whose cell contains the point (for drag-to-swap). */
function cellAtPoint(x: number, y: number, excludeId: string): PageImage | null {
  if (!page.value) return null;
  for (const im of page.value.images) {
    if (im.id === excludeId || !im.visible || !im.slotRect || im.free) continue;
    const f = im.slotRect;
    if (x >= f.x && x <= f.x + f.width && y >= f.y && y <= f.y + f.height) return im;
  }
  return null;
}

function setSwapHighlight(target: PageImage | null) {
  if (!canvas) return;
  if (!target) {
    if (swapHighlight) { canvas.remove(swapHighlight as never); swapHighlight = null; }
    swapTargetId = null;
    return;
  }
  if (swapTargetId === target.id && swapHighlight) return;
  if (swapHighlight) canvas.remove(swapHighlight as never);
  const f = target.slotRect!;
  swapHighlight = new Rect({
    left: f.x, top: f.y, width: f.width, height: f.height,
    fill: 'rgba(108,99,255,0.12)', stroke: '#6C63FF', strokeWidth: 6, strokeDashArray: [18, 12],
    selectable: false, evented: false, objectCaching: false,
  });
  canvas.add(swapHighlight);
  swapTargetId = target.id;
}

/** Swap two slotted photos' cells (frames trade places; both photos re-fit). */
function swapCells(aId: string, bId: string) {
  const A = project.findImage(aId)?.image; const B = project.findImage(bId)?.image;
  if (!A || !B) return;
  type Snap = { slotId: string; slotRect?: typeof A.slotRect; poly?: typeof A.clipPolygon; manual?: boolean; pos: typeof A.position };
  const snap = (i: typeof A): Snap => ({ slotId: i.slotId, slotRect: i.slotRect ? { ...i.slotRect } : undefined, poly: i.clipPolygon?.map((p) => ({ ...p })), manual: i.manual, pos: { ...i.position } });
  const sa = snap(A); const sb = snap(B);
  const apply = (img: typeof A, s: Snap, refit: boolean) => {
    img.slotId = s.slotId; img.slotRect = s.slotRect ? { ...s.slotRect } : undefined;
    img.clipPolygon = s.poly?.map((p) => ({ ...p }));
    if (refit) {
      img.manual = false; // auto re-fit (cover) into the new cell
      if (img.slotRect) img.position = { ...img.position, x: img.slotRect.x, y: img.slotRect.y, width: img.slotRect.width, height: img.slotRect.height };
    } else {
      img.manual = s.manual; img.position = { ...s.pos };
    }
    project.markDirty();
  };
  history.run({
    type: 'transform', description: 'Swap photos',
    execute: () => { apply(A, sb, true); apply(B, sa, true); editor.requestRender(); },
    undo: () => { apply(A, sa, false); apply(B, sb, false); editor.requestRender(); },
  });
}

/**
 * Follow-the-gesture sync: while a FRAME handle is being dragged/resized, keep
 * the photo, its clip, border and decorative frame glued to the handle; while a
 * FREE photo moves/rotates, keep its border + frame glued to the photo. Without
 * this, dependent objects stayed put during the gesture and JUMPED into place on
 * mouse-up — the "flicker" when moving an image. View-only: the model is written
 * once, by commitTransform on mouse-up.
 */
function syncGestureLive(target: { pebbleId?: string; pebbleType?: string }) {
  const id = target.pebbleId;
  if (!id) return;
  const refs = objMap.get(id);
  const found = project.findImage(id);
  if (!refs || !found) return;
  const pi = found.image;
  const o = target as unknown as { left: number; top: number; scaleX: number; scaleY: number; angle: number; width: number; height: number };

  if (target.pebbleType === 'frame' && pi.slotRect) {
    // Live frame rect from the handle's in-gesture geometry.
    const fr = {
      x: o.left, y: o.top,
      width: Math.max(1, (o.width || pi.slotRect.width) * o.scaleX),
      height: Math.max(1, (o.height || pi.slotRect.height) * o.scaleY),
    };
    const img = refs.img as unknown as { width: number; height: number; set: (v: object) => void; setCoords: () => void; dirty?: boolean; clipPath?: { set: (v: object) => void; dirty?: boolean } };
    const isMove = Math.abs(fr.width - pi.slotRect.width) < 0.5 && Math.abs(fr.height - pi.slotRect.height) < 0.5;
    if (isMove) {
      // Pure move: shift the photo by the frame delta (manual pans preserved).
      const dx = fr.x - pi.slotRect.x; const dy = fr.y - pi.slotRect.y;
      img.set({ left: pi.position.x + dx, top: pi.position.y + dy });
      // Drag-to-swap: highlight another cell when the dragged cell's centre is
      // over it (and has clearly left its own cell).
      const cx = fr.x + fr.width / 2; const cy = fr.y + fr.height / 2;
      const own = pi.slotRect;
      const outsideOwn = cx < own.x || cx > own.x + own.width || cy < own.y || cy > own.y + own.height;
      setSwapHighlight(outsideOwn ? cellAtPoint(cx, cy, pi.id) : null);
    } else {
      // Resize: re-fit the photo to the live frame (same math as the final fit).
      const probe = { ...pi, slotRect: fr, manual: false } as PageImage;
      const { scale, left, top } = computeImagePlacement(probe, img.width || 1, img.height || 1);
      // Explicit flips (see updateLive — a negative scale would toggle them).
      img.set({
        left, top,
        scaleX: Math.abs(scale), scaleY: Math.abs(scale),
        flipX: !!pi.position.flipX, flipY: !!pi.position.flipY,
      });
    }
    img.dirty = true;
    if (img.clipPath) {
      img.clipPath.set({ left: fr.x, top: fr.y, width: fr.width, height: fr.height });
      img.clipPath.dirty = true;
    }
    img.setCoords();
    if (refs.border) {
      (refs.border as unknown as { set: (v: object) => void; setCoords: () => void; dirty?: boolean }).set({ left: fr.x, top: fr.y, width: fr.width, height: fr.height, scaleX: 1, scaleY: 1 });
      (refs.border as unknown as { setCoords: () => void }).setCoords();
      (refs.border as unknown as { dirty?: boolean }).dirty = true;
    }
    if (refs.frame) {
      const fo = refs.frame as unknown as { width: number; height: number; set: (v: object) => void; setCoords: () => void; dirty?: boolean };
      fo.set({ left: fr.x, top: fr.y, scaleX: fr.width / (fo.width || 1), scaleY: fr.height / (fo.height || 1) });
      fo.setCoords(); fo.dirty = true;
    }
    if (refs.vignette) {
      const v = refs.vignette as unknown as { width: number; height: number; set: (o: object) => void; setCoords: () => void; dirty?: boolean };
      v.set({ left: fr.x, top: fr.y, scaleX: fr.width / (v.width || 1), scaleY: fr.height / (v.height || 1) });
      v.setCoords(); v.dirty = true;
    }
    return;
  }

  if (target.pebbleType !== 'frame' && !pi.slotRect) {
    // Free photo being dragged/scaled/rotated: border + frame follow it live.
    const w = Math.abs((o.width || 1) * o.scaleX);
    const h = Math.abs((o.height || 1) * o.scaleY);
    if (refs.border) {
      const b = refs.border as unknown as { width: number; height: number; set: (v: object) => void; setCoords: () => void; dirty?: boolean };
      b.set({ left: o.left, top: o.top, angle: o.angle, scaleX: w / (b.width || 1), scaleY: h / (b.height || 1) });
      b.setCoords(); b.dirty = true;
    }
    if (refs.frame) {
      const fo = refs.frame as unknown as { width: number; height: number; set: (v: object) => void; setCoords: () => void; dirty?: boolean };
      fo.set({ left: o.left, top: o.top, angle: o.angle, scaleX: w / (fo.width || 1), scaleY: h / (fo.height || 1) });
      fo.setCoords(); fo.dirty = true;
    }
    if (refs.vignette) {
      const v = refs.vignette as unknown as { width: number; height: number; set: (o: object) => void; setCoords: () => void; dirty?: boolean };
      v.set({ left: o.left, top: o.top, angle: o.angle, scaleX: w / (v.width || 1), scaleY: h / (v.height || 1) });
      v.setCoords(); v.dirty = true;
    }
  }
}

function bindEvents() {
  if (!canvas) return;
  canvas.on('selection:created', (e) => { if (!suppressSel) syncSelection(e.selected?.[0]); });
  canvas.on('selection:updated', (e) => { if (!suppressSel) syncSelection(e.selected?.[0]); });
  canvas.on('object:moving', (e) => { if (e.target) syncGestureLive(e.target as never); });
  canvas.on('object:scaling', (e) => { if (e.target) syncGestureLive(e.target as never); });
  canvas.on('object:rotating', (e) => { if (e.target) syncGestureLive(e.target as never); });
  canvas.on('mouse:up', () => setSwapHighlight(null)); // never leave a stale swap highlight
  canvas.on('selection:cleared', () => {
    if (suppressSel) return;
    editor.selectObject(null);
    // Leaving an object also exits crop mode.
    if (editor.cropImageId) { editor.cropImageId = null; editor.requestRender(); }
  });
  canvas.on('object:modified', (e) => { if (e.target) commitTransform(e.target as never); });
  // Double-click a framed photo to adjust it inside its cell (pan/zoom); again to exit.
  canvas.on('mouse:dblclick', (e) => {
    const t = e.target as unknown as { pebbleId?: string; pebbleType?: string } | undefined;
    if (t?.pebbleType === 'frame' && t.pebbleId) { editor.cropImageId = t.pebbleId; editor.requestRender(); }
    else if (editor.cropImageId) { editor.cropImageId = null; editor.requestRender(); }
  });
}

function syncSelection(obj: unknown) {
  const o = obj as { pebbleId?: string; pebbleType?: string } | undefined;
  if (o?.pebbleId) {
    // A frame handle represents its image. Selecting ON the canvas opens props.
    const type = o.pebbleType === 'text' ? 'text' : o.pebbleType === 'decoration' ? 'decoration' : 'image';
    editor.selectObject(o.pebbleId, type);
    editor.propertiesOpen = true;
  } else editor.selectObject(null);
}

/** Convert a drop point (client px) to album coordinates. */
function toAlbumCoords(clientX: number, clientY: number): { x: number; y: number } {
  if (!el.value) return { x: 0, y: 0 };
  const rect = el.value.getBoundingClientRect();
  const z = fitScale() * editor.zoom;
  return { x: (clientX - rect.left) / z, y: (clientY - rect.top) / z };
}

/** Add a free-floating image (from a bin drag) at the drop point. `look` is the
 *  carried appearance when this is a MOVE of an existing page image. */
function addFreeImage(filename: string, clientX: number, clientY: number, look?: CarriedAppearance | null) {
  if (!page.value || !project.meta) return;
  const rec = project.images.find((r) => r.relativePath === filename);
  const at = toAlbumCoords(clientX, clientY);
  const w = project.meta.albumWidth * 0.3;
  const ar = rec && rec.height ? rec.width / rec.height : 1.5;
  const h = w / ar;
  page.value.images.push(applyCarriedAppearance<PageImage>({
    id: uuid(), filename, slotId: 'free', free: true,
    position: { x: at.x - w / 2, y: at.y - h / 2, width: w, height: h, rotation: 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false },
    crop: { x: 0, y: 0, width: 1, height: 1 },
    parsedLabels: rec?.parsedLabels ?? {}, overrides: {}, effects: defaultEffects(),
    border: null, shadow: { offsetX: 0, offsetY: 6, blur: 18, spread: 0, color: '#000000', opacity: 0.3 },
    opacity: 1, zIndex: 500 + page.value.images.length, visible: true,
  }, look));
  if (project.project) project.syncUsage(project.project);
  project.markDirty();
  editor.requestRender();
}

function onDrop(e: DragEvent) {
  e.preventDefault();
  const move = movePayloadFromDrop(e);
  if (!move || !page.value) return;
  // A MOVE of an existing page image (same page or another): keep its look
  // (erase mask, effects, border, shadow, shape mask, opacity, flips) and detach
  // the original so the move doesn't leave a duplicate. Plain bin drops start fresh.
  let look: CarriedAppearance | null = null;
  if (move.fromImageId) {
    const found = project.findImage(move.fromImageId);
    if (found) {
      look = carriedAppearance(found.image);
      found.page.images = found.page.images.filter((i) => i.id !== move.fromImageId);
      if (editor.selectedObjectId === move.fromImageId) editor.selectObject(null);
    }
  }
  addFreeImage(move.filename, e.clientX, e.clientY, look);
}

onMounted(() => {
  if (!el.value) return;
  canvas = new Canvas(el.value, {
    preserveObjectStacking: true,
    uniformScaling: true, // corner-drag keeps aspect ratio (no stretching)
    selectionColor: 'rgba(108,99,255,0.15)',
    selectionBorderColor: '#6C63FF',
  });
  bindEvents();
  void render();
  window.addEventListener('resize', applyZoom);
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', applyZoom);
  canvas?.dispose();
});

// Re-render only on page change or an explicit structural request.
watch(() => editor.activePageIndex, () => { void render(); });
watch(() => editor.canvasRevision, () => { void render(); });
watch(() => editor.zoom, applyZoom);

// Programmatic selection requests (e.g. clicking a thumbnail in the bin).
watch(() => editor.selectionRequest, (req) => {
  if (!req || !canvas) return;
  const o = fabricById(req.id) as unknown as object | undefined;
  if (o) {
    canvas.setActiveObject(o as never);
    canvas.requestRenderAll();
    editor.selectObject(req.id);
    editor.propertiesOpen = req.openProps; // layers list highlights without opening props
  }
});

// In-place geometry updates from other panels (e.g. the zoom slider) — no rebuild.
watch(() => editor.liveUpdateRequest, (req) => { if (req) updateLive(req.id); });

/**
 * In-place EFFECTS updates (adjust sliders / preset / vignette): re-apply the
 * filter pipeline on the live Fabric image — no rebuild ⇒ no flicker, and the
 * slider feels live like PicsArt. Falls back to a full render when the image
 * isn't on the canvas (or its mask changed, which alters clipping).
 */
watch(() => editor.effectsUpdateRequest, (req) => {
  if (!req || !canvas) return;
  const refs = objMap.get(req.id);
  const found = project.findImage(req.id);
  if (!refs || !found) { editor.requestRender(); return; }
  applyEffects(refs.img, found.image);
  (refs.img as unknown as { dirty?: boolean }).dirty = true;
  refreshVignette(refs, found.image);
  canvas.renderAll();
});

// Hold-to-compare: strip every image's filters while held, restore on release.
watch(() => editor.compareOriginal, (on) => {
  if (!canvas) return;
  for (const [id, refs] of objMap) {
    const found = project.findImage(id);
    if (!found) continue;
    if (on) {
      (refs.img as unknown as { filters: unknown[] }).filters = [];
      applyFiltersSafe(refs.img);
      if (refs.vignette) (refs.vignette as unknown as { visible: boolean }).visible = false;
    } else {
      applyEffects(refs.img, found.image);
      if (refs.vignette) (refs.vignette as unknown as { visible: boolean }).visible = true;
    }
    (refs.img as unknown as { dirty?: boolean }).dirty = true;
  }
  canvas.renderAll();
});
</script>

<template>
  <div ref="wrap" class="relative flex-1 flex items-center justify-center overflow-auto bg-[#0d1124]"
       @dragover.prevent @drop="onDrop">
    <div class="shadow-2xl shadow-black/50">
      <canvas ref="el" />
    </div>
    <div v-if="loadingCount > 0" class="absolute top-4 left-1/2 -translate-x-1/2 pa-chip">Rendering…</div>
    <div v-if="!page" class="text-pebble-text-dim">No page selected</div>
  </div>
</template>
