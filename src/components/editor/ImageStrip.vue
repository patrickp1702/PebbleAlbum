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

const project = useProjectStore();
const editor = useEditorStore();
const app = useAppStore();
const query = ref('');
const filter = ref<'all' | 'unused'>('all');

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
    <div class="flex items-center gap-2 px-3 py-1.5 border-b border-pebble-border">
      <div class="flex rounded bg-pebble-bg p-0.5 text-2xs">
        <button class="px-2 py-0.5 rounded" :class="filter === 'all' ? 'bg-pebble-accent text-white' : 'text-pebble-text-dim'" @click="filter = 'all'">All</button>
        <button class="px-2 py-0.5 rounded" :class="filter === 'unused' ? 'bg-pebble-accent text-white' : 'text-pebble-text-dim'" @click="filter = 'unused'">Unused</button>
      </div>
      <input v-model="query" class="pa-input py-0.5 text-xs flex-1 max-w-xs" placeholder="Search images…" />
      <span class="text-2xs text-pebble-text-dim">Click to open its page · drag onto a page to move/place</span>
    </div>
    <div class="flex-1 overflow-x-auto overflow-y-hidden p-2">
      <div class="flex gap-2 h-full items-stretch">
        <div v-for="r in list" :key="r.absolutePath"
             draggable="true" @dragstart="onDragStart($event, r)" @click="openImage(r)"
             class="relative shrink-0 w-28 rounded overflow-hidden bg-pebble-bg cursor-grab active:cursor-grabbing border border-transparent hover:border-pebble-accent/60"
             :title="r.filename">
          <img v-if="thumbs[r.thumbnailPath]" :src="thumbs[r.thumbnailPath]" class="w-full h-[78%] object-cover pointer-events-none" />
          <div v-else class="w-full h-[78%] bg-pebble-surface-2 animate-pulse" />
          <div class="px-1 py-0.5 text-2xs truncate">{{ r.filename }}</div>
          <div v-if="r.usedOnPages.length" class="absolute top-1 left-1 pa-chip">p{{ pageIndexOf(r) + 1 }}</div>
          <div v-else class="absolute top-1 left-1 pa-chip bg-pebble-warning/20 text-pebble-warning border-pebble-warning/40">unused</div>
        </div>
        <div v-if="!list.length" class="text-pebble-text-dim text-xs self-center px-4">No images.</div>
      </div>
    </div>
  </div>
</template>
