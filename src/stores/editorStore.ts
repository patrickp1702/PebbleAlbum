/**
 * editorStore.ts — Transient editor UI state (not persisted to .pebble):
 * active page, selection, zoom, current tool, and which bottom panel is open.
 * Also hosts `setEraseMask` / `setFilterMask`, the ONE undoable way to change a
 * photo's erase / Filter-brush mask (shared by the brush studio and the
 * properties panel).
 */
import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import type { ActiveTool, BottomPanel, CanvasGuide } from '@shared/editor.types';
import type { PageImage } from '@shared/pebble.types';
import { useHistoryStore } from '@/stores/historyStore';
import { useProjectStore } from '@/stores/projectStore';

export const useEditorStore = defineStore('editor', () => {
  const activePageIndex = ref(0);
  const selectedObjectId = ref<string | null>(null);
  const selectedType = ref<'image' | 'text' | 'decoration' | null>(null);
  const zoom = ref(1);
  const tool = ref<ActiveTool>('select');
  const bottomPanel = ref<BottomPanel>('images');
  const cropMode = ref(false);
  /** Id of the image currently being adjusted INSIDE its frame (pan/zoom).
   *  Set by double-clicking a framed photo; cleared by clicking elsewhere. */
  const cropImageId = ref<string | null>(null);
  const guides = ref<CanvasGuide[]>([]);
  const isAnimatingPageTurn = ref(false);
  /**
   * ⚠ INVARIANT (no-lag): bumped ONLY for structural rebuilds (image added/
   * removed, layout/theme/decoration change, filter/border edit, z-order). Plain
   * move/scale/rotate edits must NOT bump this — they update the model in place
   * without a full re-render. Bumping it on every drag reintroduces the
   * multi-second lag this was created to fix.
   */
  const canvasRevision = ref(0);
  /**
   * Whether the right panel shows the selected object's PROPERTIES. Selecting a
   * photo on the canvas (or via a layer's edit icon) opens properties; merely
   * highlighting a photo from the Layers list selects it WITHOUT opening
   * properties, so the Layers list stays visible.
   */
  const propertiesOpen = ref(false);

  const hasSelection = computed(() => selectedObjectId.value !== null);
  const zoomPercent = computed(() => Math.round(zoom.value * 100));

  function selectObject(id: string | null, type: typeof selectedType.value = 'image'): void {
    selectedObjectId.value = id;
    selectedType.value = id ? type : null;
    if (!id) { cropMode.value = false; propertiesOpen.value = false; }
  }

  function setPage(index: number): void {
    activePageIndex.value = index;
    selectObject(null);
  }

  function setZoom(z: number): void { zoom.value = Math.min(8, Math.max(0.1, z)); }
  function zoomIn(): void { setZoom(zoom.value * 1.2); }
  function zoomOut(): void { setZoom(zoom.value / 1.2); }
  function resetZoom(): void { setZoom(1); }

  function addGuide(g: CanvasGuide): void { guides.value.push(g); }
  function clearGuides(): void { guides.value = []; }

  /** Ask the canvas to rebuild (structural change only). */
  function requestRender(): void { canvasRevision.value += 1; }

  /** Ask the canvas to programmatically select an object by id (e.g. from the bin
   *  or the layers list). `openProps` controls whether the properties panel opens. */
  const selectionRequest = ref<{ id: string; openProps: boolean; n: number } | null>(null);
  function requestSelect(id: string, openProps = false): void {
    selectionRequest.value = { id, openProps, n: (selectionRequest.value?.n ?? 0) + 1 };
  }

  /**
   * Ask the canvas to update ONE image's geometry IN PLACE (no full rebuild ⇒ no
   * flicker). Use for continuous geometry edits (zoom, rotation, opacity, fit).
   * Appearance changes that need image re-processing (filters/border) still use
   * requestRender().
   */
  const liveUpdateRequest = ref<{ id: string; n: number } | null>(null);
  function requestLiveUpdate(id: string): void {
    liveUpdateRequest.value = { id, n: (liveUpdateRequest.value?.n ?? 0) + 1 };
  }

  /**
   * Ask the canvas to re-apply ONE image's effects (preset/adjust sliders/
   * vignette) IN PLACE on the live Fabric object — no rebuild, no flicker.
   */
  const effectsUpdateRequest = ref<{ id: string; n: number } | null>(null);
  function requestEffectsUpdate(id: string): void {
    effectsUpdateRequest.value = { id, n: (effectsUpdateRequest.value?.n ?? 0) + 1 };
  }

  /** While true, the canvas temporarily shows images WITHOUT effects (hold-to-compare). */
  const compareOriginal = ref(false);

  /** Open Cutout Studio for a source photo (optionally bound to a page image).
   *  `mode` 'filter' opens the same brush studio as the Filter brush (edits
   *  `filterMask` instead of `eraseMask`; needs a page image). */
  const cutoutRequest = ref<{ filename: string; imageId: string | null; mode: 'erase' | 'filter' } | null>(null);
  function openCutout(filename: string, imageId: string | null = null, mode: 'erase' | 'filter' = 'erase'): void {
    cutoutRequest.value = { filename, imageId, mode: imageId ? mode : 'erase' };
  }
  function closeCutout(): void { cutoutRequest.value = null; }

  /**
   * Point a page image at a new erase mask (or clear it with `undefined`) as a
   * history command: execute sets `next`, undo restores the previous value
   * (including "no mask"). Each mask save is a NEW file, so undo/redo is just
   * swapping the path. Both directions re-render (the photo must be re-masked).
   */
  function setEraseMask(pi: PageImage, next: string | undefined, description = 'Erase / restore photo'): void {
    const project = useProjectStore();
    const prev = pi.eraseMask;
    const set = (v: string | undefined) => {
      if (v) pi.eraseMask = v; else delete pi.eraseMask;
      project.markDirty();
      requestRender();
    };
    useHistoryStore().run({ type: 'eraseMask', description, execute: () => set(next), undo: () => set(prev) });
  }

  /**
   * Filter brush: point a page image at a new FILTER mask (or clear it with
   * `undefined` = filter everywhere) as a history command — the exact mirror of
   * setEraseMask (each save is a new file, so undo/redo swaps the path; both
   * directions re-render so the photo is re-blended).
   */
  function setFilterMask(pi: PageImage, next: string | undefined, description = 'Filter brush'): void {
    const project = useProjectStore();
    const prev = pi.filterMask;
    const set = (v: string | undefined) => {
      if (v) pi.filterMask = v; else delete pi.filterMask;
      project.markDirty();
      requestRender();
    };
    useHistoryStore().run({ type: 'filterMask', description, execute: () => set(next), undo: () => set(prev) });
  }

  return {
    canvasRevision, requestRender, selectionRequest, requestSelect, propertiesOpen,
    liveUpdateRequest, requestLiveUpdate,
    effectsUpdateRequest, requestEffectsUpdate, compareOriginal,
    cutoutRequest, openCutout, closeCutout, setEraseMask, setFilterMask,
    activePageIndex, selectedObjectId, selectedType, zoom, tool, bottomPanel,
    cropMode, cropImageId, guides, isAnimatingPageTurn, hasSelection, zoomPercent,
    selectObject, setPage, setZoom, zoomIn, zoomOut, resetZoom, addGuide, clearGuides,
  };
});
