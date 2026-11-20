<script setup lang="ts">
/**
 * PropertiesPanel.vue — Context panel for the selected image. PicsArt-style
 * editing surface: Move (transform) · Adjust (light/colour/detail sliders,
 * live) · Filters (preset thumbnails on YOUR photo + strength) · Frame
 * (borders + shape masks) · Shadow · Caption. Every change marks the project
 * dirty (→ autosave). Slider edits apply IN PLACE on the canvas (no rebuild).
 */
import { ref, computed, watch } from 'vue';
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import AppSlider from '@/components/ui/AppSlider.vue';
import AppColorPicker from '@/components/ui/AppColorPicker.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import AppIconButton from '@/components/ui/AppIconButton.vue';
import AppSegmented from '@/components/ui/AppSegmented.vue';
import AppTabs from '@/components/ui/AppTabs.vue';
import { defaultEffects, boxForFit } from '@/engine/collageComposer';
import { BORDER_FRAMES } from '@/engine/borderFrames';
import { FILTER_PRESETS, buildEffectsFilters } from '@/engine/fabricFilters';
import { MASKS, maskPathData } from '@/engine/maskShapes';
import { generatePresetThumbs } from '@/engine/presetThumbs';
import { loadImageDataUrl } from '@/engine/imageLoader';
import type { MaskId } from '@shared/pebble.types';

const project = useProjectStore();
const editor = useEditorStore();
const tab = ref<'transform' | 'adjust' | 'filters' | 'border' | 'shadow' | 'caption'>('transform');
const TABS = [
  { id: 'transform', label: 'Move', icon: 'move' },
  { id: 'adjust', label: 'Adjust', icon: 'sliders' },
  { id: 'filters', label: 'Filters', icon: 'filters' },
  { id: 'border', label: 'Frame', icon: 'frame' },
  { id: 'shadow', label: 'Shadow', icon: 'shadow' },
  { id: 'caption', label: 'Caption', icon: 'caption' },
] as const;
// Option lists for the segmented controls (presentation only).
const FIT_OPTIONS = [{ value: 'cover', label: 'Fill frame' }, { value: 'contain', label: 'Fit whole' }] as const;
const BORDER_KINDS = [{ value: 'line', label: 'Line' }, { value: 'frame', label: 'Decorative frame' }] as const;
const LINE_STYLES = [
  { value: 'solid', label: 'Solid' }, { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' }, { value: 'double', label: 'Double' },
] as const;

/** Set the fit mode and return the photo to AUTO (re-fit + re-centre). */
function applyFit(mode: 'cover' | 'contain') {
  const pi = img.value;
  if (!pi || !pi.slotRect) return;
  pi.fit = mode; pi.manual = false;
  live();
}

/** The auto base display box for the current fit (cover/contain/auto rule). */
function autoBaseBox() {
  const pi = img.value!; const f = pi.slotRect!;
  const rec = project.images.find((r) => r.relativePath === pi.filename);
  const w = rec?.width ?? f.width; const h = rec?.height ?? f.height;
  const fCover = Math.max(f.width / w, f.height / h);
  const fContain = Math.min(f.width / w, f.height / h);
  const useContain = pi.fit === 'contain' || (pi.fit !== 'cover' && fCover / fContain > 1.7);
  return boxForFit(f, w, h, useContain ? 'contain' : 'cover');
}

/** Zoom relative to the auto fit. 100% = base fit; <100% pulls back (reveals
 *  more, may letterbox); >100% zooms in. */
const frameZoom = computed(() => {
  const pi = img.value;
  if (!pi || !pi.slotRect) return 100;
  if (!pi.manual) return 100;
  return Math.round((pi.position.width / autoBaseBox().width) * 100);
});
/** Toggle "adjust inside frame" (crop) mode for the selected photo. */
function toggleCrop() {
  const pi = img.value;
  if (!pi) return;
  editor.cropImageId = editor.cropImageId === pi.id ? null : pi.id;
  editor.requestRender();
}

/** Auto cover-crop focal point (0–100% of the photo) — keeps the cell filled and
 *  re-centres the crop so faces survive. Stays in auto-fit (manual = false). */
const focusX = computed(() => Math.round(((img.value?.focus?.x) ?? 0.5) * 100));
const focusY = computed(() => Math.round(((img.value?.focus?.y) ?? 0.5) * 100));
const coverZoomPct = computed(() => Math.round(((img.value?.coverZoom) ?? 1) * 100));
function setFocus(axis: 'x' | 'y', pct: number) {
  const pi = img.value; if (!pi || !pi.slotRect) return;
  const f = pi.focus ?? { x: 0.5, y: 0.5 };
  pi.focus = { x: axis === 'x' ? pct / 100 : f.x, y: axis === 'y' ? pct / 100 : f.y };
  pi.manual = false;
  live();
}
function setCoverZoom(pct: number) {
  const pi = img.value; if (!pi || !pi.slotRect) return;
  pi.coverZoom = Math.max(0.5, pct / 100);
  pi.manual = false;
  live();
}

/** Zoom the photo inside its frame (0–400%), centred on the frame. */
function setZoom(pct: number) {
  const pi = img.value;
  if (!pi || !pi.slotRect) return;
  const base = autoBaseBox();
  const f = Math.max(0.05, pct / 100);
  const w = base.width * f; const h = base.height * f;
  const fcx = pi.slotRect.x + pi.slotRect.width / 2;
  const fcy = pi.slotRect.y + pi.slotRect.height / 2;
  pi.manual = true;
  pi.position.width = w; pi.position.height = h;
  pi.position.x = fcx - w / 2; pi.position.y = fcy - h / 2;
  live();
}

/** Double-click reset of the manual-zoom slider: back to AUTO fit (keeps the
 *  focal point and cover zoom) — not setZoom(100), which would re-centre the
 *  photo and leave it in manual mode. Same path as choosing a fit mode. */
function resetManualZoom() {
  const pi = img.value;
  if (!pi || !pi.slotRect) return;
  pi.manual = false;
  live();
}

/** Reshape the CELL to a preset aspect ratio (kept centred, clamped to page). */
const ASPECTS = [
  { label: '1:1', r: 1 }, { label: '4:5', r: 4 / 5 }, { label: '3:4', r: 3 / 4 },
  { label: '3:2', r: 3 / 2 }, { label: '16:9', r: 16 / 9 },
];
function setCellAspect(r: number) {
  const pi = img.value;
  if (!pi?.slotRect || !project.meta) return;
  const f = pi.slotRect;
  const cx = f.x + f.width / 2; const cy = f.y + f.height / 2;
  let w = f.width; let h = w / r;
  if (h > project.meta.albumHeight) { h = project.meta.albumHeight; w = h * r; }
  if (w > project.meta.albumWidth) { w = project.meta.albumWidth; h = w / r; }
  f.width = w; f.height = h;
  f.x = Math.min(Math.max(0, cx - w / 2), project.meta.albumWidth - w);
  f.y = Math.min(Math.max(0, cy - h / 2), project.meta.albumHeight - h);
  pi.manual = false; // photo re-fits the reshaped cell
  live();
}

/** Rotate a free photo in 90° steps (framed photos rotate via their layout). */
function rotate90(dir: 1 | -1) {
  const pi = img.value;
  if (!pi || pi.slotRect) return;
  let a = (pi.position.rotation + 90 * dir) % 360;
  if (a > 180) a -= 360; if (a < -180) a += 360;
  pi.position.rotation = a;
  live();
}

const selected = computed(() =>
  editor.selectedObjectId ? project.findImage(editor.selectedObjectId) : null);
const img = computed(() => selected.value?.image ?? null);

// Slider edits fire continuously; geometry + effects both update IN PLACE (no
// canvas rebuild ⇒ no flicker). Structural changes (border/mask) re-render —
// continuous structural sliders (border width etc.) debounce the rebuild.
let renderTimer: ReturnType<typeof setTimeout> | null = null;
const touch = () => {
  project.markDirty();
  if (renderTimer) clearTimeout(renderTimer);
  renderTimer = setTimeout(() => editor.requestRender(), 200);
};
const touchNow = () => { project.markDirty(); editor.requestRender(); };
/** Geometry-only change → update the photo IN PLACE (no rebuild ⇒ no flicker). */
const live = () => { project.markDirty(); if (img.value) editor.requestLiveUpdate(img.value.id); };
/** Effects-only change → re-apply filters IN PLACE (live like PicsArt). */
const liveFx = () => { project.markDirty(); if (img.value) editor.requestEffectsUpdate(img.value.id); };

// ---------------------------------------------------------------- filters tab
const FILTER_CATS = [
  { id: 'all', label: 'All' }, { id: 'basic', label: 'Basic' }, { id: 'film', label: 'Film' },
  { id: 'mono', label: 'Mono' }, { id: 'color', label: 'Colour' }, { id: 'mood', label: 'Mood' },
] as const;
const filterCat = ref<(typeof FILTER_CATS)[number]['id']>('all');
const visiblePresets = computed(() =>
  FILTER_PRESETS.filter((p) => filterCat.value === 'all' || p.category === filterCat.value));
const presetThumbs = ref<Record<string, string>>({});
watch(
  () => [img.value?.filename, tab.value] as const,
  async ([filename, t]) => {
    if (!filename || t !== 'filters' || !project.meta) return;
    try {
      const small = await loadImageDataUrl(project.meta.sourceFolder, filename, 200);
      presetThumbs.value = await generatePresetThumbs(filename, small, FILTER_PRESETS.map((p) => p.id));
    } catch { presetThumbs.value = {}; }
  },
  { immediate: true },
);
/** Filter brush needs something to brush: a preset or any adjust slider off neutral.
 *  (Vignette alone is an overlay, not part of the masked pipeline.) */
const hasEffects = computed(() => !!img.value && buildEffectsFilters(img.value.effects).length > 0);
function openFilterBrush() { if (img.value && hasEffects.value) editor.openCutout(img.value.filename, img.value.id, 'filter'); }
function setFilter(f: string) { if (img.value) { img.value.effects.filter = f; liveFx(); } }
const filterStrengthPct = computed(() => Math.round(((img.value?.effects.filterStrength) ?? 1) * 100));

function flip(axis: 'X' | 'Y') {
  if (!img.value) return;
  if (axis === 'X') img.value.position.flipX = !img.value.position.flipX;
  else img.value.position.flipY = !img.value.position.flipY;
  live();
}

// ---------------------------------------------------------------- border tab
function enableBorder() { if (img.value && !img.value.border) { img.value.border = { style: 'solid', width: 4, color: '#ffffff', radius: 0, padding: 0, gradient: null }; touchNow(); } }
/** Whether the border is a decorative SVG frame (vs. a line border). */
const isPatternBorder = computed(() => img.value?.border?.style === 'pattern');
function setLineStyle(s: 'solid' | 'dashed' | 'dotted' | 'double') { if (img.value?.border) { img.value.border.style = s; touchNow(); } }
function useLineBorder() { const b = img.value?.border; if (b) { b.style = 'solid'; touchNow(); } }
function useFrameBorder() {
  const b = img.value?.border;
  if (!b) return;
  b.style = 'pattern';
  if (!b.frameId) b.frameId = 'scallop_fan';
  // Default thickness scales with the album so decorative frames read well at
  // any DPI (and keeps the generated SVG a sensible size).
  const h = project.meta?.albumHeight ?? 800;
  if (!b.width || b.width < 8) b.width = Math.max(16, Math.round(h * 0.022));
  touchNow();
}
function pickFrame(id: string) { if (img.value?.border) { img.value.border.frameId = id; touchNow(); } }
function toggleGradient() {
  const b = img.value?.border;
  if (!b) return;
  b.gradient = b.gradient ? null : { from: b.color || '#ffffff', to: '#6C63FF', angle: 45 };
  touchNow();
}
/** Clip the photo to a shape mask (or back to its normal rect). Structural. */
function setMask(id: MaskId | null) {
  const pi = img.value;
  if (!pi) return;
  pi.maskId = id ?? undefined;
  touchNow();
}
function enableShadow() { if (img.value && !img.value.shadow) { img.value.shadow = { offsetX: 0, offsetY: 8, blur: 24, spread: 0, color: '#000000', opacity: 0.35 }; touchNow(); } }
function resetEffects() { if (img.value) { img.value.effects = defaultEffects(); liveFx(); } }
/** Hold-to-compare: show the untouched photo while the button is held. */
function compare(on: boolean) { editor.compareOriginal = on; }
/** Return to the page (Layers/Settings) panel; keep the photo highlighted. */
function back() { editor.cropImageId = null; editor.propertiesOpen = false; editor.requestRender(); }
</script>

<template>
  <div v-if="img" class="flex flex-col h-full">
    <!-- What is selected -->
    <header class="pl-1.5 pr-3 h-12 shrink-0 border-b border-pebble-border flex items-center gap-1.5">
      <AppIconButton icon="chevron-left" label="Back to page" @click="back" />
      <div class="min-w-0">
        <div class="pa-section">Photo</div>
        <div class="text-sm font-medium truncate" :title="img.filename">{{ img.filename }}</div>
      </div>
    </header>

    <!-- Quick action, available on every tab: the erase / restore studio -->
    <div class="px-3 py-2.5 border-b border-pebble-border shrink-0">
      <div class="flex gap-2">
        <button type="button" class="pa-btn flex-1"
                title="Brush away parts of this photo to blend it into the page — and paint them back anytime; the original is kept. Also: AI background removal, save as sticker."
                @click="editor.openCutout(img.filename, img.id)">
          <AppIcon name="eraser" :size="15" /> Erase / restore
        </button>
        <AppButton v-if="img.eraseMask" variant="ghost" title="Show the whole photo again (undoable)"
                   @click="editor.setEraseMask(img, undefined, 'Clear erasing')">Clear</AppButton>
      </div>
      <p class="pa-hint mt-1.5">Brush parts away to blend the photo in — non-destructive, restore anytime.</p>
    </div>

    <AppTabs v-model="tab" :tabs="TABS" stacked class="px-2" />

    <div class="flex-1 min-h-0 overflow-auto p-3 space-y-4 text-sm">
      <!-- Filter brush (Adjust + Filters tabs): brush the effects off / back on parts of the photo -->
      <section v-if="tab === 'adjust' || tab === 'filters'" class="space-y-1.5">
        <div class="flex gap-2">
          <button type="button" class="pa-btn flex-1" :disabled="!hasEffects"
                  :title="hasEffects ? 'Brush the filter and adjustments off parts of this photo — and back on; non-destructive.' : 'Apply a filter or adjustment first.'"
                  @click="openFilterBrush">
            <AppIcon name="brush" :size="15" /> Filter brush
            <span v-if="img.filterMask" class="pa-chip">Partial</span>
          </button>
          <AppButton v-if="img.filterMask" variant="ghost" title="Apply the filter to the whole photo again (undoable)"
                     @click="editor.setFilterMask(img, undefined, 'Clear filter brush')">Clear</AppButton>
        </div>
        <p class="pa-hint">
          {{ hasEffects ? 'Brush the filter away from parts of the photo, or paint it back in.'
                        : 'Apply a filter or adjustment first, then brush it on or off parts of the photo.' }}
        </p>
      </section>

      <!-- Move / Transform -->
      <template v-if="tab === 'transform'">
        <section v-if="img.slotRect" class="space-y-2.5">
          <div class="pa-section">Frame</div>
          <div>
            <div class="pa-label mb-1">Fit to frame</div>
            <AppSegmented :model-value="(img.fit || 'cover') as 'cover' | 'contain'" :options="FIT_OPTIONS" @update:model-value="applyFit" />
          </div>
          <div>
            <div class="pa-label mb-1">Cell aspect ratio</div>
            <div class="flex gap-1">
              <button v-for="a in ASPECTS" :key="a.label" type="button" @click="setCellAspect(a.r)"
                      class="pa-tile flex-1 h-7 text-2xs font-medium tabular-nums">
                {{ a.label }}
              </button>
            </div>
          </div>
          <div class="space-y-2">
            <div class="pa-label">Focal point <span class="text-pebble-text-dim">· keeps the cell filled, no distortion</span></div>
            <AppSlider label="Focus horizontal" :min="0" :max="100" :reset-to="50" :model-value="focusX" unit="%" @update:model-value="v => setFocus('x', v)" />
            <AppSlider label="Focus vertical" :min="0" :max="100" :reset-to="50" :model-value="focusY" unit="%" @update:model-value="v => setFocus('y', v)" />
            <AppSlider label="Cover zoom" :min="100" :max="300" :reset-to="100" :model-value="coverZoomPct" unit="%" @update:model-value="setCoverZoom" />
            <p class="pa-hint">Drag Focus vertical down to keep a face near the top in view.</p>
          </div>
          <AppSlider label="Manual zoom in frame" :min="0" :max="400" :reset-to="100" custom-reset :model-value="frameZoom" unit="%"
                     @update:model-value="setZoom" @reset="resetManualZoom" />
          <button type="button" class="pa-btn w-full" :aria-pressed="editor.cropImageId === img.id"
                  :class="editor.cropImageId === img.id ? '!bg-pebble-accent !border-pebble-accent !text-pebble-on-accent' : ''"
                  @click="toggleCrop">
            <AppIcon :name="editor.cropImageId === img.id ? 'check' : 'crop'" :size="15" />
            {{ editor.cropImageId === img.id ? 'Adjusting inside — click to finish' : 'Adjust photo inside frame' }}
          </button>
          <p class="pa-hint">
            Select a cell to move/resize it. <b class="text-pebble-text">Double-click</b> a photo (or use the button) to pan/zoom the picture <b class="text-pebble-text">inside</b> the frame.
          </p>
        </section>

        <section class="space-y-2">
          <div class="pa-section">Position &amp; size</div>
          <div class="grid grid-cols-2 gap-2">
            <label class="pa-field"><span>X</span><input type="number" v-model.number="img.position.x" @input="img!.manual = true; live()" /></label>
            <label class="pa-field"><span>Y</span><input type="number" v-model.number="img.position.y" @input="img!.manual = true; live()" /></label>
            <label class="pa-field"><span>W</span><input type="number" v-model.number="img.position.width" @input="img!.manual = true; live()" /></label>
            <label class="pa-field"><span>H</span><input type="number" v-model.number="img.position.height" @input="img!.manual = true; live()" /></label>
          </div>
        </section>

        <section class="space-y-2">
          <div class="pa-section">Rotate &amp; flip</div>
          <AppSlider label="Rotation" :min="-180" :max="180" v-model="img.position.rotation" unit="°" @update:model-value="live" />
          <div v-if="!img.slotRect" class="flex gap-2">
            <button type="button" class="pa-btn flex-1" title="Rotate 90° counter-clockwise" @click="rotate90(-1)"><AppIcon name="rotate-ccw" :size="14" /> 90°</button>
            <button type="button" class="pa-btn flex-1" title="Rotate 90° clockwise" @click="rotate90(1)"><AppIcon name="rotate-cw" :size="14" /> 90°</button>
          </div>
          <div class="flex gap-2">
            <button type="button" class="pa-btn flex-1" :class="img.position.flipX ? '!border-pebble-accent !text-pebble-accent-soft' : ''" @click="flip('X')"><AppIcon name="flip-h" :size="14" /> Flip H</button>
            <button type="button" class="pa-btn flex-1" :class="img.position.flipY ? '!border-pebble-accent !text-pebble-accent-soft' : ''" @click="flip('Y')"><AppIcon name="flip-v" :size="14" /> Flip V</button>
          </div>
        </section>

        <section class="space-y-2">
          <div class="pa-section">Opacity</div>
          <AppSlider label="Opacity" :min="0" :max="100" :reset-to="100" :model-value="Math.round(img.opacity*100)" unit="%" @update:model-value="v => { img!.opacity = v/100; live(); }" />
        </section>
      </template>

      <!-- Adjust (light / colour / detail) — all live, PicsArt-style -->
      <template v-else-if="tab === 'adjust'">
        <div class="flex gap-2">
          <button type="button" class="pa-btn flex-1 select-none active:!bg-pebble-accent active:!border-pebble-accent active:!text-pebble-on-accent"
                  title="Press and hold to see the untouched photo"
                  @pointerdown.prevent="compare(true)" @pointerup="compare(false)" @pointerleave="compare(false)">
            <AppIcon name="eye" :size="15" /> Hold to compare
          </button>
          <AppButton variant="ghost" icon="rotate-ccw" title="Reset all adjustments and the filter" @click="resetEffects">Reset</AppButton>
        </div>
        <section class="space-y-2">
          <div class="pa-section">Light</div>
          <AppSlider label="Exposure" :min="-100" :max="100" :model-value="Math.round((img.effects.exposure ?? 0)*100)" @update:model-value="v => { img!.effects.exposure=v/100; liveFx(); }" />
          <AppSlider label="Brightness" :min="-100" :max="100" :model-value="Math.round(img.effects.brightness*100)" @update:model-value="v => { img!.effects.brightness=v/100; liveFx(); }" />
          <AppSlider label="Contrast" :min="-100" :max="100" :model-value="Math.round(img.effects.contrast*100)" @update:model-value="v => { img!.effects.contrast=v/100; liveFx(); }" />
          <AppSlider label="Highlights" :min="-100" :max="100" :model-value="Math.round((img.effects.highlights ?? 0)*100)" @update:model-value="v => { img!.effects.highlights=v/100; liveFx(); }" />
          <AppSlider label="Shadows" :min="-100" :max="100" :model-value="Math.round((img.effects.shadows ?? 0)*100)" @update:model-value="v => { img!.effects.shadows=v/100; liveFx(); }" />
        </section>
        <section class="space-y-2">
          <div class="pa-section">Colour</div>
          <AppSlider label="Saturation" :min="-100" :max="100" :model-value="Math.round(img.effects.saturation*100)" @update:model-value="v => { img!.effects.saturation=v/100; liveFx(); }" />
          <AppSlider label="Temperature" :min="-100" :max="100" :model-value="Math.round((img.effects.temperature ?? 0)*100)" @update:model-value="v => { img!.effects.temperature=v/100; liveFx(); }" />
          <AppSlider label="Tint" :min="-100" :max="100" :model-value="Math.round((img.effects.tint ?? 0)*100)" @update:model-value="v => { img!.effects.tint=v/100; liveFx(); }" />
          <AppSlider label="Hue" :min="-180" :max="180" :model-value="Math.round(img.effects.hue ?? 0)" unit="°" @update:model-value="v => { img!.effects.hue=v; liveFx(); }" />
        </section>
        <section class="space-y-2">
          <div class="pa-section">Detail</div>
          <AppSlider label="Sharpen" :min="0" :max="100" :reset-to="0" :model-value="Math.round(Math.max(0, (img.effects.sharpness ?? 1) - 1)*100)" @update:model-value="v => { img!.effects.sharpness=1+v/100; liveFx(); }" />
          <AppSlider label="Blur" :min="0" :max="20" :reset-to="0" v-model="img.effects.blur" unit="px" @update:model-value="liveFx" />
          <AppSlider label="Grain" :min="0" :max="100" :reset-to="0" :model-value="Math.round(img.effects.noise*100)" @update:model-value="v => { img!.effects.noise=v/100; liveFx(); }" />
          <AppSlider label="Vignette" :min="0" :max="100" :reset-to="0" :model-value="Math.round(img.effects.vignette*100)" @update:model-value="v => { img!.effects.vignette=v/100; liveFx(); }" />
        </section>
      </template>

      <!-- Filters (named presets over YOUR photo, with strength) -->
      <template v-else-if="tab === 'filters'">
        <div class="flex gap-1 flex-wrap">
          <button v-for="c in FILTER_CATS" :key="c.id" type="button" @click="filterCat = c.id" :aria-pressed="filterCat === c.id"
                  :class="['h-6 px-2.5 rounded-full text-2xs font-medium transition-colors',
                           filterCat === c.id ? 'bg-pebble-accent text-pebble-on-accent' : 'bg-pebble-surface-2 text-pebble-text-dim hover:text-pebble-text hover:bg-pebble-hover']">
            {{ c.label }}
          </button>
        </div>
        <div class="grid grid-cols-3 gap-1.5">
          <button v-for="p in visiblePresets" :key="p.id" type="button" @click="setFilter(p.id)"
                  :class="['pa-tile overflow-hidden text-left', img.effects.filter === p.id ? 'is-active' : '']">
            <div class="aspect-square bg-pebble-bg">
              <img v-if="presetThumbs[p.id]" :src="presetThumbs[p.id]" class="w-full h-full object-cover" :alt="p.label" />
            </div>
            <div class="px-1.5 py-1 text-2xs truncate"
                 :class="img.effects.filter === p.id ? 'text-pebble-text font-medium' : ''">{{ p.label }}</div>
          </button>
        </div>
        <AppSlider v-if="img.effects.filter && img.effects.filter !== 'none'"
                   label="Strength" :min="0" :max="100" :reset-to="100" :model-value="filterStrengthPct" unit="%"
                   @update:model-value="v => { img!.effects.filterStrength = v/100; liveFx(); }" />
        <button type="button" class="pa-btn w-full select-none active:!bg-pebble-accent active:!border-pebble-accent active:!text-pebble-on-accent"
                title="Press and hold to see the untouched photo"
                @pointerdown.prevent="compare(true)" @pointerup="compare(false)" @pointerleave="compare(false)">
          <AppIcon name="eye" :size="15" /> Hold to compare
        </button>
      </template>

      <!-- Frame (shape mask + border) -->
      <template v-else-if="tab === 'border'">
        <section class="space-y-1.5">
          <div class="pa-section">Shape mask</div>
          <div class="grid grid-cols-5 gap-1">
            <!-- Previews are drawn from the REAL mask geometry (maskPathData), so every
                 tile has the same weight and shows the shape the photo will get. -->
            <button type="button" @click="setMask(null)" aria-label="No mask"
                    :class="['pa-tile h-9 grid place-items-center', !img.maskId ? 'is-active' : '']"
                    title="No mask">
              <svg width="20" height="20" viewBox="-2 -2 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="-1" y="4" width="22" height="16" /></svg>
            </button>
            <button v-for="m in MASKS" :key="m.id" type="button" @click="setMask(m.id)" :aria-label="m.label"
                    :class="['pa-tile h-9 grid place-items-center', img.maskId === m.id ? 'is-active' : '']"
                    :title="m.label">
              <svg width="20" height="20" viewBox="-1 -4 24 24" fill="currentColor" fill-opacity="0.22" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" aria-hidden="true">
                <path :d="maskPathData(m.id, 22, 16)" />
              </svg>
            </button>
          </div>
          <p v-if="img.maskId" class="pa-hint">Borders and decorative frames trace the mask shape.</p>
        </section>

        <section class="space-y-2.5">
          <div class="pa-section">Border</div>
          <AppButton v-if="!img.border" variant="secondary" icon="plus" block @click="enableBorder">Add border</AppButton>
          <template v-else>
            <!-- Line vs. decorative frame -->
            <AppSegmented :model-value="isPatternBorder ? 'frame' : 'line'" :options="BORDER_KINDS"
                          @update:model-value="v => (v === 'frame' ? useFrameBorder() : useLineBorder())" />

            <!-- LINE border -->
            <template v-if="!isPatternBorder">
              <div>
                <div class="pa-label mb-1">Style</div>
                <AppSegmented :model-value="img.border.style" :options="LINE_STYLES" @update:model-value="v => setLineStyle(v as 'solid')" />
              </div>
              <AppSlider label="Width" :min="0" :max="40" v-model="img.border.width" unit="px" @update:model-value="touch" />
              <AppSlider label="Corner radius" :min="0" :max="120" :reset-to="0" v-model="img.border.radius" unit="px" @update:model-value="touch" />
              <label class="flex items-center justify-between text-xs h-7 cursor-pointer">
                <span>Gradient colour</span>
                <input type="checkbox" :checked="!!img.border.gradient" @change="toggleGradient" />
              </label>
              <template v-if="img.border.gradient">
                <AppColorPicker label="From" v-model="img.border.gradient.from" @update:model-value="touchNow" />
                <AppColorPicker label="To" v-model="img.border.gradient.to" @update:model-value="touchNow" />
                <AppSlider label="Angle" :min="0" :max="360" v-model="img.border.gradient.angle" unit="°" @update:model-value="touch" />
              </template>
              <AppColorPicker v-else label="Colour" v-model="img.border.color" @update:model-value="touchNow" />
            </template>

            <!-- DECORATIVE FRAME border -->
            <template v-else>
              <div>
                <div class="pa-label mb-1">Frame style</div>
                <div class="grid grid-cols-3 gap-1.5">
                  <button v-for="bf in BORDER_FRAMES" :key="bf.id" type="button" @click="pickFrame(bf.id)"
                          :class="['pa-tile px-1 py-2 text-2xs leading-tight', img.border.frameId === bf.id ? 'is-active' : '']">
                    {{ bf.label }}
                  </button>
                </div>
              </div>
              <AppSlider label="Thickness" :min="6" :max="120" v-model="img.border.width" unit="px" @update:model-value="touch" />
              <AppColorPicker label="Colour" v-model="img.border.color" @update:model-value="touchNow" />
            </template>

            <AppButton size="sm" variant="ghost" icon="trash" block @click="img.border = null; touchNow()">Remove border</AppButton>
          </template>
        </section>
      </template>

      <!-- Shadow -->
      <template v-else-if="tab === 'shadow'">
        <section class="space-y-2.5">
          <div class="pa-section">Drop shadow</div>
          <template v-if="!img.shadow">
            <p class="pa-hint">Lift the photo off the page with a soft shadow.</p>
            <AppButton variant="secondary" icon="plus" block @click="enableShadow">Add shadow</AppButton>
          </template>
          <template v-else>
            <AppSlider label="Offset X" :min="-50" :max="50" v-model="img.shadow.offsetX" unit="px" @update:model-value="touch" />
            <AppSlider label="Offset Y" :min="-50" :max="50" :reset-to="8" v-model="img.shadow.offsetY" unit="px" @update:model-value="touch" />
            <AppSlider label="Blur" :min="0" :max="80" :reset-to="24" v-model="img.shadow.blur" unit="px" @update:model-value="touch" />
            <AppColorPicker label="Colour" v-model="img.shadow.color" @update:model-value="touchNow" />
            <AppButton size="sm" variant="ghost" icon="trash" block @click="img.shadow = null; touchNow()">Remove shadow</AppButton>
          </template>
        </section>
      </template>

      <!-- Caption -->
      <template v-else>
        <section class="space-y-1.5">
          <div class="pa-section">Caption</div>
          <label class="block">
            <span class="pa-label block mb-1">Caption text</span>
            <input v-model="img.caption" class="pa-input w-full" placeholder="A lovely moment" @input="project.markDirty()" />
          </label>
        </section>
      </template>
    </div>
  </div>
</template>

<style scoped>
/* Inline-labelled number field: the axis letter sits inside the input well. */
.pa-field {
  @apply flex items-center h-8 rounded-md border border-pebble-border bg-pebble-bg transition-colors
         hover:border-pebble-border-strong focus-within:border-pebble-accent focus-within:ring-1 focus-within:ring-pebble-accent;
}
.pa-field > span { @apply w-7 shrink-0 text-center text-2xs font-medium text-pebble-text-dim; }
.pa-field > input {
  @apply flex-1 min-w-0 h-full bg-transparent pr-2 text-xs tabular-nums text-pebble-text outline-none;
}
</style>
