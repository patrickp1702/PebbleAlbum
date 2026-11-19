<script setup lang="ts">
/**
 * PageStrip.vue — Left sidebar list of pages. Click to navigate, drag to
 * reorder, right-click for page actions. Shows type badge + proverb/lock icons.
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
// Erase-mask changes on ANY page (e.g. undo/redo of an erase while another page
// is active) — only the active page is re-thumbnailed above, so watch a cheap
// per-page signature of mask paths and enqueue just the pages whose masks
// changed. (Mask files are unique per save, so a path change == a pixel change.)
const maskSig = (p: AlbumPage) => p.images.map((im) => im.eraseMask ?? '').join('|');
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
    <div class="px-3 py-2 text-xs uppercase tracking-wider text-pebble-text-dim border-b border-pebble-border">Pages</div>
    <div class="flex-1 overflow-auto p-2 space-y-2">
      <div v-for="(p, i) in project.pages" :key="p.id"
           draggable="true"
           @dragstart="dragFrom = i" @dragover.prevent @dragenter="dropTarget = i" @dragleave="dropTarget = (dropTarget === i ? null : dropTarget)" @drop="onDrop($event, i)"
           @click="editor.setPage(i)" @contextmenu.prevent="openMenu($event, i)"
           :class="['relative rounded-md border-2 cursor-pointer transition group',
                    dropTarget === i ? 'border-pebble-accent ring-2 ring-pebble-accent' :
                    i === editor.activePageIndex ? 'border-pebble-accent ring-2 ring-pebble-accent shadow-lg shadow-pebble-accent/30' : 'border-transparent hover:border-pebble-accent/50']">
        <!-- Active-page marker -->
        <div v-if="i === editor.activePageIndex" class="absolute -left-2 top-1/2 -translate-y-1/2 w-1 h-8 rounded-full bg-pebble-accent" />
        <div class="aspect-[3/2] rounded-t overflow-hidden flex items-center justify-center text-pebble-text-dim"
             :style="{ background: p.backgroundColor || '#fff' }">
          <img v-if="thumbs[p.id]" :src="thumbs[p.id]" class="w-full h-full object-contain" :alt="`Page ${i + 1}`" />
          <span v-else class="text-xl animate-pulse">▱</span>
          <!-- Amber badge: images assigned to this page but not placed in the layout. -->
          <span v-if="unplacedCount(p) > 0"
                class="absolute top-1 right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-pebble-warning text-black text-2xs font-bold flex items-center justify-center shadow"
                :title="`${unplacedCount(p)} image(s) assigned but not placed`">
            {{ unplacedCount(p) }}
          </span>
        </div>
        <div class="flex items-center justify-between px-2 py-1 text-2xs"
             :class="unplacedCount(p) > 0 ? 'text-pebble-warning' : ''">
          <span>{{ i + 1 }} · {{ badge[p.type] }}</span>
          <span class="flex gap-0.5">
            <span v-if="p.proverb" title="Has proverb">“”</span>
            <span v-if="p.locked" title="Locked">🔒</span>
            <span v-if="p.notes" title="Has note">📝</span>
          </span>
        </div>

      </div>
    </div>
    <button class="m-2 py-2 rounded border border-dashed border-pebble-border text-sm text-pebble-text-dim hover:border-pebble-accent hover:text-pebble-accent" @click="addPage">＋ Add page</button>

    <!-- Context menu (teleported to body so it can't be clipped) -->
    <Teleport to="body">
      <div v-if="menu" class="fixed inset-0 z-[200]" @click="closeMenu" @contextmenu.prevent="closeMenu">
        <div class="absolute pa-panel text-xs w-44 py-1 shadow-2xl" :style="{ left: menu.x + 'px', top: menu.y + 'px' }" @click.stop>
          <button class="block w-full text-left px-3 py-2 hover:bg-pebble-hover" @click="project.duplicatePage(menu.index); editor.requestRender(); closeMenu()">Duplicate page</button>
          <button class="block w-full text-left px-3 py-2 hover:bg-pebble-hover" @click="editor.setPage(menu.index); closeMenu()">Go to page</button>
          <button class="block w-full text-left px-3 py-2 hover:bg-pebble-hover" @click="toggleLock(menu.index); closeMenu()">{{ project.pages[menu.index]?.locked ? 'Unlock page' : 'Lock page' }}</button>
          <div class="border-t border-pebble-border my-1" />
          <button class="block w-full text-left px-3 py-2 hover:bg-pebble-hover text-pebble-danger" @click="project.deletePage(menu.index); editor.requestRender(); closeMenu()">Delete page</button>
        </div>
      </div>
    </Teleport>
  </aside>
</template>
