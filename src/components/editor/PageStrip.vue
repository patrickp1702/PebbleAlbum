<script setup lang="ts">
/**
 * PageStrip.vue — Left sidebar list of pages. Click to navigate, drag to
 * reorder, right-click for page actions. Shows type badge + proverb/lock icons.
 * The active page is marked by a 2px accent outline only (no glow).
 */
import { ref, reactive, onMounted, watch } from 'vue';
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { useAppStore } from '@/stores/appStore';
import { v4 as uuid } from 'uuid';
import { renderPageStatic } from '@/engine/pageRenderer';
import { loadImageDataUrl } from '@/engine/imageLoader';
import { movePayloadFromDrop, applyImageDropToPage } from '@/engine/dragMove';
import type { AlbumPage } from '@shared/pebble.types';
import AppIcon from '@/components/ui/AppIcon.vue';

const project = useProjectStore();
const editor = useEditorStore();
const app = useAppStore();
const dragFrom = ref<number | null>(null);
const dropTarget = ref<number | null>(null);
/** Floating context menu anchored at the cursor (rendered to <body> so it is
 *  never clipped by the page-strip's scroll container). */
const menu = ref<{ x: number; y: number; index: number } | null>(null);
function openMenu(e: MouseEvent, i: number) {
  menu.value = { x: Math.min(e.clientX, window.innerWidth - 180), y: Math.min(e.clientY, window.innerHeight - 170), index: i };
}
function closeMenu() { menu.value = null; }
function toggleLock(i: number) { const p = project.pages[i]; if (p) { p.locked = !p.locked; project.markDirty(); editor.requestRender(); } }

const badge: Record<string, string> = {
  cover: 'Cover', back_cover: 'Back', spread: 'Spread', single: 'Single', divider: 'Divider',
};

/** Count of images assigned to a page but not placed in its layout. */
function unplacedCount(p: AlbumPage): number {
  return p.images.filter((im) => !im.visible).length;
}

// --- Live page thumbnails (rendered at low resolution) ----------------------
const thumbs = reactive<Record<string, string>>({});
const queue: number[] = [];
let running = false;
async function renderThumb(i: number) {
  const page = project.pages[i];
  if (!page || !project.meta || !project.theme) return;
  try {
    thumbs[page.id] = await renderPageStatic(
      page, project.meta, project.theme,
      (f) => loadImageDataUrl(project.meta!.sourceFolder, f, 600), 0.12,
    );
  } catch { /* leave previous thumb */ }
}
function enqueue(i: number) { if (!queue.includes(i)) queue.push(i); void pump(); }
async function pump() {
  if (running) return; running = true;
  while (queue.length) { const i = queue.shift()!; /* eslint-disable-next-line no-await-in-loop */ await renderThumb(i); }
  running = false;
}
onMounted(() => project.pages.forEach((_, i) => enqueue(i)));
// Re-render the active page's thumbnail after structural edits (debounced).
let t: ReturnType<typeof setTimeout> | null = null;
watch(() => editor.canvasRevision, () => { if (t) clearTimeout(t); t = setTimeout(() => enqueue(editor.activePageIndex), 600); });
// Capture edits on the page we just left.
watch(() => editor.activePageIndex, (_n, old) => { if (old != null) enqueue(old); });
// Erase / filter-brush mask changes on ANY page (e.g. undo/redo of an erase
// while another page is active) — only the active page is re-thumbnailed above,
// so watch a cheap per-page signature of mask paths and enqueue just the pages
// whose masks changed. (Mask files are unique per save, so a path change == a
// pixel change.)
const maskSig = (p: AlbumPage) => p.images.map((im) => `${im.eraseMask ?? ''}>${im.filterMask ?? ''}`).join('|');
watch(
  () => project.pages.map((p) => `${p.id}\n${maskSig(p)}`),
  (now, before) => {
    const prev = new Map((before ?? []).map((k) => [k.slice(0, k.indexOf('\n')), k]));
    now.forEach((k, i) => {
      const old = prev.get(k.slice(0, k.indexOf('\n')));
      if (old !== undefined && old !== k) enqueue(i);
    });
  },
);
// Whenever the set of pages changes — add/delete/reorder and especially
// Re-generate (which assigns brand-new page ids) — render any page that is
// missing a thumbnail. Without this, regenerated pages stay blank white until
// individually clicked.
watch(
  () => project.pages.map((p) => p.id).join('|'),
  () => project.pages.forEach((_, i) => { if (!thumbs[project.pages[i].id]) enqueue(i); }),
);

/** Handle a drop on page index `to`: either an image move/place or a reorder. */
function onDrop(e: DragEvent, to: number) {
  dropTarget.value = null;
  const move = movePayloadFromDrop(e);
  if (move) {
    const msg = applyImageDropToPage(project, move, to);
    if (msg) { app.toast(msg, 'success', 1500); editor.requestRender(); enqueue(to); if (move.fromPageId) enqueue(project.pages.findIndex((p) => p.id === move.fromPageId)); }
    return;
  }
  if (dragFrom.value !== null && dragFrom.value !== to) project.reorderPage(dragFrom.value, to);
  dragFrom.value = null;
}

function addPage() {
  const blank: AlbumPage = {
    id: uuid(), index: project.pages.length, type: 'spread', layoutId: 'two_equal',
    images: [], decorations: [], textBlocks: [], locked: false,
    backgroundColor: project.meta?.pageBackgroundColor,
  };
  project.addPage(project.pages.length, blank);
  editor.setPage(project.pages.length - 1);
}
</script>

<template>
  <aside class="w-44 shrink-0 bg-pebble-surface border-r border-pebble-border flex flex-col">
    <div class="px-3 h-10 flex items-center justify-between border-b border-pebble-border shrink-0">
      <span class="pa-section">Pages</span>
      <span class="text-2xs text-pebble-text-dim tabular-nums">{{ project.pages.length }}</span>
    </div>
    <div class="flex-1 overflow-auto p-2.5 space-y-2.5">
      <div v-for="(p, i) in project.pages" :key="p.id"
           draggable="true"
           @dragstart="dragFrom = i" @dragover.prevent @dragenter="dropTarget = i" @dragleave="dropTarget = (dropTarget === i ? null : dropTarget)" @drop="onDrop($event, i)"
           @click="editor.setPage(i)" @contextmenu.prevent="openMenu($event, i)"
           class="relative cursor-pointer group">
        <div :class="['relative aspect-[3/2] rounded overflow-hidden flex items-center justify-center text-pebble-text-off outline outline-2 outline-offset-2 transition-[outline-color]',
                      dropTarget === i ? 'outline-pebble-accent-soft outline-dashed' :
                      i === editor.activePageIndex ? 'outline-pebble-accent' : 'outline-transparent group-hover:outline-pebble-border-strong']"
             :style="{ background: p.backgroundColor || '#fff' }">
          <img v-if="thumbs[p.id]" :src="thumbs[p.id]" class="w-full h-full object-contain" :alt="`Page ${i + 1}`" />
          <AppIcon v-else name="image" :size="20" class="animate-pulse" />
          <!-- Warning badge: images assigned to this page but not placed in the layout. -->
          <span v-if="unplacedCount(p) > 0"
                class="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-pebble-warning text-pebble-on-warning text-2xs font-bold flex items-center justify-center"
                :title="`${unplacedCount(p)} image(s) assigned but not placed`">
            {{ unplacedCount(p) }}
          </span>
        </div>
        <div class="flex items-center justify-between pt-1.5 px-0.5 text-2xs"
             :class="unplacedCount(p) > 0 ? 'text-pebble-warning' : i === editor.activePageIndex ? 'text-pebble-text' : 'text-pebble-text-dim'">
          <span><span class="tabular-nums font-medium">{{ i + 1 }}</span> · {{ badge[p.type] }}</span>
          <span class="flex items-center gap-1 text-pebble-text-dim">
            <span v-if="p.proverb" title="Has proverb"><AppIcon name="quote" :size="12" /></span>
            <span v-if="p.locked" title="Locked"><AppIcon name="lock" :size="12" /></span>
            <span v-if="p.notes" title="Has note"><AppIcon name="note" :size="12" /></span>
          </span>
        </div>
      </div>
    </div>
    <div class="p-2 border-t border-pebble-border shrink-0">
      <button type="button" class="w-full h-8 inline-flex items-center justify-center gap-1.5 rounded-md border border-dashed border-pebble-border-strong text-xs font-medium text-pebble-text-dim transition-colors hover:border-pebble-accent-soft hover:text-pebble-text hover:bg-pebble-hover"
              title="Add a blank page at the end" @click="addPage">
        <AppIcon name="plus" :size="14" />Add page
      </button>
    </div>

    <!-- Context menu (teleported to body so it can't be clipped) -->
    <Teleport to="body">
      <div v-if="menu" class="fixed inset-0 z-[200]" @click="closeMenu" @contextmenu.prevent="closeMenu">
        <div class="absolute w-44 p-1 rounded-lg bg-pebble-surface-2 border border-pebble-border-strong/50 shadow-pop text-xs"
             :style="{ left: menu.x + 'px', top: menu.y + 'px' }" role="menu" @click.stop>
          <button type="button" role="menuitem" class="flex items-center gap-2 w-full text-left px-2 h-7 rounded hover:bg-pebble-hover" @click="project.duplicatePage(menu.index); editor.requestRender(); closeMenu()"><AppIcon name="copy" :size="14" class="text-pebble-text-dim" />Duplicate page</button>
          <button type="button" role="menuitem" class="flex items-center gap-2 w-full text-left px-2 h-7 rounded hover:bg-pebble-hover" @click="editor.setPage(menu.index); closeMenu()"><AppIcon name="arrow-right" :size="14" class="text-pebble-text-dim" />Go to page</button>
          <button type="button" role="menuitem" class="flex items-center gap-2 w-full text-left px-2 h-7 rounded hover:bg-pebble-hover" @click="toggleLock(menu.index); closeMenu()"><AppIcon :name="project.pages[menu.index]?.locked ? 'unlock' : 'lock'" :size="14" class="text-pebble-text-dim" />{{ project.pages[menu.index]?.locked ? 'Unlock page' : 'Lock page' }}</button>
          <div class="border-t border-pebble-border my-1" />
          <button type="button" role="menuitem" class="flex items-center gap-2 w-full text-left px-2 h-7 rounded text-pebble-danger hover:bg-pebble-danger/15" @click="project.deletePage(menu.index); editor.requestRender(); closeMenu()"><AppIcon name="trash" :size="14" />Delete page</button>
        </div>
      </div>
    </Teleport>
  </aside>
</template>
