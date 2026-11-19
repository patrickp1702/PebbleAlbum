<script setup lang="ts">
/**
 * CollageView.vue — standalone Collage Creator (no saved project / no .pebble).
 *
 * Two phases, sharing the album editor's engine AND its UI components:
 *   1. setup — pick a folder, multi-select photos, choose layout/theme/shape/bg.
 *   2. edit  — a FULL interactive editor (reuses AlbumCanvas + PropertiesPanel +
 *              PagePanel + ImageStrip + ThemePanel) so a collage has the very same
 *              options as an album page: drag/resize/crop, filters, borders,
 *              shadows, decorations, stickers, text, layout & theme swaps,
 *              and "Erase / restore parts" (mounts the shared CutoutEditor).
 *
 * Chrome follows the album editor: a slim top bar per phase with ONE primary
 * action (setup: "Edit collage", edit: "Download"), and in the edit phase an
 * insert bar above the canvas with the Add actions (Photo / Text / Sticker).
 * Text and Sticker open the matching tab of the page panel, whose active tab
 * this view owns (`pageTab`).
 *
 * The collage is modelled as a one-page in-memory project with `autoSave:false`,
 * so the editor components work unchanged yet NOTHING is written to disk. Any album
 * already open in the shared project store is stashed on entry and restored on exit,
 * so the collage tool never clobbers an in-progress album.
 */
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '@/stores/appStore';
import { useCollageStore } from '@/stores/collageStore';
import { useProjectStore, createDefaultMeta } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { useHistoryStore } from '@/stores/historyStore';
import { resolveTheme } from '@/engine/themeEngine';
import { composePage } from '@/engine/collageComposer';
import { renderPageStatic } from '@/engine/pageRenderer';
import { getLayout } from '@/engine/layoutSelector';
import layoutsJson from '@/config/layouts.json';
import themesJson from '@/config/themes.json';
import type { ImageRecord, Orientation, PebbleProject } from '@shared/pebble.types';
import type { CollageSession } from '@shared/ipc.types';
import type { LayoutTemplate } from '@shared/layout.types';
import AppButton from '@/components/ui/AppButton.vue';
import AppDropdown from '@/components/ui/AppDropdown.vue';
import AppColorPicker from '@/components/ui/AppColorPicker.vue';
import AppIconButton from '@/components/ui/AppIconButton.vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import AppTabs from '@/components/ui/AppTabs.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import { useAddPhoto } from '@/composables/useAddPhoto';
import AlbumCanvas from '@/components/canvas/AlbumCanvas.vue';
import PropertiesPanel from '@/components/editor/PropertiesPanel.vue';
import TextPropertiesPanel from '@/components/editor/TextPropertiesPanel.vue';
import PagePanel from '@/components/editor/PagePanel.vue';
import ImageStrip from '@/components/editor/ImageStrip.vue';
import ThemePanel from '@/components/editor/ThemePanel.vue';
import CutoutEditor from '@/components/editor/CutoutEditor.vue';

const router = useRouter();
const app = useAppStore();
const c = useCollageStore();
const project = useProjectStore();
const editor = useEditorStore();
const history = useHistoryStore();

const layouts = layoutsJson as LayoutTemplate[];
const themes = themesJson as { id: string; name: string }[];
const loadingFolder = ref(false);
const building = ref(false);
const downloading = ref(false);
const thumbs = reactive<Record<string, string>>({});

const collageLayouts = layouts.filter((l) => ['spread', 'creative', 'single'].includes(l.category));
const layoutOptions = [{ value: 'auto', label: 'Auto (fit my photos)' }, ...collageLayouts.map((l) => ({ value: l.id, label: `${l.name} (${l.minImages}–${l.maxImages})` }))];
const themeOptions = themes.map((t) => ({ value: t.id, label: t.name }));
const orientationOptions = [{ value: 'landscape', label: 'Landscape' }, { value: 'portrait', label: 'Portrait' }, { value: 'square', label: 'Square' }];

/** Insert bar → Photo: the ONE shared add-photo implementation (same as PagePanel's button). */
const { adding, addPhotos } = useAddPhoto();
/** Active tab of the page panel — owned here so the insert bar can open it. */
const pageTab = ref<'layers' | 'layout' | 'design' | 'proverb' | 'settings'>('layers');
/** Insert bar → Text / Sticker: leave the selection panel and show that tab. */
function openPageTab(t: 'proverb' | 'design') {
  editor.cropImageId = null;
  editor.propertiesOpen = false;
  editor.requestRender();
  pageTab.value = t;
}
/** Bottom tray tabs (edit phase). */
const TRAY_TABS = [
  { id: 'images', label: 'Photos', icon: 'images' },
  { id: 'themes', label: 'Themes', icon: 'palette' },
] as const;
/** Platform modifier glyph for the shortcut hints in tooltips. */
const MOD = /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+';

const selCount = computed(() => c.selected.length);
const src = (r: ImageRecord) => thumbs[r.relativePath] ?? '';

// ── Stash any album already open, so this tool never clobbers it ────────────
let stashed: { project: PebbleProject | null; path: string | null; pageIndex: number } | null = null;
let entered = false;          // has the editor been opened at least once?
let restoring = false;        // suppress autosave while loading the session
let disposed = false;         // suppress autosave during teardown
let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SESSION_V = 1;

function ensureThumb(r: ImageRecord) {
  if (!r.thumbnailPath || thumbs[r.relativePath]) return;
  window.pebble.readImageBase64(r.thumbnailPath).then((d) => { thumbs[r.relativePath] = d; }).catch(() => {});
}

async function pickFolder() {
  if (!window.pebble?.openFolderDialog) { app.toast('File bridge unavailable — restart the app.', 'error'); return; }
  const folder = await window.pebble.openFolderDialog();
  if (!folder) return;
  loadingFolder.value = true;
  try {
    c.folder = folder;
    c.records = await window.pebble.listImages(folder);
    c.selected = [];
    c.resultDataUrl = '';
    c.records.forEach(ensureThumb);
    if (!c.records.length) app.toast('No images found in that folder.', 'warning');
  } catch (e) { app.toast(`Could not read folder: ${(e as Error).message}`, 'error'); }
  finally { loadingFolder.value = false; }
}

function toggle(rel: string) {
  const i = c.selected.indexOf(rel);
  if (i >= 0) c.selected.splice(i, 1); else c.selected.push(rel);
}
const orderOf = (rel: string) => { const i = c.selected.indexOf(rel); return i >= 0 ? i + 1 : 0; };

function dims(o: Orientation) { return o === 'portrait' ? { w: 2000, h: 3000 } : o === 'square' ? { w: 2400, h: 2400 } : { w: 3000, h: 2000 }; }

/** Choose a layout that best fits the selected photo count. */
function pickAuto(n: number): LayoutTemplate | undefined {
  const fits = collageLayouts.filter((l) => n >= l.minImages && n <= l.maxImages);
  const pool = fits.length ? fits : collageLayouts.filter((l) => l.maxImages >= Math.min(n, 6));
  return pool.sort((a, b) => Math.abs(a.maxImages - n) - Math.abs(b.maxImages - n))[0]
    ?? getLayout(n <= 1 ? 'single_full' : 'grid_4_equal');
}

/** Look up a photo's base64 from the full folder registry (covers photos added in the editor too). */
function reader(filename: string): Promise<string> {
  const rec = c.records.find((r) => r.relativePath === filename);
  return window.pebble.readImageBase64(rec?.absolutePath || `${c.folder}/${filename}`);
}

// ── Session autosave (single hidden temp file; resumes after close/crash) ───
function buildBlob(): CollageSession {
  return {
    v: SESSION_V,
    collage: {
      folder: c.folder, selected: [...c.selected], layoutId: c.layoutId, themeId: c.themeId,
      orientation: c.orientation, bgColor: c.bgColor, phase: c.phase,
      // In setup we keep the picker list; in edit it already lives in project.imageRegistry.
      records: entered ? undefined : (c.records as ImageRecord[]),
    },
    // Deep-clone to a plain object — Electron can't structured-clone a Vue proxy.
    project: entered && project.project ? (JSON.parse(JSON.stringify(project.project)) as PebbleProject) : null,
  };
}
function persistNow() {
  if (disposed) return;
  // Nothing meaningful to keep → make sure no stale session lingers.
  if (!c.folder && !entered) { window.pebble.collageClearTemp?.(); return; }
  window.pebble.collageSaveTemp?.(buildBlob()).catch(() => {});
}
function schedulePersist() {
  if (restoring || disposed) return;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(persistNow, 700);
}

/** Build the one-page in-memory project from the current selection, then enter the editor. */
function create() {
  const recs = c.records.filter((r) => c.selected.includes(r.relativePath))
    .sort((a, b) => c.selected.indexOf(a.relativePath) - c.selected.indexOf(b.relativePath));
  if (!recs.length) { app.toast('Select at least one photo.', 'warning'); return; }
  const { w, h } = dims(c.orientation);
  const meta = createDefaultMeta({
    name: 'Collage', sourceFolder: c.folder, albumWidth: w, albumHeight: h,
    theme: c.themeId, orientation: c.orientation, pageBackgroundColor: c.bgColor,
    dpi: 150, autoSave: false, // ⬅ never autosaves to a .pebble file
  });
  const theme = resolveTheme(meta);
  const layout = (c.layoutId !== 'auto' ? getLayout(c.layoutId) : undefined) ?? pickAuto(recs.length);
  if (!layout) { app.toast('No suitable layout found.', 'error'); return; }
  building.value = true;
  try {
    if (!entered) {
      stashed = { project: project.project, path: project.savePath, pageIndex: editor.activePageIndex };
      entered = true;
    }
    const page = composePage(layout, recs, theme, meta, 0, 'single', {});
    page.backgroundColor = c.bgColor;
    const p: PebbleProject = { version: '1.0', meta: { ...meta, pageCount: 1 }, pages: [page], imageRegistry: c.records };
    project.setProject(p, null);          // path=null ⇒ no save target
    if (project.project) project.syncUsage(project.project);
    history.clear();
    editor.setPage(0);
    editor.selectObject(null);
    editor.bottomPanel = 'images';
    editor.requestRender();
    c.phase = 'edit';
  } catch (e) { app.toast(`Could not build collage: ${(e as Error).message}`, 'error'); }
  finally { building.value = false; }
}

function backToPhotos() { c.phase = 'setup'; editor.selectObject(null); }

/** Discard the collage, delete the temp session, and restore any stashed album. */
function clearCollage() {
  window.pebble.collageClearTemp?.();
  c.clear();
  if (entered) {
    if (stashed?.project) { project.setProject(stashed.project, stashed.path); editor.setPage(stashed.pageIndex); }
    else { project.project = null; project.savePath = null; editor.setPage(0); }
    editor.selectObject(null);
  }
  entered = false; stashed = null;
}

async function download() {
  const page = project.pages[0];
  if (!page || !project.meta || !project.theme) return;
  downloading.value = true;
  try {
    const dataUrl = await renderPageStatic(page, project.meta, project.theme, reader, 1);
    c.resultDataUrl = dataUrl;
    const saved = await window.pebble.saveImage(dataUrl, 'collage.png');
    if (saved) app.toast('Collage saved.', 'success', 2500);
  } catch (e) { app.toast(`Save failed: ${(e as Error).message}`, 'error'); }
  finally { downloading.value = false; }
}

// ── Editor keyboard shortcuts (active in edit phase) ────────────────────────
function deleteSelected() {
  const id = editor.selectedObjectId;
  const page = project.pages[0];
  if (!id || !page) return;
  const img = page.images.find((i) => i.id === id);
  if (img) {
    if (img.free) page.images = page.images.filter((i) => i.id !== id);
    else img.visible = false;
    if (project.project) project.syncUsage(project.project);
  } else {
    const dIdx = page.decorations.findIndex((d) => d.id === id);
    if (dIdx >= 0) page.decorations.splice(dIdx, 1);
    else { const tIdx = page.textBlocks.findIndex((t) => t.id === id); if (tIdx >= 0) page.textBlocks.splice(tIdx, 1); }
  }
  project.markDirty();
  editor.selectObject(null);
  editor.requestRender();
}

function onKey(e: KeyboardEvent) {
  if (c.phase !== 'edit') return;
  // The Erase/restore studio is modal and owns the keyboard (its own undo/Esc/
  // Space) — collage shortcuts must not fire underneath it.
  if (editor.cutoutRequest) return;
  const target = e.target as HTMLElement;
  if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return; // don't hijack typing
  const meta = e.ctrlKey || e.metaKey;
  if (e.key === 'Escape') editor.selectObject(null);
  else if (meta && e.key === 'z') { e.preventDefault(); e.shiftKey ? history.redo() : history.undo(); }
  else if (meta && e.key === 'y') { e.preventDefault(); history.redo(); }
  else if (meta && e.key === '0') { e.preventDefault(); editor.resetZoom(); }
  else if (meta && e.key === '1') { e.preventDefault(); editor.setZoom(1); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && editor.hasSelection) { e.preventDefault(); deleteSelected(); }
}

/** Resume the previous collage session (if any) from the single temp file. */
async function restoreSession() {
  const sess = (await window.pebble.collageLoadTemp?.()) as CollageSession | null;
  if (!sess || sess.v !== SESSION_V) return;
  restoring = true;
  try {
    c.folder = sess.collage.folder || '';
    c.selected = sess.collage.selected || [];
    c.layoutId = sess.collage.layoutId || 'auto';
    c.themeId = sess.collage.themeId || 'modern_minimal';
    c.orientation = sess.collage.orientation || 'landscape';
    c.bgColor = sess.collage.bgColor || '#ffffff';
    if (sess.project) {
      stashed = { project: project.project, path: project.savePath, pageIndex: editor.activePageIndex };
      entered = true;
      project.setProject(sess.project, null);
      if (project.project) project.syncUsage(project.project);
      c.records = (sess.project.imageRegistry as ImageRecord[]) || [];
      editor.setPage(0); editor.selectObject(null); editor.bottomPanel = 'images'; editor.requestRender();
      c.phase = 'edit';
    } else {
      c.records = sess.collage.records || [];
      c.phase = 'setup';
    }
  } finally { restoring = false; }
}

// Autosave on any change to the picker settings or the collage page.
watch(() => [c.folder, c.selected.length, c.layoutId, c.themeId, c.orientation, c.bgColor, c.phase], schedulePersist);
watch(() => project.project, schedulePersist, { deep: true });

onMounted(async () => {
  window.addEventListener('keydown', onKey);
  await restoreSession();
  c.records.forEach(ensureThumb);
});
onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey);
  editor.closeCutout(); // never leave the studio bound to a collage image for the next view
  if (saveTimer) clearTimeout(saveTimer);
  // Flush the latest state synchronously so a quick navigate-away still resumes.
  if (entered || c.folder) persistNow();
  disposed = true;
  // Restore whatever album was open before this tool ran.
  if (entered) {
    if (stashed?.project) { project.setProject(stashed.project, stashed.path); editor.setPage(stashed.pageIndex); }
    else { project.project = null; project.savePath = null; editor.setPage(0); editor.selectObject(null); }
  }
});
</script>

<template>
  <div class="h-full w-full flex flex-col bg-pebble-bg">
    <!-- ─────────────────────────── SETUP PHASE ─────────────────────────── -->
    <template v-if="c.phase === 'setup'">
      <header class="pa-topbar">
        <AppIconButton icon="home" label="Back to home" @click="router.push('/')" />
        <span class="font-semibold">Collage Creator</span>
        <span class="text-xs text-pebble-text-dim">Step 1 of 2 · Pick photos</span>
        <div class="flex-1"></div>
        <AppButton size="sm" variant="ghost" title="Discard this collage and start over" @click="clearCollage">Clear</AppButton>
        <AppButton size="sm" icon="arrow-right" :disabled="!selCount || building"
                   :title="selCount ? 'Open the selected photos in the collage editor' : 'Select at least one photo first'"
                   @click="create">{{ building ? 'Building…' : `Edit collage (${selCount})` }}</AppButton>
      </header>

      <div class="flex-1 flex min-h-0">
        <!-- Left: controls + photo picker -->
        <aside class="w-[420px] shrink-0 bg-pebble-surface border-r border-pebble-border flex flex-col">
          <div class="p-4 space-y-3 border-b border-pebble-border">
            <div class="pa-section">Source folder</div>
            <div class="flex items-center gap-2">
              <div class="flex-1 min-w-0 flex items-center gap-2 h-8 px-2.5 rounded-md bg-pebble-bg border border-pebble-border">
                <AppIcon name="folder" :size="15" class="text-pebble-text-dim" />
                <span class="text-xs font-mono truncate" :class="c.folder ? '' : 'text-pebble-text-off'" :title="c.folder">{{ c.folder || 'No folder selected' }}</span>
              </div>
              <AppButton variant="secondary" :disabled="loadingFolder" @click="pickFolder">{{ loadingFolder ? 'Scanning…' : 'Pick folder…' }}</AppButton>
            </div>
            <div class="pa-section pt-1">Starting point</div>
            <AppDropdown label="Layout" :model-value="c.layoutId" :options="layoutOptions" @update:model-value="v => c.layoutId = String(v)" />
            <div class="grid grid-cols-2 gap-2">
              <AppDropdown label="Theme" :model-value="c.themeId" :options="themeOptions" @update:model-value="v => c.themeId = String(v)" />
              <AppDropdown label="Shape" :model-value="c.orientation" :options="orientationOptions" @update:model-value="v => c.orientation = v as Orientation" />
            </div>
            <AppColorPicker label="Background" v-model="c.bgColor" />
            <p class="pa-hint">Only a starting point — layout, theme, background, borders, effects, stickers and text can all be changed in the editor.</p>
          </div>
          <div v-if="c.records.length" class="px-4 pt-3 flex items-baseline justify-between">
            <span class="pa-section">Photos</span>
            <span class="text-xs text-pebble-text-dim tabular-nums">{{ selCount }} of {{ c.records.length }} selected</span>
          </div>
          <div class="flex-1 overflow-auto p-3">
            <div v-if="!c.records.length" class="text-pebble-text-dim text-sm text-center mt-10 px-6">Pick a folder, then click photos to add them to the collage.</div>
            <div v-else class="grid grid-cols-3 gap-2">
              <button v-for="r in c.records" :key="r.relativePath" type="button" @click="toggle(r.relativePath)"
                      class="relative aspect-square rounded-md overflow-hidden ring-2 transition"
                      :class="orderOf(r.relativePath) ? 'ring-pebble-accent' : 'ring-transparent opacity-70 hover:opacity-100'"
                      :title="r.filename">
                <img v-if="src(r)" :src="src(r)" class="w-full h-full object-cover" />
                <div v-else class="w-full h-full bg-pebble-surface-2 animate-pulse" />
                <span v-if="orderOf(r.relativePath)" class="absolute top-1 right-1 min-w-[20px] h-5 px-1 rounded-full bg-pebble-accent text-pebble-on-accent text-2xs font-semibold grid place-items-center">{{ orderOf(r.relativePath) }}</span>
              </button>
            </div>
          </div>
        </aside>

        <!-- Right: hint / last result -->
        <section class="flex-1 flex items-center justify-center p-8 overflow-auto">
          <img v-if="c.resultDataUrl" :src="c.resultDataUrl" class="max-w-full max-h-full object-contain shadow-2xl shadow-black/50 rounded" />
          <AppEmptyState v-else icon="collage"
                         :title="c.records.length ? 'Choose the photos for your collage' : 'Pick a folder to start'"
                         :text="c.records.length
                           ? 'Click photos on the left in the order you want them, then press Edit collage (top right) — the editor has the same tools as an album page.'
                           : 'Choose a folder of photos, select a few, and arrange them into a collage you can download. Nothing is saved as a project.'">
            <AppButton v-if="!c.records.length" size="lg" icon="folder" :disabled="loadingFolder" @click="pickFolder">{{ loadingFolder ? 'Scanning…' : 'Pick folder…' }}</AppButton>
          </AppEmptyState>
        </section>
      </div>
    </template>

    <!-- ─────────────────────────── EDIT PHASE ──────────────────────────── -->
    <template v-else>
      <header class="pa-topbar">
        <AppIconButton icon="arrow-left" label="Back to photo selection" @click="backToPhotos" />
        <span class="font-semibold">Collage</span>
        <span class="text-xs text-pebble-text-dim">Step 2 of 2 · Edit</span>

        <div class="flex items-center ml-3">
          <AppIconButton icon="undo" :label="history.undoLabel || 'Undo'" :shortcut="`${MOD}Z`"
                         :disabled="!history.canUndo" disabled-hint="Nothing to undo" @click="history.undo()" />
          <AppIconButton icon="redo" :label="history.redoLabel || 'Redo'" :shortcut="`${MOD}Shift+Z`"
                         :disabled="!history.canRedo" disabled-hint="Nothing to redo" @click="history.redo()" />
        </div>
        <div class="w-px h-5 bg-pebble-border mx-1" />
        <div class="flex items-center">
          <AppIconButton icon="zoom-out" label="Zoom out" @click="editor.zoomOut()" />
          <span class="w-12 text-center text-xs tabular-nums">{{ editor.zoomPercent }}%</span>
          <AppIconButton icon="zoom-in" label="Zoom in" @click="editor.zoomIn()" />
          <AppIconButton icon="maximize" label="Fit to window" :shortcut="`${MOD}0`" @click="editor.resetZoom()" />
        </div>

        <div class="flex-1" />
        <AppButton size="sm" variant="ghost" title="Discard this collage and start over" @click="clearCollage">Clear</AppButton>
        <AppButton size="sm" icon="download" :disabled="downloading" title="Save the collage as a PNG" @click="download">{{ downloading ? 'Saving…' : 'Download' }}</AppButton>
      </header>

      <div class="flex-1 flex min-h-0">
        <!-- Center: insert bar + canvas + bottom tray (reused) -->
        <section class="flex-1 flex flex-col min-w-0 relative">
          <!-- Insert bar: the Add actions, always in the same place above the page -->
          <div class="h-10 shrink-0 flex items-center gap-1.5 px-3 bg-pebble-surface border-b border-pebble-border">
            <span class="pa-section mr-1">Add</span>
            <button type="button" class="pa-btn !h-7" :disabled="adding" title="Add photos from your computer as free overlays" @click="addPhotos">
              <AppIcon name="image-plus" :size="15" />{{ adding ? 'Adding…' : 'Photo' }}
            </button>
            <button type="button" class="pa-btn !h-7" title="Add text — opens the Text tab" @click="openPageTab('proverb')">
              <AppIcon name="type" :size="15" />Text
            </button>
            <button type="button" class="pa-btn !h-7" title="Add stickers and patterns — opens the Design tab" @click="openPageTab('design')">
              <AppIcon name="sticker" :size="15" />Sticker
            </button>
            <span class="flex-1 min-w-0 text-right pa-hint truncate">Drag to move · handles to resize · double-click a photo to crop inside its frame</span>
          </div>
          <AlbumCanvas />
          <div class="h-48 shrink-0 bg-pebble-surface border-t border-pebble-border flex flex-col">
            <AppTabs :model-value="editor.bottomPanel === 'themes' ? 'themes' : 'images'" :tabs="TRAY_TABS"
                     @update:model-value="v => editor.bottomPanel = v" />
            <div class="flex-1 overflow-hidden">
              <ImageStrip v-if="editor.bottomPanel === 'images'" />
              <ThemePanel v-else-if="editor.bottomPanel === 'themes'" />
            </div>
          </div>
        </section>

        <!-- Right: per-object properties / page design (reused) -->
        <aside class="w-[304px] shrink-0 bg-pebble-surface border-l border-pebble-border">
          <TextPropertiesPanel v-if="editor.hasSelection && editor.propertiesOpen && editor.selectedType === 'text'" />
          <PropertiesPanel v-else-if="editor.hasSelection && editor.propertiesOpen && editor.selectedType === 'image'" />
          <PagePanel v-else v-model:tab="pageTab" />
        </aside>
      </div>

      <!-- Erase / restore studio (same in-context mask editor as the album) -->
      <CutoutEditor v-if="editor.cutoutRequest" :filename="editor.cutoutRequest.filename"
                    :image-id="editor.cutoutRequest.imageId" @close="editor.closeCutout()" />
    </template>
  </div>
</template>
