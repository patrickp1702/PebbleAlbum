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
import { defaultEffects, boxForFit } from '@/engine/collageComposer';
import { BORDER_FRAMES } from '@/engine/borderFrames';
import { FILTER_PRESETS } from '@/engine/fabricFilters';
import { MASKS } from '@/engine/maskShapes';
import { generatePresetThumbs } from '@/engine/presetThumbs';
import { loadImageDataUrl } from '@/engine/imageLoader';
import type { MaskId } from '@shared/pebble.types';

const project = useProjectStore();
const editor = useEditorStore();
const tab = ref<'transform' | 'adjust' | 'filters' | 'border' | 'shadow' | 'caption'>('transform');
const TABS = [
  { id: 'transform', label: 'Move' },
  { id: 'adjust', label: 'Adjust' },
  { id: 'filters', label: 'Filters' },
  { id: 'border', label: 'Frame' },
  { id: 'shadow', label: 'Shadow' },
  { id: 'caption', label: 'Caption' },
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
    <div class="px-3 py-2 border-b border-pebble-border flex items-center gap-2">
      <button class="shrink-0 h-7 px-2 rounded bg-pebble-surface-2 border border-pebble-border text-xs hover:border-pebble-accent"
              title="Back to page settings" @click="back">‹ Back</button>
      <div class="min-w-0">
        <div class="text-xs text-pebble-text-dim">Selected image</div>
        <div class="text-sm truncate">{{ img.filename }}</div>
      </div>
    </div>

    <nav class="flex text-2xs border-b border-pebble-border">
      <button v-for="t in TABS" :key="t.id"
              @click="tab = t.id"
              :class="['flex-1 py-2', tab === t.id ? 'text-pebble-accent border-b-2 border-pebble-accent' : 'text-pebble-text-dim']">
        {{ t.label }}
      </button>
    </nav>

    <div class="flex-1 overflow-auto p-3 space-y-3 text-sm">
      <!-- Move / Transform -->
      <template v-if="tab === 'transform'">
        <div v-if="img.slotRect" class="space-y-2 pb-2 border-b border-pebble-border">
          <div>
            <div class="text-xs text-pebble-text-dim mb-1">Fit to frame</div>
            <div class="flex rounded bg-pebble-bg p-0.5 text-2xs">
              <button v-for="m in (['cover','contain'] as const)" :key="m" @click="applyFit(m)"
                      :class="['flex-1 py-1 rounded capitalize', (img.fit || 'cover') === m ? 'bg-pebble-accent text-white' : 'text-pebble-text-dim']">{{ m === 'cover' ? 'Fill frame' : 'Fit whole' }}</button>
            </div>
          </div>
          <div>
            <div class="text-xs text-pebble-text-dim mb-1">Cell aspect ratio</div>
            <div class="flex gap-1">
              <button v-for="a in ASPECTS" :key="a.label" @click="setCellAspect(a.r)"
                      class="flex-1 py-1 rounded text-2xs bg-pebble-surface-2 border border-pebble-border text-pebble-text-dim hover:border-pebble-accent hover:text-pebble-text">
                {{ a.label }}
              </button>
            </div>
          </div>
          <div class="pt-1">
            <div class="text-xs text-pebble-text-dim mb-1">Focal point (keeps the cell filled, no distortion)</div>
            <AppSlider label="Focus ↔" :min="0" :max="100" :model-value="focusX" unit="%" @update:model-value="v => setFocus('x', v)" />
            <AppSlider label="Focus ↕" :min="0" :max="100" :model-value="focusY" unit="%" @update:model-value="v => setFocus('y', v)" />
            <AppSlider label="Cover zoom" :min="100" :max="300" :model-value="coverZoomPct" unit="%" @update:model-value="setCoverZoom" />
            <p class="text-2xs text-pebble-text-dim">Drag Focus ↕ down to keep a face near the top in view.</p>
          </div>
          <AppSlider label="Manual zoom in frame" :min="0" :max="400" :model-value="frameZoom" unit="%"
                     @update:model-value="setZoom" />
          <button class="w-full py-1.5 rounded text-xs font-medium"
                  :class="editor.cropImageId === img.id ? 'bg-pebble-accent text-white' : 'bg-pebble-surface-2 border border-pebble-border text-pebble-text'"
                  @click="toggleCrop">
            {{ editor.cropImageId === img.id ? '✓ Adjusting inside — click to finish' : '✥ Adjust photo inside frame' }}
          </button>
          <p class="text-2xs text-pebble-text-dim">
            Select a cell to move/resize it. <b>Double-click</b> a photo (or use the button) to pan/zoom the picture <b>inside</b> the frame.
          </p>
        </div>
        <div class="grid grid-cols-2 gap-2">
          <label class="text-xs">X<input type="number" v-model.number="img.position.x" class="pa-input w-full py-1" @input="img!.manual = true; live()" /></label>
          <label class="text-xs">Y<input type="number" v-model.number="img.position.y" class="pa-input w-full py-1" @input="img!.manual = true; live()" /></label>
          <label class="text-xs">W<input type="number" v-model.number="img.position.width" class="pa-input w-full py-1" @input="img!.manual = true; live()" /></label>
          <label class="text-xs">H<input type="number" v-model.number="img.position.height" class="pa-input w-full py-1" @input="img!.manual = true; live()" /></label>
        </div>
        <AppSlider label="Rotation" :min="-180" :max="180" v-model="img.position.rotation" unit="°" @update:model-value="live" />
        <div v-if="!img.slotRect" class="flex gap-2">
          <AppButton size="sm" variant="secondary" block @click="rotate90(-1)">↺ 90°</AppButton>
          <AppButton size="sm" variant="secondary" block @click="rotate90(1)">↻ 90°</AppButton>
        </div>
        <AppSlider label="Opacity" :min="0" :max="100" :model-value="Math.round(img.opacity*100)" unit="%" @update:model-value="v => { img!.opacity = v/100; live(); }" />
        <div class="flex gap-2">
          <AppButton size="sm" variant="secondary" block @click="flip('X')">⇋ Flip H</AppButton>
          <AppButton size="sm" variant="secondary" block @click="flip('Y')">⇵ Flip V</AppButton>
        </div>
        <div class="flex gap-2">
          <AppButton size="sm" block @click="editor.openCutout(img.filename, img.id)">✎ Erase / restore parts</AppButton>
          <AppButton v-if="img.eraseMask" size="sm" variant="ghost" title="Show the whole photo again (undoable)"
                     @click="editor.setEraseMask(img, undefined, 'Clear erasing')">Clear erasing</AppButton>
        </div>
        <p class="text-2xs text-pebble-text-dim -mt-1">Brush away parts of this photo right on the page to blend it in (soft edges, any opacity) — and paint them back anytime; the original is kept. Also: AI background removal, save as sticker.</p>
      </template>

      <!-- Adjust (light / colour / detail) — all live, PicsArt-style -->
      <template v-else-if="tab === 'adjust'">
        <div class="flex gap-2">
          <button class="flex-1 py-1.5 rounded text-xs bg-pebble-surface-2 border border-pebble-border select-none active:bg-pebble-accent active:text-white"
                  @pointerdown.prevent="compare(true)" @pointerup="compare(false)" @pointerleave="compare(false)">
            👁 Hold to compare
          </button>
          <AppButton size="sm" variant="ghost" @click="resetEffects">Reset</AppButton>
        </div>
        <div class="text-2xs uppercase tracking-wider text-pebble-text-dim pt-1">Light</div>
        <AppSlider label="Exposure" :min="-100" :max="100" :model-value="Math.round((img.effects.exposure ?? 0)*100)" @update:model-value="v => { img!.effects.exposure=v/100; liveFx(); }" />
        <AppSlider label="Brightness" :min="-100" :max="100" :model-value="Math.round(img.effects.brightness*100)" @update:model-value="v => { img!.effects.brightness=v/100; liveFx(); }" />
        <AppSlider label="Contrast" :min="-100" :max="100" :model-value="Math.round(img.effects.contrast*100)" @update:model-value="v => { img!.effects.contrast=v/100; liveFx(); }" />
        <AppSlider label="Highlights" :min="-100" :max="100" :model-value="Math.round((img.effects.highlights ?? 0)*100)" @update:model-value="v => { img!.effects.highlights=v/100; liveFx(); }" />
        <AppSlider label="Shadows" :min="-100" :max="100" :model-value="Math.round((img.effects.shadows ?? 0)*100)" @update:model-value="v => { img!.effects.shadows=v/100; liveFx(); }" />
        <div class="text-2xs uppercase tracking-wider text-pebble-text-dim pt-1">Colour</div>
        <AppSlider label="Saturation" :min="-100" :max="100" :model-value="Math.round(img.effects.saturation*100)" @update:model-value="v => { img!.effects.saturation=v/100; liveFx(); }" />
        <AppSlider label="Temperature" :min="-100" :max="100" :model-value="Math.round((img.effects.temperature ?? 0)*100)" @update:model-value="v => { img!.effects.temperature=v/100; liveFx(); }" />
        <AppSlider label="Tint" :min="-100" :max="100" :model-value="Math.round((img.effects.tint ?? 0)*100)" @update:model-value="v => { img!.effects.tint=v/100; liveFx(); }" />
        <AppSlider label="Hue" :min="-180" :max="180" :model-value="Math.round(img.effects.hue ?? 0)" unit="°" @update:model-value="v => { img!.effects.hue=v; liveFx(); }" />
        <div class="text-2xs uppercase tracking-wider text-pebble-text-dim pt-1">Detail</div>
        <AppSlider label="Sharpen" :min="0" :max="100" :model-value="Math.round(Math.max(0, (img.effects.sharpness ?? 1) - 1)*100)" @update:model-value="v => { img!.effects.sharpness=1+v/100; liveFx(); }" />
        <AppSlider label="Blur" :min="0" :max="20" v-model="img.effects.blur" unit="px" @update:model-value="liveFx" />
        <AppSlider label="Grain" :min="0" :max="100" :model-value="Math.round(img.effects.noise*100)" @update:model-value="v => { img!.effects.noise=v/100; liveFx(); }" />
        <AppSlider label="Vignette" :min="0" :max="100" :model-value="Math.round(img.effects.vignette*100)" @update:model-value="v => { img!.effects.vignette=v/100; liveFx(); }" />
      </template>

      <!-- Filters (named presets over YOUR photo, with strength) -->
      <template v-else-if="tab === 'filters'">
        <div class="flex gap-1 flex-wrap">
          <button v-for="c in FILTER_CATS" :key="c.id" @click="filterCat = c.id"
                  :class="['px-2 py-0.5 rounded-full text-2xs', filterCat === c.id ? 'bg-pebble-accent text-white' : 'bg-pebble-surface-2 text-pebble-text-dim']">
            {{ c.label }}
          </button>
        </div>
        <div class="grid grid-cols-3 gap-1.5">
          <button v-for="p in visiblePresets" :key="p.id" @click="setFilter(p.id)"
                  :class="['rounded-lg overflow-hidden border text-left', img.effects.filter === p.id ? 'border-pebble-accent ring-1 ring-pebble-accent' : 'border-pebble-border hover:border-pebble-accent/50']">
            <div class="aspect-square bg-pebble-bg">
              <img v-if="presetThumbs[p.id]" :src="presetThumbs[p.id]" class="w-full h-full object-cover" :alt="p.label" />
            </div>
            <div class="px-1 py-0.5 text-2xs truncate"
                 :class="img.effects.filter === p.id ? 'text-pebble-accent' : 'text-pebble-text-dim'">{{ p.label }}</div>
          </button>
        </div>
        <AppSlider v-if="img.effects.filter && img.effects.filter !== 'none'"
                   label="Strength" :min="0" :max="100" :model-value="filterStrengthPct" unit="%"
                   @update:model-value="v => { img!.effects.filterStrength = v/100; liveFx(); }" />
        <div class="flex gap-2">
          <button class="flex-1 py-1.5 rounded text-xs bg-pebble-surface-2 border border-pebble-border select-none active:bg-pebble-accent active:text-white"
                  @pointerdown.prevent="compare(true)" @pointerup="compare(false)" @pointerleave="compare(false)">
            👁 Hold to compare
          </button>
        </div>
      </template>

      <!-- Frame (shape mask + border) -->
      <template v-else-if="tab === 'border'">
        <div>
          <div class="text-xs text-pebble-text-dim mb-1">Shape mask</div>
          <div class="grid grid-cols-5 gap-1">
            <button @click="setMask(null)"
                    :class="['rounded border py-1.5 text-[13px] leading-none', !img.maskId ? 'border-pebble-accent bg-pebble-accent/10' : 'border-pebble-border hover:border-pebble-accent/50']"
                    title="No mask">▭</button>
            <button v-for="m in MASKS" :key="m.id" @click="setMask(m.id)"
                    :class="['rounded border py-1.5 text-[13px] leading-none', img.maskId === m.id ? 'border-pebble-accent bg-pebble-accent/10' : 'border-pebble-border hover:border-pebble-accent/50']"
                    :title="m.label">{{ m.glyph }}</button>
          </div>
          <p v-if="img.maskId" class="text-2xs text-pebble-text-dim mt-1">Borders and decorative frames trace the mask shape.</p>
        </div>

        <div class="border-t border-pebble-border pt-2">
          <AppButton v-if="!img.border" size="sm" block @click="enableBorder">Add border</AppButton>
          <template v-else>
            <!-- Line vs. decorative frame -->
            <div class="flex rounded bg-pebble-bg p-0.5 text-2xs">
              <button @click="useLineBorder" :class="['flex-1 py-1 rounded', !isPatternBorder ? 'bg-pebble-accent text-white' : 'text-pebble-text-dim']">Line</button>
              <button @click="useFrameBorder" :class="['flex-1 py-1 rounded', isPatternBorder ? 'bg-pebble-accent text-white' : 'text-pebble-text-dim']">Decorative frame</button>
            </div>

            <!-- LINE border -->
            <template v-if="!isPatternBorder">
              <div>
                <div class="text-xs text-pebble-text-dim mb-1">Style</div>
                <div class="flex rounded bg-pebble-bg p-0.5 text-2xs">
                  <button v-for="s in (['solid','dashed','dotted','double'] as const)" :key="s" @click="setLineStyle(s)"
                          :class="['flex-1 py-1 rounded capitalize', img.border.style === s ? 'bg-pebble-accent text-white' : 'text-pebble-text-dim']">{{ s }}</button>
                </div>
              </div>
              <AppSlider label="Width" :min="0" :max="40" v-model="img.border.width" unit="px" @update:model-value="touch" />
              <AppSlider label="Corner radius" :min="0" :max="120" v-model="img.border.radius" unit="px" @update:model-value="touch" />
              <label class="flex items-center justify-between text-xs py-0.5">
                <span>Gradient colour</span>
                <input type="checkbox" :checked="!!img.border.gradient" @change="toggleGradient" />
              </label>
              <template v-if="img.border.gradient">
                <AppColorPicker label="From" v-model="img.border.gradient.from" @update:model-value="touchNow" />
                <AppColorPicker label="To" v-model="img.border.gradient.to" @update:model-value="touchNow" />
                <AppSlider label="Angle" :min="0" :max="360" v-model="img.border.gradient.angle" unit="°" @update:model-value="touch" />
              </template>
              <AppColorPicker v-else label="Color" v-model="img.border.color" @update:model-value="touchNow" />
            </template>

            <!-- DECORATIVE FRAME border -->
            <template v-else>
              <div>
                <div class="text-xs text-pebble-text-dim mb-1">Frame style</div>
                <div class="grid grid-cols-3 gap-1.5">
                  <button v-for="bf in BORDER_FRAMES" :key="bf.id" @click="pickFrame(bf.id)"
                          :class="['rounded border px-1 py-2 text-2xs leading-tight', img.border.frameId === bf.id ? 'border-pebble-accent bg-pebble-accent/10' : 'border-pebble-border hover:border-pebble-accent/50']">
                    {{ bf.label }}
                  </button>
                </div>
              </div>
              <AppSlider label="Thickness" :min="6" :max="120" v-model="img.border.width" unit="px" @update:model-value="touch" />
              <AppColorPicker label="Color" v-model="img.border.color" @update:model-value="touchNow" />
            </template>

            <AppButton size="sm" variant="ghost" block @click="img.border = null; touchNow()">Remove border</AppButton>
          </template>
        </div>
      </template>

      <!-- Shadow -->
      <template v-else-if="tab === 'shadow'">
        <AppButton v-if="!img.shadow" size="sm" block @click="enableShadow">Add shadow</AppButton>
        <template v-else>
          <AppSlider label="Offset X" :min="-50" :max="50" v-model="img.shadow.offsetX" @update:model-value="touch" />
          <AppSlider label="Offset Y" :min="-50" :max="50" v-model="img.shadow.offsetY" @update:model-value="touch" />
          <AppSlider label="Blur" :min="0" :max="80" v-model="img.shadow.blur" @update:model-value="touch" />
          <AppColorPicker label="Color" v-model="img.shadow.color" @update:model-value="touchNow" />
          <AppButton size="sm" variant="ghost" block @click="img.shadow = null; touchNow()">Remove shadow</AppButton>
        </template>
      </template>

      <!-- Caption -->
      <template v-else>
        <label class="text-xs block">Caption text
          <input v-model="img.caption" class="pa-input w-full mt-1 py-1" placeholder="A lovely moment" @input="project.markDirty()" />
        </label>
      </template>
    </div>
  </div>
</template>
