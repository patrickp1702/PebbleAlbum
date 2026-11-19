<script setup lang="ts">
/**
 * ImageStrip.vue — Bottom "Images" panel: a horizontal, scrollable strip of
 * EVERY source image.
 *  • Click an image → jump to the page it's mapped to (and select it there).
 *  • Drag an image → drop it on a page (left strip) or the canvas to place/move
 *    it. Images already on a page can be dragged to another page to move them.
 *  • Filter: All / Unused, and a search box.
 */
import { ref, reactive, computed, watch } from 'vue';
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { useAppStore } from '@/stores/appStore';
import { setMovePayload } from '@/engine/dragMove';
import type { ImageRecord } from '@shared/pebble.types';
import AppIcon from '@/components/ui/AppIcon.vue';
import AppSegmented from '@/components/ui/AppSegmented.vue';

const project = useProjectStore();
const editor = useEditorStore();
const app = useAppStore();
const query = ref('');
const filter = ref<'all' | 'unused'>('all');
const FILTERS = [{ value: 'all', label: 'All' }, { value: 'unused', label: 'Unused' }] as const;

const list = computed<ImageRecord[]>(() => {
  const q = query.value.toLowerCase();
  return project.images.filter((r) =>
    !r.skipped
    && (filter.value === 'all' || r.usedOnPages.length === 0)
    && (!q || r.filename.toLowerCase().includes(q)));
});

const thumbs = reactive<Record<string, string>>({});
watch(list, (l) => l.forEach((r) => {
  if (r.thumbnailPath && !thumbs[r.thumbnailPath]) {
    window.pebble.readImageBase64(r.thumbnailPath).then((d) => { thumbs[r.thumbnailPath] = d; }).catch(() => {});
  }
}), { immediate: true });

/** Page index where this image first appears (or -1). */
function pageIndexOf(rec: ImageRecord): number {
  if (!rec.usedOnPages.length) return -1;
  return project.pages.findIndex((p) => p.id === rec.usedOnPages[0]);
}

/** Click → open the page the image is on and select it. */
function openImage(rec: ImageRecord) {
  const idx = pageIndexOf(rec);
  if (idx < 0) { app.toast('This image is not placed on any page yet — drag it onto a page.', 'info', 2500); return; }
  editor.setPage(idx);
  const page = project.pages[idx];
  const pi = page.images.find((i) => i.filename === rec.relativePath && i.visible);
  if (pi) setTimeout(() => editor.requestSelect(pi.id), 60);
}

function onDragStart(e: DragEvent, rec: ImageRecord) {
  // No source page id → dropping just assigns it to the target page.
  setMovePayload(e, { filename: rec.relativePath });
}
</script>

<template>
  <div class="h-full flex flex-col">
    <div class="flex items-center gap-3 px-3 h-10 border-b border-pebble-border shrink-0">
      <AppSegmented v-model="filter" :options="FILTERS" class="w-36 shrink-0" />
      <label class="relative flex-1 max-w-xs min-w-0">
        <AppIcon name="search" :size="14" class="absolute left-2 top-1/2 -translate-y-1/2 text-pebble-text-dim pointer-events-none" />
        <input v-model="query" class="pa-input w-full h-7 !py-0 !pl-7 text-xs" placeholder="Search images" aria-label="Search images" />
      </label>
      <span class="pa-hint truncate hidden xl:inline">Click to open its page · drag onto a page to place or move</span>
      <span class="ml-auto text-2xs text-pebble-text-dim tabular-nums shrink-0">{{ list.length }} image{{ list.length === 1 ? '' : 's' }}</span>
    </div>
    <div class="flex-1 overflow-x-auto overflow-y-hidden p-2">
      <div class="flex gap-2 h-full items-stretch">
        <div v-for="r in list" :key="r.absolutePath"
             draggable="true" @dragstart="onDragStart($event, r)" @click="openImage(r)"
             class="relative shrink-0 w-28 flex flex-col rounded-md overflow-hidden bg-pebble-surface-2 cursor-grab active:cursor-grabbing border border-pebble-border transition-colors hover:border-pebble-border-strong"
             :title="r.filename">
          <img v-if="thumbs[r.thumbnailPath]" :src="thumbs[r.thumbnailPath]" class="w-full flex-1 min-h-0 object-cover pointer-events-none" />
          <div v-else class="w-full flex-1 min-h-0 bg-pebble-hover animate-pulse" />
          <div class="px-1.5 h-5 flex items-center text-2xs text-pebble-text-dim"><span class="truncate">{{ r.filename }}</span></div>
          <div v-if="r.usedOnPages.length" class="absolute top-1 left-1 px-1.5 h-[18px] inline-flex items-center rounded text-2xs font-medium bg-black/70 text-white">p{{ pageIndexOf(r) + 1 }}</div>
          <div v-else class="absolute top-1 left-1 px-1.5 h-[18px] inline-flex items-center rounded text-2xs font-semibold bg-pebble-warning text-pebble-on-warning">Unused</div>
        </div>
        <div v-if="!list.length" class="text-pebble-text-dim text-xs self-center px-4">
          {{ query || filter === 'unused' ? 'No images match — clear the search or switch to All.' : 'No images in this album yet.' }}
        </div>
      </div>
    </div>
  </div>
</template>
