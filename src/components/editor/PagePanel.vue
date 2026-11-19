<script setup lang="ts">
/**
 * PagePanel.vue — Right sidebar when nothing is selected. Page-centric controls:
 *   • Background colour, fit-all (cover/contain), re-generate album.
 *   • Layering: the page's placed photos top→bottom with ↑/↓ to change z-index
 *     (which photo sits on top), and click to select.
 *   • Not placed: photos assigned to this page but not in the layout — click to add.
 *   • ＋ Add photo (PicsArt-style): pick image file(s) from disk; each lands on the
 *     page as a FREE overlay photo (move / resize / rotate / erase). Undoable.
 * (The old right-side "All images" browser was removed; use the bottom Images tab.)
 *
 * `variant` (optional, default 'album'): 'photo' is the Pixart photo editor,
 * whose page IS one photo — it hides the album-only controls that would break
 * that model (Layout tab: re-slotting the base photo into a template; the
 * Slideshow settings; the page-strip tip). Everything else is shared unchanged.
 */
import { ref, reactive, computed, watch, onMounted } from 'vue';
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { boxForFit, coverBox } from '@/engine/collageComposer';
import { useAddPhoto } from '@/composables/useAddPhoto';
import { getLayout } from '@/engine/layoutSelector';
import type { PageImage, ImageRecord } from '@shared/pebble.types';
import AppColorPicker from '@/components/ui/AppColorPicker.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppDropdown from '@/components/ui/AppDropdown.vue';
import AppSlider from '@/components/ui/AppSlider.vue';
import { PATTERNS } from '@/engine/decoEngine';
import LayoutPicker from '@/components/editor/LayoutPicker.vue';
import DecorationPanel from '@/components/editor/DecorationPanel.vue';
import ProverbPanel from '@/components/editor/ProverbPanel.vue';

const project = useProjectStore();
const editor = useEditorStore();
const page = computed(() => project.pages[editor.activePageIndex]);

const props = withDefaults(defineProps<{ variant?: 'album' | 'photo' }>(), { variant: 'album' });
const isAlbum = computed(() => props.variant === 'album');

type PageTab = 'layers' | 'layout' | 'design' | 'proverb' | 'settings';
const tab = ref<PageTab>('layers');
const ALL_TABS: { id: PageTab; label: string }[] = [
  { id: 'layers', label: 'Layers' },
  { id: 'layout', label: 'Layout' },
  { id: 'design', label: 'Design' },
  { id: 'proverb', label: 'Proverb' },
  { id: 'settings', label: 'Page' },
];
const tabs = computed(() => (isAlbum.value ? ALL_TABS : ALL_TABS.filter((t) => t.id !== 'layout')));

const recByPath = computed(() => {
  const m = new Map<string, ImageRecord>();
  for (const r of project.images) m.set(r.relativePath, r);
  return m;
});
const placedTopFirst = computed(() => (page.value?.images ?? []).filter((i) => i.visible).slice().sort((a, b) => b.zIndex - a.zIndex));
const notPlaced = computed(() => (page.value?.images ?? []).filter((i) => !i.visible));

// Thumbnails (base64).
const thumbs = reactive<Record<string, string>>({});
function ensureThumb(pi: PageImage) {
  const path = recByPath.value.get(pi.filename)?.thumbnailPath;
  if (!path || thumbs[path]) return;
  window.pebble.readImageBase64(path).then((d) => { thumbs[path] = d; }).catch(() => {});
}
const src = (pi: PageImage) => thumbs[recByPath.value.get(pi.filename)?.thumbnailPath ?? ''] ?? '';
watch([placedTopFirst, notPlaced], () => { placedTopFirst.value.forEach(ensureThumb); notPlaced.value.forEach(ensureThumb); }, { immediate: true });

/** Give every visible image a unique, gap-free z-index so ordering is reliable
 *  and the canvas (which renders by ascending z-index) always matches this list. */
function normalize() {
  if (!page.value) return;
  page.value.images.filter((i) => i.visible).sort((a, b) => a.zIndex - b.zIndex).forEach((im, idx) => { im.zIndex = idx; });
}
onMounted(normalize);
watch(() => editor.activePageIndex, normalize);

/**
 * Drag-to-reorder the layers list. Moves the dragged photo to the drop slot in
 * the front→back order and reassigns sequential z-indices (front = highest), so
 * the canvas (which draws by ascending z-index) always matches the list.
 */
const dragIndex = ref<number | null>(null);
const overIndex = ref<number | null>(null);
function dropReorder(to: number) {
  const from = dragIndex.value;
  dragIndex.value = null; overIndex.value = null;
  if (from === null || from === to) return;
  const order = placedTopFirst.value.slice(); // front→back
  const [moved] = order.splice(from, 1);
  order.splice(to, 0, moved);
  const n = order.length;
  order.forEach((im, idx) => { im.zIndex = n - 1 - idx; });
  project.markDirty(); editor.requestRender();
}

function setBg(color: string) { if (page.value) { page.value.backgroundColor = color; project.markDirty(); editor.requestRender(); } }

/** Per-page slideshow dwell time; empty input returns to the album default. */
function setPageDuration(raw: string) {
  if (!page.value) return;
  const v = Number(raw);
  if (!raw || Number.isNaN(v) || v <= 0) page.value.durationSec = undefined;
  else page.value.durationSec = Math.min(60, Math.max(1, v));
  project.markDirty();
}

const TEXTURE_PATTERNS = [{ value: '', label: 'None' }, ...PATTERNS.filter((p) => p.type === 'canvas_draw').map((p) => ({ value: p.id, label: p.label }))];
function toggleBgGradient(on: boolean) {
  if (!page.value) return;
  page.value.backgroundGradient = on
    ? { from: page.value.backgroundColor || '#ffffff', to: project.theme?.colors.accent || '#cccccc', angle: 135 }
    : undefined;
  project.markDirty(); editor.requestRender();
}
function setBgGradient(part: 'from' | 'to' | 'angle', val: string | number) {
  if (!page.value) return;
  const g = page.value.backgroundGradient ?? { from: '#ffffff', to: '#cccccc', angle: 135 };
  page.value.backgroundGradient = { ...g, [part]: val } as { from: string; to: string; angle: number };
  project.markDirty(); editor.requestRender();
}
function setBgPattern(id: string | number) { if (page.value) { page.value.backgroundPattern = String(id) || undefined; project.markDirty(); editor.requestRender(); } }

function fitAll(mode: 'cover' | 'contain') {
  if (!page.value) return;
  for (const pi of page.value.images) {
    if (!pi.slotRect) continue;
    pi.fit = mode; pi.manual = false; // auto re-fit + re-centre to the chosen mode
  }
  project.markDirty(); editor.requestRender();
}

function placeExisting(pi: PageImage) {
  if (!page.value || !project.meta) return;
  const layout = getLayout(page.value.layoutId) ?? getLayout('grid_4_equal')!;
  const used = new Set(placedTopFirst.value.map((i) => i.slotId));
  const slot = layout.slots.find((s) => !used.has(s.id));
  const m = project.meta;
  const rec = recByPath.value.get(pi.filename);
  if (slot) {
    const frame = { x: slot.x * m.albumWidth, y: slot.y * m.albumHeight, width: slot.w * m.albumWidth, height: slot.h * m.albumHeight };
    const box = coverBox(frame, rec?.width ?? frame.width, rec?.height ?? frame.height);
    pi.slotId = slot.id; pi.slotRect = frame; pi.free = false;
    pi.position = { x: box.x, y: box.y, width: box.width, height: box.height, rotation: slot.rotation ?? 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false };
  } else {
    const w = m.albumWidth * 0.3; const ar = rec && rec.height ? rec.width / rec.height : 1.5;
    pi.free = true; pi.slotId = 'free'; pi.slotRect = undefined;
    pi.position = { x: m.albumWidth / 2 - w / 2, y: m.albumHeight / 2 - (w / ar) / 2, width: w, height: w / ar, rotation: 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false };
  }
  pi.visible = true;
  project.markDirty(); editor.requestRender();
}

/**
 * ＋ Add photo: the shared implementation lives in `composables/useAddPhoto`
 * (dialog → registry → FREE overlay on top, centred + staggered, undoable,
 * selected after the rebuild, locked-page / error toasts). PixartView's header
 * button calls the very same function, so there is ONE add-photo behaviour.
 */
const { adding, addPhotos } = useAddPhoto();

// (Re-generate album moved to the bottom album bar — it's an album-wide action.)
</script>

<template>
  <div v-if="page" class="flex flex-col h-full">
    <div class="px-3 py-2 border-b border-pebble-border">
      <template v-if="isAlbum">
        <div class="text-xs text-pebble-text-dim">Page {{ editor.activePageIndex + 1 }} of {{ project.pages.length }}</div>
        <div class="text-sm capitalize">{{ page.type.replace('_', ' ') }} · {{ placedTopFirst.length }} photos</div>
      </template>
      <template v-else>
        <div class="text-xs text-pebble-text-dim">Photo</div>
        <div class="text-sm">{{ placedTopFirst.length }} layer{{ placedTopFirst.length === 1 ? '' : 's' }}</div>
      </template>
    </div>

    <!-- Per-page editing tabs -->
    <nav class="flex text-[11px] border-b border-pebble-border">
      <button v-for="t in tabs" :key="t.id" @click="tab = t.id"
              :class="['flex-1 py-2', tab === t.id ? 'text-pebble-accent border-b-2 border-pebble-accent' : 'text-pebble-text-dim hover:text-pebble-text']">
        {{ t.label }}
      </button>
    </nav>

    <div class="flex-1 overflow-auto text-sm">
      <!-- LAYERS -->
      <div v-if="tab === 'layers'" class="p-3 space-y-4">
        <AppButton block :disabled="adding || page.locked" :title="page.locked ? 'Page is locked' : 'Add photos from your computer as free overlays'" @click="addPhotos">
          {{ adding ? 'Adding…' : '＋ Add photo' }}
        </AppButton>
        <div>
          <div class="text-[11px] uppercase tracking-wider text-pebble-text-dim mb-1">Layers (top → bottom)</div>
          <p class="text-[10px] text-pebble-text-dim mb-1">Click to highlight on the page · drag to reorder · ✎ to edit.</p>
          <div class="space-y-1">
            <div v-for="(pi, i) in placedTopFirst" :key="pi.id"
                 draggable="true"
                 @dragstart="dragIndex = i" @dragover.prevent="overIndex = i" @drop="dropReorder(i)" @dragend="dragIndex = null; overIndex = null"
                 class="flex items-center gap-2 rounded bg-pebble-bg p-1 cursor-pointer hover:bg-white/5 transition"
                 :class="[editor.selectedObjectId === pi.id ? 'ring-1 ring-pebble-accent' : '', overIndex === i && dragIndex !== null ? 'ring-2 ring-pebble-accent/70' : '']"
                 @click="editor.requestSelect(pi.id, false)">
              <span class="text-pebble-text-dim/60 text-xs cursor-grab active:cursor-grabbing" title="Drag to reorder">⠿</span>
              <img v-if="src(pi)" :src="src(pi)" class="h-9 w-9 rounded object-cover pointer-events-none" />
              <div v-else class="h-9 w-9 rounded bg-pebble-surface-2 animate-pulse" />
              <span class="flex-1 truncate text-[11px]">{{ pi.filename }}</span>
              <button class="px-1.5 py-1 rounded text-pebble-text-dim hover:text-pebble-accent hover:bg-white/5" title="Edit photo" @click.stop="editor.requestSelect(pi.id, true)">✎</button>
            </div>
            <div v-if="!placedTopFirst.length" class="text-[11px] text-pebble-text-dim">No photos placed.</div>
          </div>
        </div>
        <div v-if="notPlaced.length">
          <div class="text-[11px] uppercase tracking-wider text-amber-300/80 mb-1">Not placed ({{ notPlaced.length }}) — click to add</div>
          <div class="grid grid-cols-4 gap-1.5">
            <button v-for="pi in notPlaced" :key="pi.id" class="relative rounded overflow-hidden aspect-square ring-1 ring-amber-400/40" @click="placeExisting(pi)" :title="pi.filename">
              <img v-if="src(pi)" :src="src(pi)" class="w-full h-full object-cover opacity-80" />
              <div v-else class="w-full h-full bg-pebble-surface-2 animate-pulse" />
            </button>
          </div>
        </div>
      </div>

      <!-- LAYOUT (per-page) -->
      <LayoutPicker v-else-if="tab === 'layout'" />

      <!-- DESIGN: patterns + stickers (per-page) -->
      <DecorationPanel v-else-if="tab === 'design'" />

      <!-- PROVERB (per-page) -->
      <ProverbPanel v-else-if="tab === 'proverb'" />

      <!-- PAGE SETTINGS -->
      <div v-else class="p-3 space-y-3">
        <AppColorPicker label="Background" :model-value="page.backgroundColor || '#ffffff'" @update:model-value="setBg" />
        <label class="flex items-center justify-between text-xs py-0.5">
          <span>Gradient background</span>
          <input type="checkbox" :checked="!!page.backgroundGradient" @change="toggleBgGradient(($event.target as HTMLInputElement).checked)" />
        </label>
        <template v-if="page.backgroundGradient">
          <AppColorPicker label="From" :model-value="page.backgroundGradient.from" @update:model-value="v => setBgGradient('from', v)" />
          <AppColorPicker label="To" :model-value="page.backgroundGradient.to" @update:model-value="v => setBgGradient('to', v)" />
          <AppSlider label="Angle" :min="0" :max="360" :model-value="page.backgroundGradient.angle" unit="°" @update:model-value="v => setBgGradient('angle', v)" />
        </template>
        <AppDropdown label="Texture" :model-value="page.backgroundPattern || ''" :options="TEXTURE_PATTERNS" @update:model-value="setBgPattern" />
        <div>
          <div class="text-xs text-pebble-text-dim mb-1">Fit all photos</div>
          <div class="flex gap-2">
            <AppButton size="sm" variant="secondary" @click="fitAll('cover')">Cover</AppButton>
            <AppButton size="sm" variant="secondary" @click="fitAll('contain')">Contain</AppButton>
          </div>
        </div>
        <div v-if="isAlbum" class="pt-2 border-t border-pebble-border space-y-2">
          <div class="text-[11px] uppercase tracking-wider text-pebble-text-dim">Slideshow</div>
          <label class="text-xs block">This page stays on screen (seconds)
            <div class="flex items-center gap-2 mt-1">
              <input type="number" min="1" max="60" step="0.5" class="pa-input w-24 py-1"
                     :value="page.durationSec ?? ''" :placeholder="String(project.meta?.slideshowInterval ?? 4)"
                     @input="setPageDuration(($event.target as HTMLInputElement).value)" />
              <button v-if="page.durationSec" class="text-[10px] text-pebble-text-dim hover:text-pebble-text underline"
                      @click="setPageDuration('')">use default ({{ project.meta?.slideshowInterval ?? 4 }}s)</button>
            </div>
          </label>
          <AppDropdown label="Turn style" :model-value="project.meta?.pageTurnStyle || 'curl'"
            :options="[{value:'curl',label:'Page curl (realistic)'},{value:'slide',label:'Slide'},{value:'push',label:'Push'},{value:'fade',label:'Fade'},{value:'zoom',label:'Zoom'},{value:'flip_up',label:'Flip up'},{value:'hard',label:'Hard flip'}]"
            @update:model-value="v => { if (project.meta) { project.meta.pageTurnStyle = v as any; project.markDirty(); } }" />
          <AppDropdown label="Speed" :model-value="project.meta?.pageTurnSpeed || 'normal'"
            :options="[{value:'slow',label:'Slow'},{value:'normal',label:'Normal'},{value:'fast',label:'Fast'}]"
            @update:model-value="v => { if (project.meta) { project.meta.pageTurnSpeed = v as any; project.markDirty(); } }" />
        </div>
        <p v-if="isAlbum" class="text-[10px] text-pebble-text-dim">Tip: right-click a page in the left strip for Duplicate / Lock / Delete.</p>
      </div>
    </div>
  </div>
</template>
