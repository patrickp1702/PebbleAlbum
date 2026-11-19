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
 *              and "✎ Erase / restore parts" (mounts the shared CutoutEditor).
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
import AppTooltip from '@/components/ui/AppTooltip.vue';
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
      <header class="h-14 shrink-0 flex items-center gap-3 px-5 border-b border-pebble-border">
        <button class="h-8 px-3 rounded-lg text-sm text-pebble-text-dim hover:text-pebble-text hover:bg-white/5" @click="router.push('/')">‹ Home</button>
        <div class="font-semibold">Collage Creator</div>
        <span class="text-[11px] text-pebble-text-dim">Pick photos → edit → download</span>
        <div class="flex-1"></div>
        <AppButton size="sm" variant="ghost" @click="clearCollage">Clear</AppButton>
        <AppButton size="sm" :disabled="!selCount || building" @click="create">{{ building ? 'Building…' : `Edit collage (${selCount})` }}</AppButton>
      </header>

      <div class="flex-1 flex min-h-0">
        <!-- Left: controls + photo picker -->
        <aside class="w-[420px] shrink-0 border-r border-pebble-border flex flex-col">
          <div class="p-4 space-y-3 border-b border-pebble-border">
            <div class="flex items-center justify-between">
              <div class="text-sm font-mono truncate max-w-[240px]" :title="c.folder">{{ c.folder || 'No folder selected' }}</div>
              <AppButton size="sm" :disabled="loadingFolder" @click="pickFolder">{{ loadingFolder ? 'Scanning…' : 'Pick folder…' }}</AppButton>
            </div>
            <AppDropdown label="Starting layout" :model-value="c.layoutId" :options="layoutOptions" @update:model-value="v => c.layoutId = String(v)" />
            <div class="grid grid-cols-2 gap-2">
              <AppDropdown label="Theme" :model-value="c.themeId" :options="themeOptions" @update:model-value="v => c.themeId = String(v)" />
              <AppDropdown label="Shape" :model-value="c.orientation" :options="orientationOptions" @update:model-value="v => c.orientation = v as Orientation" />
            </div>
            <AppColorPicker label="Background" v-model="c.bgColor" />
            <p class="text-[11px] text-pebble-text-dim leading-relaxed">These are just a starting point — you can change the layout, theme, background, add borders, effects, stickers and text in the editor.</p>
          </div>
          <div class="flex-1 overflow-auto p-3">
            <div v-if="!c.records.length" class="text-pebble-text-dim text-sm text-center mt-10">Pick a folder, then tap photos to add them to the collage.</div>
            <div v-else class="grid grid-cols-3 gap-2">
              <button v-for="r in c.records" :key="r.relativePath" @click="toggle(r.relativePath)"
                      class="relative aspect-square rounded-lg overflow-hidden ring-2 transition"
                      :class="orderOf(r.relativePath) ? 'ring-pebble-accent' : 'ring-transparent opacity-70 hover:opacity-100'">
                <img v-if="src(r)" :src="src(r)" class="w-full h-full object-cover" />
                <div v-else class="w-full h-full bg-pebble-surface-2 animate-pulse" />
                <span v-if="orderOf(r.relativePath)" class="absolute top-1 right-1 w-5 h-5 rounded-full bg-pebble-accent text-white text-[11px] grid place-items-center">{{ orderOf(r.relativePath) }}</span>
              </button>
            </div>
          </div>
        </aside>

        <!-- Right: hint / last result -->
        <section class="flex-1 flex items-center justify-center p-8 overflow-auto bg-[#0d1124]">
          <img v-if="c.resultDataUrl" :src="c.resultDataUrl" class="max-w-full max-h-full object-contain shadow-2xl shadow-black/50 rounded" />
          <div v-else class="text-pebble-text-dim text-center max-w-sm">
            <div class="text-5xl mb-3">🖼️</div>
            <p>Select photos and hit <b>Edit collage</b> to open the full editor — same tools as an album page.</p>
          </div>
        </section>
      </div>
    </template>

    <!-- ─────────────────────────── EDIT PHASE ──────────────────────────── -->
    <template v-else>
      <header class="flex items-center gap-2 px-3 h-12 bg-pebble-surface border-b border-pebble-border text-sm">
        <button class="text-pebble-text-dim hover:text-pebble-text px-2" @click="backToPhotos">‹ Photos</button>
        <span class="font-semibold">Collage</span>
        <div class="flex items-center gap-1 ml-3">
          <AppTooltip :text="history.undoLabel"><button class="px-2 py-1 rounded hover:bg-white/5 disabled:opacity-30" :disabled="!history.canUndo" @click="history.undo()">↶</button></AppTooltip>
          <AppTooltip :text="history.redoLabel"><button class="px-2 py-1 rounded hover:bg-white/5 disabled:opacity-30" :disabled="!history.canRedo" @click="history.redo()">↷</button></AppTooltip>
        </div>
        <div class="flex items-center gap-1 ml-3">
          <button class="px-2 py-1 rounded hover:bg-white/5" @click="editor.zoomOut()">−</button>
          <span class="w-12 text-center tabular-nums">{{ editor.zoomPercent }}%</span>
          <button class="px-2 py-1 rounded hover:bg-white/5" @click="editor.zoomIn()">＋</button>
        </div>
        <div class="flex-1 text-center text-pebble-text-dim text-xs">Drag · resize · double-click to crop · right panel for effects, borders, decorations &amp; text</div>
        <AppButton size="sm" variant="ghost" @click="clearCollage">Clear</AppButton>
        <AppButton size="sm" @click="download">{{ downloading ? 'Saving…' : '⬇ Download' }}</AppButton>
      </header>

      <div class="flex-1 flex min-h-0">
        <!-- Center: canvas + bottom tool panel (reused) -->
        <section class="flex-1 flex flex-col min-w-0 relative">
          <AlbumCanvas />
          <div class="h-48 bg-pebble-surface border-t border-pebble-border flex flex-col">
            <nav class="flex items-center text-xs border-b border-pebble-border">
              <span class="px-3 text-[10px] uppercase tracking-wider text-pebble-text-dim/70">Add</span>
              <button @click="editor.bottomPanel = 'images'" :class="['px-4 py-2', editor.bottomPanel === 'images' ? 'text-pebble-accent border-b-2 border-pebble-accent' : 'text-pebble-text-dim']">Photos</button>
              <button @click="editor.bottomPanel = 'themes'" :class="['px-4 py-2', editor.bottomPanel === 'themes' ? 'text-pebble-accent border-b-2 border-pebble-accent' : 'text-pebble-text-dim']">Themes</button>
            </nav>
            <div class="flex-1 overflow-hidden">
              <ImageStrip v-if="editor.bottomPanel === 'images'" />
              <ThemePanel v-else-if="editor.bottomPanel === 'themes'" />
            </div>
          </div>
        </section>

        <!-- Right: per-object properties / page design (reused) -->
        <aside class="w-72 shrink-0 bg-pebble-surface border-l border-pebble-border">
          <TextPropertiesPanel v-if="editor.hasSelection && editor.propertiesOpen && editor.selectedType === 'text'" />
          <PropertiesPanel v-else-if="editor.hasSelection && editor.propertiesOpen && editor.selectedType === 'image'" />
          <PagePanel v-else />
        </aside>
      </div>

      <!-- Erase / restore studio (same in-context mask editor as the album) -->
      <CutoutEditor v-if="editor.cutoutRequest" :filename="editor.cutoutRequest.filename"
                    :image-id="editor.cutoutRequest.imageId" @close="editor.closeCutout()" />
    </template>
  </div>
</template>
