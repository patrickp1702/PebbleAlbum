<script setup lang="ts">
/**
 * PixartView.vue — standalone photo editor "Pixart" (no saved project / no .pebble).
 *
 * The THIRD consumer of the album's image-editing module (after AlbumEditorView and
 * CollageView): AlbumCanvas + PropertiesPanel + TextPropertiesPanel + PagePanel +
 * CutoutEditor, reused unchanged — no forked editing logic. Two phases:
 *   1. start — a centred "Open photo…" call to action.
 *   2. edit  — the photo IS the page: move/resize/rotate, ＋ Add photo overlays,
 *              adjust/filter/frame/shadow/caption, ✎ Erase / restore with a brush,
 *              then ⬇ Save image (full-resolution PNG).
 *
 * Model: a one-page in-memory project exactly like Collage (`autoSave:false`, save
 * path null ⇒ nothing is ever written as a .pebble). The page is sized to the BASE
 * photo's pixels (long side capped at 4000 px, proportional) and built by hand —
 * no `composePage`, so no theme decorations or text — with the base as a slotted,
 * full-page `cover` photo (layout `cover_full_bleed`, whose only slot is the whole
 * page, so "Not placed" re-adds it full-bleed again). Overlays are FREE photos.
 *
 * Files: `window.pebble.addPhotos(<Pebble folder>/Pixart)` copies picked photos into
 * `<workspace>/added/`; erase masks land in `<workspace>/.pebble_masks/` (the
 * workspace is `meta.sourceFolder`). Edits live only in memory — kept until the
 * user leaves Pixart or opens another photo (no session-resume file in v1).
 *
 * Any album open in the shared project store is stashed on entry and restored on
 * leave — together with ITS undo/redo stacks, so Pixart commands can never be
 * applied to the album (nor album commands to the Pixart page) and the album's
 * history is intact on return.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { v4 as uuid } from 'uuid';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore, createDefaultMeta } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { useHistoryStore, type Command } from '@/stores/historyStore';
import { useAddPhoto, buildFreePhotos } from '@/composables/useAddPhoto';
import { defaultEffects } from '@/engine/collageComposer';
import { renderPageStatic } from '@/engine/pageRenderer';
import { clearImageCache } from '@/engine/imageLoader';
import type { AlbumPage, ImageRecord, Orientation, PageImage, PebbleProject } from '@shared/pebble.types';
import AppButton from '@/components/ui/AppButton.vue';
import AppTooltip from '@/components/ui/AppTooltip.vue';
import AlbumCanvas from '@/components/canvas/AlbumCanvas.vue';
import PropertiesPanel from '@/components/editor/PropertiesPanel.vue';
import TextPropertiesPanel from '@/components/editor/TextPropertiesPanel.vue';
import PagePanel from '@/components/editor/PagePanel.vue';
import CutoutEditor from '@/components/editor/CutoutEditor.vue';

const router = useRouter();
const app = useAppStore();
const project = useProjectStore();
const editor = useEditorStore();
const history = useHistoryStore();
const { adding, addPhotos } = useAddPhoto();

const MAX_SIDE = 4000;          // long-side cap of the page (= saved image) in px
const BASE_LAYOUT = 'cover_full_bleed'; // single slot `main` at 0,0,1,1 — the whole page
const BASE_SLOT = 'main';

const phase = ref<'start' | 'edit'>('start');
const opening = ref(false);
const saving = ref(false);
/** `<Pebble folder>/Pixart` — sourceFolder of every Pixart page (resolved on mount). */
const workspace = ref('');
/** File name of the base photo, for the saved image's default name. */
const baseName = ref('');
const baseId = ref<string | null>(null);

const sizeLabel = computed(() => (project.meta ? `${project.meta.albumWidth} × ${project.meta.albumHeight}px` : ''));

// ── Stash any album already open (project + its undo/redo), so this tool never clobbers it ──
let stashed: {
  project: PebbleProject | null; path: string | null; pageIndex: number; dirty: boolean;
  undo: Command[]; redo: Command[];
} | null = null;
let entered = false; // has a Pixart page replaced the store's project at least once?

async function ensureWorkspace(): Promise<string> {
  if (!workspace.value) workspace.value = `${await window.pebble.getPebbleFolderPath()}/Pixart`;
  return workspace.value;
}

/** Page size from the base photo's pixels: long side ≤ MAX_SIDE, proportional. */
function pageSize(rec: ImageRecord): { w: number; h: number } {
  let w = rec.width || 3000; let h = rec.height || 2000;
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  w = Math.max(1, Math.round(w * k)); h = Math.max(1, Math.round(h * k));
  return { w, h };
}

/** The base photo: slotted, full-page frame, auto cover-fit (aspect matches ⇒ no crop). */
function makeBase(rec: ImageRecord, W: number, H: number): PageImage {
  return {
    id: uuid(), filename: rec.relativePath, slotId: BASE_SLOT, free: false,
    slotRect: { x: 0, y: 0, width: W, height: H }, fit: 'cover', manual: false,
    position: { x: 0, y: 0, width: W, height: H, rotation: 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false },
    crop: { x: 0, y: 0, width: 1, height: 1 },
    parsedLabels: rec.parsedLabels ?? {}, overrides: {}, effects: defaultEffects(),
    border: null, shadow: null,
    opacity: 1, zIndex: 0, visible: true,
  };
}

/**
 * Build the one-page in-memory project from the picked records (first = base,
 * rest = free overlays on top) and enter the editor. Built by hand — NOT
 * `composePage` — so there are no theme decorations / text blocks.
 */
function build(recs: ImageRecord[], folder: string) {
  const base = recs[0];
  const { w: W, h: H } = pageSize(base);
  const orientation: Orientation = W > H ? 'landscape' : W < H ? 'portrait' : 'square';
  const meta = createDefaultMeta({
    name: 'Pixart', sourceFolder: folder, albumWidth: W, albumHeight: H,
    theme: 'modern_minimal', orientation, pageBackgroundColor: '#ffffff',
    dpi: 72, bleedMargin: 0, safeMargin: 0, gutterWidth: 0,
    autoSave: false, // ⬅ never autosaves to a .pebble file
  });
  const basePi = makeBase(base, W, H);
  const page: AlbumPage = {
    id: uuid(), index: 0, type: 'single', layoutId: BASE_LAYOUT,
    backgroundColor: '#ffffff', images: [basePi], decorations: [], textBlocks: [], locked: false,
  };
  // Photos 2..n of the same dialog: the shared add-photo placement (centred,
  // staggered, true aspect, on top) — part of the starting state, not an undo step.
  page.images.push(...buildFreePhotos(recs.slice(1), page, W, H));

  if (!entered) {
    stashed = {
      project: project.project, path: project.savePath, pageIndex: editor.activePageIndex, dirty: project.dirty,
      undo: [...history.undoStack], redo: [...history.redoStack],
    };
    entered = true;
  }
  // Same relative names (e.g. `added/IMG_1.jpg`) can exist in another album's folder;
  // the shared thumbnail cache is keyed by filename, so start clean.
  clearImageCache();
  const p: PebbleProject = { version: '1.0', meta: { ...meta, pageCount: 1 }, pages: [page], imageRegistry: [...recs] };
  project.setProject(p, null); // path=null ⇒ no save target
  if (project.project) project.syncUsage(project.project);
  history.clear();
  baseId.value = basePi.id;
  baseName.value = base.filename;
  editor.closeCutout();
  editor.cropImageId = null;
  editor.setPage(0);
  editor.selectObject(null);
  editor.resetZoom();
  editor.requestRender();
  phase.value = 'edit';
}

/** Open photo… / Open another… — asks before discarding an edited photo. */
async function openPhoto() {
  if (opening.value || adding.value) return;
  if (!window.pebble?.addPhotos) { app.toast('File bridge unavailable — restart the app.', 'error'); return; }
  // eslint-disable-next-line no-alert
  if (phase.value === 'edit' && project.dirty && !window.confirm('Open another photo? Your current edit will be discarded.')) return;
  opening.value = true;
  try {
    const folder = await ensureWorkspace();
    const recs = await window.pebble.addPhotos(folder);
    if (!recs.length) return; // cancelled — keep the current edit
    build(recs, folder);
    if (recs.length > 1) app.toast(`Opened ${recs[0].filename} + ${recs.length - 1} photo${recs.length > 2 ? 's' : ''} on top.`, 'success', 2500);
  } catch (e) {
    app.toast(`Couldn't open photo: ${(e as Error).message || e}`, 'error', 5000);
  } finally { opening.value = false; }
}

/** Full-resolution source for export (registry absolutePath; never the thumbnail). */
function reader(filename: string): Promise<string> {
  const rec = project.images.find((r) => r.relativePath === filename);
  return window.pebble.readImageBase64(rec?.absolutePath || `${workspace.value}/${filename}`);
}

async function saveImage() {
  const page = project.pages[0];
  if (!page || !project.meta || !project.theme || saving.value) return;
  saving.value = true;
  try {
    const dataUrl = await renderPageStatic(page, project.meta, project.theme, reader, 1);
    const stem = (baseName.value.replace(/\.[^.]+$/, '') || 'photo').replace(/[^a-z0-9_\- ]/gi, '');
    const saved = await window.pebble.saveImage(dataUrl, `${stem || 'photo'}_pixart.png`);
    if (saved) app.toast(`Saved ${saved}`, 'success', 4000);
  } catch (e) { app.toast(`Save failed: ${(e as Error).message}`, 'error'); }
  finally { saving.value = false; }
}

/** ‹ Home — edits only live in memory, so ask before dropping an edited photo. */
function goHome() {
  // eslint-disable-next-line no-alert
  if (phase.value === 'edit' && project.dirty && !window.confirm('Leave Pixart? Your current edit will be discarded — save the image first to keep it.')) return;
  void router.push('/');
}

// ── Keyboard shortcuts (edit phase) ─────────────────────────────────────────
/** Delete: a free photo is removed (undoable); the base photo is never removable. */
function deleteSelected() {
  const id = editor.selectedObjectId;
  const page = project.pages[0];
  if (!id || !page) return;
  const img = page.images.find((i) => i.id === id);
  if (img) {
    if (!img.free || id === baseId.value) { app.toast('The base photo can’t be removed — use “Open another…” to start over.', 'info', 2500); return; }
    const at = page.images.indexOf(img);
    const sync = () => { if (project.project) project.syncUsage(project.project); project.markDirty(); editor.requestRender(); };
    history.run({
      type: 'remove', description: 'Remove photo',
      execute: () => { page.images = page.images.filter((i) => i.id !== id); editor.selectObject(null); sync(); },
      undo: () => { page.images.splice(Math.min(at, page.images.length), 0, img); sync(); },
    });
    return;
  }
  const dIdx = page.decorations.findIndex((d) => d.id === id);
  if (dIdx >= 0) page.decorations.splice(dIdx, 1);
  else { const tIdx = page.textBlocks.findIndex((t) => t.id === id); if (tIdx >= 0) page.textBlocks.splice(tIdx, 1); }
  project.markDirty();
  editor.selectObject(null);
  editor.requestRender();
}

function onKey(e: KeyboardEvent) {
  if (phase.value !== 'edit') return;
  // The Erase/restore studio is modal and owns the keyboard (its own undo/Esc/
  // Space) — Pixart shortcuts must not fire underneath it.
  if (editor.cutoutRequest) return;
  const target = e.target as HTMLElement;
  if (target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable)) return; // don't hijack typing
  const meta = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') { if (editor.cropImageId) { editor.cropImageId = null; editor.requestRender(); } else editor.selectObject(null); }
  else if (meta && e.key === 'z') { e.preventDefault(); e.shiftKey ? history.redo() : history.undo(); }
  else if (meta && e.key === 'y') { e.preventDefault(); history.redo(); }
  else if (meta && e.key === '0') { e.preventDefault(); editor.resetZoom(); }
  else if (meta && e.key === '1') { e.preventDefault(); editor.setZoom(1); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && editor.hasSelection) { e.preventDefault(); deleteSelected(); }
}

/** Put back whatever album (and its undo/redo history) was open before Pixart ran. */
function restoreStashed() {
  editor.closeCutout();
  editor.cropImageId = null;
  if (!entered) return;
  clearImageCache(); // drop Pixart's `added/…` thumbnails so the album can't hit a same-named entry
  if (stashed?.project) {
    project.setProject(stashed.project, stashed.path); // (resets dirty …)
    editor.setPage(stashed.pageIndex);
    if (stashed.dirty) project.markDirty(); // … so re-flag unsaved album edits (+ re-arm its autosave)
  } else { project.project = null; project.savePath = null; editor.setPage(0); }
  history.clear();
  if (stashed) { history.undoStack = stashed.undo; history.redoStack = stashed.redo; }
  editor.selectObject(null);
  editor.requestRender();
  entered = false; stashed = null;
}

onMounted(() => {
  window.addEventListener('keydown', onKey);
  void ensureWorkspace().catch(() => {});
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  restoreStashed();
});
</script>

<template>
  <div class="h-full w-full flex flex-col bg-pebble-bg">
    <!-- ─────────────────────────── START PHASE ─────────────────────────── -->
    <template v-if="phase === 'start'">
      <header class="h-14 shrink-0 flex items-center gap-3 px-5 border-b border-pebble-border">
        <button class="h-8 px-3 rounded-lg text-sm text-pebble-text-dim hover:text-pebble-text hover:bg-white/5" @click="router.push('/')">‹ Home</button>
        <div class="font-semibold">Pixart</div>
        <span class="text-[11px] text-pebble-text-dim">Open a photo → edit → save</span>
      </header>

      <section class="flex-1 flex items-center justify-center p-8 overflow-auto bg-[#0d1124]">
        <div class="text-center max-w-md">
          <div class="text-5xl mb-3">🎨</div>
          <h1 class="text-2xl font-semibold mb-2">Pixart — Photo Editor</h1>
          <p class="text-pebble-text-dim text-sm mb-6">
            Open a photo to edit it with the same tools as an album page: add photos on top, move · resize · rotate,
            ✎ erase and restore with a brush, adjust, filter, frame and shadow — then save it as an image.
          </p>
          <AppButton size="lg" :disabled="opening" @click="openPhoto">{{ opening ? 'Opening…' : 'Open photo…' }}</AppButton>
          <p class="text-[11px] text-pebble-text-dim mt-4 leading-relaxed">
            Pick several at once: the first becomes the base, the rest are placed on top.
            Edits are kept until you close Pixart or open another photo.
          </p>
        </div>
      </section>
    </template>

    <!-- ─────────────────────────── EDIT PHASE ──────────────────────────── -->
    <template v-else>
      <header class="flex items-center gap-2 px-3 h-12 bg-pebble-surface border-b border-pebble-border text-sm">
        <button class="text-pebble-text-dim hover:text-pebble-text px-2" @click="goHome">‹ Home</button>
        <span class="font-semibold">Pixart</span>
        <span class="text-pebble-text-dim text-xs truncate max-w-[14rem]" :title="baseName">{{ baseName }} · {{ sizeLabel }}</span>
        <div class="flex items-center gap-1 ml-3">
          <AppTooltip :text="history.undoLabel"><button class="px-2 py-1 rounded hover:bg-white/5 disabled:opacity-30" :disabled="!history.canUndo" @click="history.undo()">↶</button></AppTooltip>
          <AppTooltip :text="history.redoLabel"><button class="px-2 py-1 rounded hover:bg-white/5 disabled:opacity-30" :disabled="!history.canRedo" @click="history.redo()">↷</button></AppTooltip>
        </div>
        <div class="flex items-center gap-1 ml-3">
          <button class="px-2 py-1 rounded hover:bg-white/5" @click="editor.zoomOut()">−</button>
          <span class="w-12 text-center tabular-nums">{{ editor.zoomPercent }}%</span>
          <button class="px-2 py-1 rounded hover:bg-white/5" @click="editor.zoomIn()">＋</button>
        </div>
        <div class="flex-1 text-center text-pebble-text-dim text-xs truncate">Drag · resize · rotate · ✎ erase/restore in the right panel · edits kept until you close or open another photo</div>
        <AppButton size="sm" variant="secondary" :disabled="adding" title="Add photos from your computer on top" @click="addPhotos">{{ adding ? 'Adding…' : '＋ Add photo' }}</AppButton>
        <AppButton size="sm" variant="ghost" :disabled="opening" @click="openPhoto">Open another…</AppButton>
        <AppButton size="sm" :disabled="saving" @click="saveImage">{{ saving ? 'Saving…' : '⬇ Save image' }}</AppButton>
      </header>

      <div class="flex-1 flex min-h-0">
        <!-- Center: the photo IS the canvas (reused) -->
        <section class="flex-1 flex flex-col min-w-0 relative">
          <AlbumCanvas />
        </section>

        <!-- Right: per-object properties / layers (reused) -->
        <aside class="w-72 shrink-0 bg-pebble-surface border-l border-pebble-border">
          <TextPropertiesPanel v-if="editor.hasSelection && editor.propertiesOpen && editor.selectedType === 'text'" />
          <PropertiesPanel v-else-if="editor.hasSelection && editor.propertiesOpen && editor.selectedType === 'image'" />
          <PagePanel v-else variant="photo" />
        </aside>
      </div>

      <!-- Erase / restore studio (same in-context mask editor as the album) -->
      <CutoutEditor v-if="editor.cutoutRequest" :filename="editor.cutoutRequest.filename"
                    :image-id="editor.cutoutRequest.imageId" @close="editor.closeCutout()" />
    </template>
  </div>
</template>
