<script setup lang="ts">
/**
 * AlbumEditorView.vue
 * -----------------------------------------------------------------------------
 * The main editor. Layout (the convention shared by layout/photo tools):
 *   top bar     project name · undo/redo · zoom · utilities · ONE primary (Export)
 *   left        PageStrip (structure)
 *   centre      insert bar (Add photo / text / sticker + page stepper) above the
 *               Fabric canvas; album-wide tray below (Images / Themes)
 *   right       context panel: the selection's properties, else the page panel
 *   overlay     fullscreen slideshow preview (Three.js)
 * Implements the core keyboard shortcuts and the save/export actions.
 */
import { ref, computed, watch, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useAppStore } from '@/stores/appStore';
import AlbumCanvas from '@/components/canvas/AlbumCanvas.vue';
import PageTurnScene from '@/components/canvas/PageTurnScene.vue';
import PageStrip from '@/components/editor/PageStrip.vue';
import PropertiesPanel from '@/components/editor/PropertiesPanel.vue';
import TextPropertiesPanel from '@/components/editor/TextPropertiesPanel.vue';
import ThemePanel from '@/components/editor/ThemePanel.vue';
import ImageStrip from '@/components/editor/ImageStrip.vue';
import PagePanel from '@/components/editor/PagePanel.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import AppIconButton from '@/components/ui/AppIconButton.vue';
import AppTabs from '@/components/ui/AppTabs.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AiConnectModal from '@/components/editor/AiConnectModal.vue';
import PhotoSelectionView from '@/components/editor/PhotoSelectionView.vue';
import CutoutEditor from '@/components/editor/CutoutEditor.vue';
import { SlideshowPlaylist, recordSlideshow, cancelRecording, slideshowTotalSec, pageDuration, type RecordProgress, type SceneHandle } from '@/engine/slideshowMedia';
import type { MusicTrack } from '@shared/ipc.types';
import { useAddPhoto } from '@/composables/useAddPhoto';
import { MOD, isTextEntry, isRangeInput } from '@/composables/keyboard';

const router = useRouter();
const project = useProjectStore();
const editor = useEditorStore();
const history = useHistoryStore();
const app = useAppStore();

const previewMode = ref(false);
const showShortcuts = ref(false);
const showAi = ref(false);
const showSelect = ref(false);
const currentSkipped = computed(() => project.images.filter((r) => r.skipped).map((r) => r.relativePath));

/** Apply a culling selection: keep only chosen photos; park any now-skipped placed photos. */
function applySelection(skipped: string[]) {
  const skip = new Set(skipped);
  for (const r of project.images) r.skipped = skip.has(r.relativePath);
  for (const pg of project.pages) for (const im of pg.images) if (skip.has(im.filename) && im.visible !== false) im.visible = false;
  project.markDirty();
  editor.requestRender();
  app.toast(`Kept ${project.images.filter((r) => !r.skipped).length} photos`, 'success', 1800);
}
const showStats = ref(false);
const turnScene = ref<InstanceType<typeof PageTurnScene> | null>(null);

// --- Slideshow (preview) controls -------------------------------------------
const autoplay = ref(false);
const loopShow = ref(true);
const kenBurns = ref(true);
let slideTimer: ReturnType<typeof setTimeout> | null = null;

/** Album-wide default seconds per page (each page can override). Persisted. */
const intervalSec = computed({
  get: () => project.meta?.slideshowInterval ?? 4,
  set: (v: number) => { if (project.meta) { project.meta.slideshowInterval = Math.max(1, v); project.markDirty(); } },
});
/** The active page's dwell time in the show (per-page override or default). */
const currentPageSec = () => pageDuration(project.pages[editor.activePageIndex], project.meta);

/** Named transition styles (persisted in meta.pageTurnStyle). */
const TURN_STYLES = [
  { id: 'curl', label: 'Page curl' }, { id: 'slide', label: 'Slide' },
  { id: 'push', label: 'Push' }, { id: 'fade', label: 'Fade' },
  { id: 'zoom', label: 'Zoom' }, { id: 'flip_up', label: 'Flip up' },
  { id: 'hard', label: 'Hard flip' },
] as const;
const turnStyle = computed({
  get: () => project.meta?.pageTurnStyle ?? 'curl',
  set: (v) => { if (project.meta) { project.meta.pageTurnStyle = v; project.markDirty(); } },
});

// Music: the selected playlist lives in meta.slideshowMusic; it plays during
// autoplay (the ▶ button) and loops back to the first track when it runs out.
const showMusic = ref(false);
const musicTracks = ref<MusicTrack[]>([]);
let playlist: SlideshowPlaylist | null = null;
const selectedMusic = computed(() => project.meta?.slideshowMusic ?? []);
async function loadMusicList() {
  try { musicTracks.value = await window.pebble.listMusic(); } catch { musicTracks.value = []; }
}
function toggleTrack(p: string) {
  if (!project.meta) return;
  const cur = [...(project.meta.slideshowMusic ?? [])];
  const i = cur.indexOf(p);
  if (i >= 0) cur.splice(i, 1); else cur.push(p);
  project.meta.slideshowMusic = cur;
  project.markDirty();
}
async function addMusicFiles() {
  try {
    const added = await window.pebble.addMusic();
    if (added.length) { await loadMusicList(); app.toast(`Added ${added.length} track(s) to your music library.`, 'success'); }
  } catch { app.toast('Could not add music.', 'error'); }
}
async function startMusic() {
  stopMusic();
  const paths = selectedMusic.value;
  if (!paths.length) return;
  playlist = new SlideshowPlaylist(true);
  const n = await playlist.load(paths);
  if (n) playlist.start(); else { playlist.dispose(); playlist = null; }
}
function stopMusic() { if (playlist) { playlist.stop(0.6); const p = playlist; setTimeout(() => p.dispose(), 800); playlist = null; } }

function stopAutoplay() { if (slideTimer) { clearTimeout(slideTimer); slideTimer = null; } stopMusic(); }
/** Per-page dwell chain: each page stays for ITS duration, then turns. */
function scheduleNextTurn() {
  if (slideTimer) clearTimeout(slideTimer);
  slideTimer = setTimeout(() => {
    if (!previewMode.value || !autoplay.value) return;
    if (editor.activePageIndex < project.pages.length - 1) turnScene.value?.next();
    else if (loopShow.value) editor.setPage(0);
    else { autoplay.value = false; return; }
    scheduleNextTurn();
  }, currentPageSec() * 1000);
}
function startAutoplay() {
  stopAutoplay();
  scheduleNextTurn();
  void startMusic();
}
watch([autoplay, () => previewMode.value], () => {
  if (previewMode.value && autoplay.value) startAutoplay(); else stopAutoplay();
});
// A manual page change while playing restarts the dwell for the new page.
watch(() => editor.activePageIndex, () => { if (previewMode.value && autoplay.value) scheduleNextTurn(); });

// --- Download slideshow as video ---------------------------------------------
const recording = ref<null | RecordProgress>(null);
async function downloadVideo() {
  if (!project.meta || !turnScene.value || recording.value) return;
  const scene = turnScene.value as unknown as SceneHandle;
  const wasAutoplay = autoplay.value;
  autoplay.value = false;
  stopAutoplay();
  recording.value = { page: 1, total: project.pages.length, sec: 0, totalSec: slideshowTotalSec(project.pages as never, project.meta) };
  try {
    const result = await recordSlideshow(scene, project.pages as never, project.meta, selectedMusic.value, (p) => { recording.value = p; });
    if (!result) { app.toast('Video export cancelled.', 'info'); return; }
    const buf = await result.blob.arrayBuffer();
    const name = `${(project.meta.name || 'slideshow').replace(/[^a-z0-9_\- ]/gi, '')}_slideshow.${result.ext}`;
    const saved = await window.pebble.saveVideo(buf, name);
    if (saved) {
      app.toast(`Saved ${result.ext.toUpperCase()} video: ${saved}`, 'success', 6000);
      if (result.ext === 'webm') app.toast('MP4 not supported by this system encoder — saved WebM instead.', 'info', 6000);
    }
  } catch (e) {
    app.toast(`Video export failed: ${(e as Error).message || e}`, 'error', 6000);
  } finally {
    recording.value = null;
    void turnScene.value?.jumpTo(editor.activePageIndex);
    if (wasAutoplay) autoplay.value = wasAutoplay;
  }
}

const pageLabel = computed(() => `Page ${editor.activePageIndex + 1} of ${project.pages.length}`);
const BOTTOM_TABS = [
  { id: 'images', label: 'Images', icon: 'images' },
  { id: 'themes', label: 'Themes', icon: 'palette' },
] as const;

// --- Insert bar (above the canvas) -------------------------------------------
/** Add photo: the ONE shared implementation (also used by PagePanel / Pixart). */
const { adding, addPhotos } = useAddPhoto();
const activePage = computed(() => project.pages[editor.activePageIndex]);
/** The page panel's active tab is owned here so the insert bar can open one. */
const pageTab = ref<'layers' | 'layout' | 'design' | 'proverb' | 'settings'>('layers');
/** Show the page panel on `tab` (leaves any selection panel, like its Back button). */
function openPageTab(tab: 'design' | 'proverb') {
  editor.cropImageId = null;
  editor.propertiesOpen = false;
  editor.requestRender();
  pageTab.value = tab;
}
/** Page stepper — the same navigation as the ← / → keys. */
function stepPage(d: 1 | -1) {
  const n = editor.activePageIndex + d;
  if (n >= 0 && n < project.pages.length) editor.setPage(n);
}

const stats = computed(() => {
  const pages = project.pages;
  const used = new Set<string>();
  pages.forEach((p) => p.images.forEach((i) => used.add(i.filename)));
  return {
    pages: pages.length,
    used: used.size,
    unused: project.unusedImages.length,
    avg: (pages.reduce((s, p) => s + p.images.length, 0) / Math.max(1, pages.length)).toFixed(1),
  };
});

/** Re-flow the WHOLE album with the smart layout engine (album-wide action). */
function regenerateAlbum() {
  // eslint-disable-next-line no-alert
  if (!window.confirm('Re-generate all pages with smart layouts? Images are kept; the arrangement is replaced.')) return;
  const n = project.regenerate();
  history.clear();
  editor.setPage(0);
  editor.requestRender();
  app.toast(`Re-generated ${n} pages with aspect-aware layouts.`, 'success', 2500);
}

/** Save, and on the first save tell the user where the file landed. */
async function saveAndAnnounce() {
  try {
    const firstPath = await project.save();
    if (firstPath) app.toast(`Saved to ${firstPath}`, 'success', 5000);
    else app.toast('Saved', 'success', 1200);
  } catch (e) {
    app.toast(`Could not save: ${(e as Error).message || e}`, 'error', 6000);
  }
}

function deleteSelected() {
  const id = editor.selectedObjectId;
  if (!id) return;
  const page = project.pages[editor.activePageIndex];
  if (!page) return;
  const img = page.images.find((i) => i.id === id);
  if (img) {
    if (img.free) {
      // Free-floating photos are removed entirely.
      page.images = page.images.filter((i) => i.id !== id);
      if (project.project) project.syncUsage(project.project);
      app.toast('Removed image', 'info', 1200);
    } else {
      // Slot images move to "Not placed" so they stay assigned to the page.
      img.visible = false;
      app.toast('Moved to “Not placed”. Re-add it from the right panel anytime.', 'info', 2500);
    }
  } else {
    const decoIdx = page.decorations.findIndex((d) => d.id === id);
    if (decoIdx >= 0) page.decorations.splice(decoIdx, 1);
    else {
      const tIdx = page.textBlocks.findIndex((t) => t.id === id);
      if (tIdx >= 0) { page.textBlocks.splice(tIdx, 1); app.toast('Removed text', 'info', 1200); }
    }
  }
  project.markDirty();
  editor.selectObject(null);
  editor.requestRender();
}

// --- Preview chrome auto-hide (presentation only) ----------------------------
// In the fullscreen slideshow the control bar, Exit button and page arrows fade
// out after a few seconds without pointer movement so nothing covers the page,
// and come back on any move / click / keyboard focus. They stay while the
// pointer rests on the bar, the music picker is open or a recording is running.
const chromeVisible = ref(true);
let chromeTimer: ReturnType<typeof setTimeout> | null = null;
let chromeHeld = false;
function pokeChrome() {
  chromeVisible.value = true;
  if (chromeTimer) clearTimeout(chromeTimer);
  chromeTimer = setTimeout(() => {
    if (!chromeHeld && !showMusic.value && !recording.value) chromeVisible.value = false;
  }, 3000);
}
function holdChrome(on: boolean) { chromeHeld = on; pokeChrome(); }
watch(previewMode, (on) => { if (on) pokeChrome(); else if (chromeTimer) clearTimeout(chromeTimer); });

function onKey(e: KeyboardEvent) {
  // The Erase/restore studio is modal and owns the keyboard (its own undo/Esc/
  // Space) — page shortcuts must not fire underneath it.
  if (editor.cutoutRequest) return;
  const meta = e.ctrlKey || e.metaKey;
  // Typing guard: while the user types in a field (caption, text content, X/Y/
  // W/H, hex colour, a select) the keys belong to that field — otherwise
  // Backspace in the Caption box deletes the selected photo. Only Escape and
  // Save pass through. Sliders and checkboxes are not text entry (Delete/undo
  // still work after dragging a slider), but a focused slider keeps its arrows.
  if (isTextEntry(e.target) && !(e.key === 'Escape' || (meta && e.key === 's'))) return;
  if (isRangeInput(e.target) && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) return;
  if (e.key === 'Escape') { if (previewMode.value) previewMode.value = false; else if (editor.cropImageId) { editor.cropImageId = null; editor.requestRender(); } else editor.selectObject(null); }
  else if (meta && e.key === 'z') { e.preventDefault(); e.shiftKey ? history.redo() : history.undo(); }
  else if (meta && e.key === 'y') { e.preventDefault(); history.redo(); }
  else if (meta && e.key === 's') { e.preventDefault(); void saveAndAnnounce(); }
  else if (meta && e.key === '0') { e.preventDefault(); editor.resetZoom(); }
  else if (meta && e.key === '1') { e.preventDefault(); editor.setZoom(1); }
  else if (e.key === 'Delete' || e.key === 'Backspace') { if (editor.hasSelection && !previewMode.value) { e.preventDefault(); deleteSelected(); } }
  else if (e.key === 'ArrowRight') {
    // In preview, arrow keys drive the animated page turn (not an instant jump).
    if (previewMode.value) turnScene.value?.next();
    else if (editor.activePageIndex < project.pages.length - 1) editor.setPage(editor.activePageIndex + 1);
  }
  else if (e.key === 'ArrowLeft') {
    if (previewMode.value) turnScene.value?.prev();
    else if (editor.activePageIndex > 0) editor.setPage(editor.activePageIndex - 1);
  }
  // (Not in Preview: the dialog would open underneath the fullscreen slideshow.)
  else if (e.key === '?' && !previewMode.value) { showShortcuts.value = true; }
}

onMounted(() => {
  if (!project.project) { router.replace('/'); return; }
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); stopAutoplay(); if (chromeTimer) clearTimeout(chromeTimer); });
</script>

<template>
  <div class="h-full flex flex-col select-none">
    <!-- Top bar: where am I · history · view · utilities · the ONE primary action -->
    <header class="pa-topbar">
      <AppIconButton icon="home" label="Back to home" @click="router.push('/')" />
      <div class="flex items-baseline gap-2 min-w-0 ml-1">
        <span class="font-semibold truncate max-w-[14rem]" :title="project.meta?.name">{{ project.meta?.name }}</span>
        <span class="text-xs shrink-0" :class="project.saveState === 'saved' ? 'text-pebble-success' : project.dirty && project.saveState !== 'saving' ? 'text-pebble-warning' : 'text-pebble-text-dim'">
          {{ project.saveState === 'saving' ? 'Saving…' : project.saveState === 'saved' ? 'Saved' : project.dirty ? 'Unsaved' : '' }}
        </span>
      </div>

      <div class="w-px h-5 bg-pebble-border mx-1.5" />
      <div class="flex items-center">
        <AppIconButton icon="undo" :label="history.undoLabel || 'Undo'" :shortcut="`${MOD}Z`" :disabled="!history.canUndo" disabled-hint="Nothing to undo" @click="history.undo()" />
        <AppIconButton icon="redo" :label="history.redoLabel || 'Redo'" :shortcut="`${MOD}Shift+Z`" :disabled="!history.canRedo" disabled-hint="Nothing to redo" @click="history.redo()" />
      </div>

      <div class="w-px h-5 bg-pebble-border mx-1.5" />
      <div class="flex items-center">
        <AppIconButton icon="zoom-out" label="Zoom out" @click="editor.zoomOut()" />
        <span class="w-11 text-center text-xs tabular-nums text-pebble-text" title="Zoom">{{ editor.zoomPercent }}%</span>
        <AppIconButton icon="zoom-in" label="Zoom in" @click="editor.zoomIn()" />
        <AppIconButton icon="maximize" label="Fit page to window" :shortcut="`${MOD}0`" @click="editor.resetZoom()" />
      </div>

      <div class="flex-1" />

      <AppIconButton icon="chart" label="Album statistics" @click="showStats = true" />
      <AppIconButton icon="keyboard" label="Keyboard shortcuts" shortcut="?" @click="showShortcuts = true" />
      <div class="w-px h-5 bg-pebble-border mx-1.5" />
      <AppButton size="md" variant="ghost" icon="images" title="Choose which photos from the folder are used in the album" @click="showSelect = true"><span class="hidden xl:inline">Select images</span></AppButton>
      <AppButton size="md" variant="ghost" icon="bot" title="Let an AI agent edit this album through the built-in MCP server" @click="showAi = true"><span class="hidden xl:inline">Connect AI</span></AppButton>
      <AppButton size="md" variant="secondary" icon="play" title="Fullscreen slideshow preview" @click="previewMode = !previewMode">{{ previewMode ? 'Edit' : 'Preview' }}</AppButton>
      <AppButton size="md" variant="secondary" icon="save" :title="`Save (${MOD}S)`" @click="saveAndAnnounce">Save</AppButton>
      <AppButton size="md" icon="upload" title="Export the album as PDF or images" @click="router.push('/export')">Export</AppButton>
    </header>

    <!-- Body -->
    <div class="flex-1 flex min-h-0">
      <PageStrip />

      <!-- Center -->
      <section class="flex-1 flex flex-col min-w-0 relative">
        <!-- Insert bar: everything you can ADD to the page, plus the page stepper -->
        <div class="h-10 shrink-0 flex items-center gap-1.5 px-2 bg-pebble-surface border-b border-pebble-border">
          <span class="pa-section mr-1 hidden lg:inline">Add</span>
          <button type="button" class="pa-btn !h-7" :disabled="adding || !!activePage?.locked"
                  :title="activePage?.locked ? 'Page is locked — unlock it (right-click the page) to add photos' : 'Add photos from your computer on top of this page'"
                  @click="addPhotos">
            <AppIcon name="image-plus" :size="15" />{{ adding ? 'Adding…' : 'Photo' }}
          </button>
          <button type="button" class="pa-btn !h-7" title="Add text or a proverb — opens the Text tab" @click="openPageTab('proverb')">
            <AppIcon name="type" :size="15" />Text
          </button>
          <button type="button" class="pa-btn !h-7" title="Add a sticker or pattern — opens the Design tab" @click="openPageTab('design')">
            <AppIcon name="sticker" :size="15" />Sticker
          </button>
          <div class="flex-1" />
          <AppIconButton size="sm" icon="chevron-left" label="Previous page" shortcut="←" :disabled="editor.activePageIndex <= 0" @click="stepPage(-1)" />
          <span class="text-xs text-pebble-text-dim tabular-nums whitespace-nowrap">{{ pageLabel }}</span>
          <AppIconButton size="sm" icon="chevron-right" label="Next page" shortcut="→" :disabled="editor.activePageIndex >= project.pages.length - 1" @click="stepPage(1)" />
        </div>

        <AlbumCanvas />

        <!-- Album-wide tray -->
        <div class="h-48 shrink-0 bg-pebble-surface border-t border-pebble-border flex flex-col">
          <div class="flex items-center border-b border-pebble-border shrink-0">
            <span class="pa-section pl-3 pr-1">Album</span>
            <AppTabs :model-value="editor.bottomPanel ?? 'images'" :tabs="BOTTOM_TABS" class="!border-b-0" @update:model-value="(v) => (editor.bottomPanel = v as typeof editor.bottomPanel)" />
            <button type="button" class="pa-btn !h-7 ml-auto mr-2"
                    title="Re-flow every page with smart layouts (asks first)" @click="regenerateAlbum">
              <AppIcon name="sparkles" :size="14" />Re-generate album
            </button>
          </div>
          <div class="flex-1 overflow-hidden">
            <ImageStrip v-if="editor.bottomPanel === 'images'" />
            <ThemePanel v-else-if="editor.bottomPanel === 'themes'" />
          </div>
        </div>
      </section>

      <!-- Right panel: the selection's properties, else the page -->
      <aside class="w-[304px] shrink-0 bg-pebble-surface border-l border-pebble-border">
        <TextPropertiesPanel v-if="editor.hasSelection && editor.propertiesOpen && editor.selectedType === 'text'" />
        <PropertiesPanel v-else-if="editor.hasSelection && editor.propertiesOpen && editor.selectedType === 'image'" />
        <PagePanel v-else v-model:tab="pageTab" />
      </aside>
    </div>

    <!-- Fullscreen preview (slideshow): only the page is shown, all chrome hidden -->
    <div v-if="previewMode" class="fixed inset-0 z-[80] bg-black flex flex-col" :class="chromeVisible ? '' : 'cursor-none'"
         @pointermove="pokeChrome" @pointerdown="pokeChrome" @focusin="pokeChrome">
      <PageTurnScene ref="turnScene" class="flex-1 min-h-0" :page-index="editor.activePageIndex"
                     :ken-burns="kenBurns" @page-changed="editor.setPage($event)" />
      <button type="button" :class="chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'" class="transition-opacity duration-300 absolute top-4 right-4 h-8 pl-2 pr-3 inline-flex items-center gap-1.5 rounded-md bg-pebble-surface-2/90 border border-pebble-border-strong/50 text-pebble-text text-xs font-medium hover:bg-pebble-hover"
              title="Exit preview (Esc)" @click="previewMode = false"><AppIcon name="x" :size="15" />Exit preview</button>
      <button type="button" :class="chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'" class="absolute inset-y-0 left-0 flex items-center px-3 text-white/60 hover:text-white transition-[color,opacity] duration-300" title="Previous page (←)" aria-label="Previous page" @click="turnScene?.prev()"><AppIcon name="chevron-left" :size="36" /></button>
      <button type="button" :class="chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'" class="absolute inset-y-0 right-0 flex items-center px-3 text-white/60 hover:text-white transition-[color,opacity] duration-300" title="Next page (→)" aria-label="Next page" @click="turnScene?.next()"><AppIcon name="chevron-right" :size="36" /></button>

      <!-- Slideshow control bar -->
      <div :class="chromeVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'" @pointerenter="holdChrome(true)" @pointerleave="holdChrome(false)"
           class="transition-opacity duration-300 absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-3 pl-2 pr-3 h-12 rounded-xl bg-pebble-surface-2/90 border border-pebble-border-strong/50 shadow-pop text-pebble-text text-xs whitespace-nowrap">
        <button type="button" class="h-8 w-8 grid place-items-center rounded-md bg-pebble-accent text-pebble-on-accent hover:bg-pebble-accent-hover"
                :title="autoplay ? 'Pause' : 'Play'" :aria-label="autoplay ? 'Pause' : 'Play'" @click="autoplay = !autoplay"><AppIcon :name="autoplay ? 'pause' : 'play'" :size="15" /></button>
        <span class="tabular-nums text-sm">{{ editor.activePageIndex + 1 }} / {{ project.pages.length }}</span>
        <div class="w-px h-5 bg-pebble-border" />
        <label class="flex items-center gap-1.5 text-pebble-text-dim">
          <span>Every</span>
          <select v-model.number="intervalSec" class="pa-input h-7 !py-0 !px-1.5 text-xs" title="Default seconds per page (pages can override in Page settings)">
            <option :value="2">2s</option><option :value="3">3s</option><option :value="4">4s</option><option :value="6">6s</option><option :value="8">8s</option>
          </select>
        </label>
        <label class="flex items-center gap-1.5 text-pebble-text-dim">
          <span>Turn</span>
          <select v-model="turnStyle" class="pa-input h-7 !py-0 !px-1.5 text-xs" title="Page transition style">
            <option v-for="s in TURN_STYLES" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
        </label>
        <button type="button" class="pa-btn !h-7" :class="selectedMusic.length ? '!border-pebble-accent !text-pebble-accent-soft' : ''"
                title="Slideshow music" @click="showMusic = true; loadMusicList()">
          <AppIcon name="music" :size="14" />Music{{ selectedMusic.length ? ` (${selectedMusic.length})` : '' }}
        </button>
        <label class="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" v-model="loopShow" /> Loop</label>
        <label class="flex items-center gap-1.5 cursor-pointer" title="Slow zoom on each page"><input type="checkbox" v-model="kenBurns" /> Ken Burns</label>
        <div class="w-px h-5 bg-pebble-border" />
        <button type="button" class="pa-btn !h-7" title="Download the slideshow as a video with music"
                :disabled="!!recording" @click="downloadVideo"><AppIcon name="download" :size="14" />Save video</button>
      </div>

      <!-- Music picker -->
      <div v-if="showMusic" class="absolute inset-0 z-[85] bg-black/60 flex items-center justify-center" @click.self="showMusic = false">
        <div class="w-[26rem] max-h-[70vh] flex flex-col rounded-2xl bg-pebble-surface border border-pebble-border shadow-modal">
          <div class="flex items-center justify-between pl-4 pr-2 h-12 border-b border-pebble-border shrink-0">
            <div class="flex items-center gap-2 text-base font-semibold"><AppIcon name="music" :size="17" class="text-pebble-text-dim" />Slideshow music</div>
            <button type="button" class="pa-iconbtn" aria-label="Close" title="Close" @click="showMusic = false"><AppIcon name="x" /></button>
          </div>
          <div class="p-4 space-y-2 overflow-auto">
            <p class="pa-hint">Pick one or more tracks — they play in order and loop back to the first when the show is longer than the music. Plays with Play and in the exported video.</p>
            <div v-if="!musicTracks.length" class="text-xs text-pebble-text-dim py-2">No tracks found. Add music from your computer below.</div>
            <button v-for="t in musicTracks" :key="t.path" type="button" @click="toggleTrack(t.path)" :aria-pressed="selectedMusic.includes(t.path)"
                    :class="['pa-tile w-full flex items-center gap-2 px-2 h-9 text-left text-sm', selectedMusic.includes(t.path) ? 'is-active' : '']">
              <span class="w-5 h-5 grid place-items-center rounded text-2xs font-semibold tabular-nums"
                    :class="selectedMusic.includes(t.path) ? 'bg-pebble-accent text-pebble-on-accent' : 'border border-pebble-border-strong'">{{ selectedMusic.indexOf(t.path) >= 0 ? selectedMusic.indexOf(t.path) + 1 : '' }}</span>
              <span class="flex-1 truncate">{{ t.name }}</span>
              <span class="text-2xs text-pebble-text-dim">{{ t.source === 'bundled' ? 'Built-in' : 'My library' }}</span>
            </button>
            <AppButton size="md" variant="secondary" icon="plus" block @click="addMusicFiles">Add music from computer…</AppButton>
          </div>
        </div>
      </div>

      <!-- Recording overlay: status on a surface card so it reads over any page -->
      <div v-if="recording" class="absolute inset-0 z-[86] bg-black/75 flex items-center justify-center p-6">
        <div class="w-full max-w-sm rounded-2xl bg-pebble-surface border border-pebble-border shadow-modal p-5 flex flex-col items-center gap-3 text-center" role="status">
          <div class="flex items-center gap-2 text-base font-semibold"><AppIcon name="film" :size="18" class="text-pebble-accent-soft" />Recording slideshow video…</div>
          <div class="text-sm text-pebble-text-dim tabular-nums">Page {{ recording.page }} / {{ recording.total }} · ~{{ Math.round(recording.totalSec) }}s total</div>
          <div class="w-full h-1.5 rounded-full bg-pebble-pressed overflow-hidden">
            <div class="h-full rounded-full bg-pebble-accent transition-all" :style="{ width: `${Math.min(100, (recording.sec / Math.max(1, recording.totalSec)) * 100)}%` }" />
          </div>
          <p class="pa-hint">The video records the show in real time — exactly what you see, with your music. Keep this window visible.</p>
          <AppButton size="md" variant="secondary" @click="cancelRecording()">Cancel</AppButton>
        </div>
      </div>
    </div>

    <!-- Erase / restore studio (non-destructive mask) -->
    <CutoutEditor v-if="editor.cutoutRequest" :filename="editor.cutoutRequest.filename"
                  :image-id="editor.cutoutRequest.imageId" :mode="editor.cutoutRequest.mode" @close="editor.closeCutout()" />

    <AiConnectModal v-model:open="showAi" />
    <PhotoSelectionView v-if="project.meta" :open="showSelect" :folder="project.meta.sourceFolder" :records="project.images"
                        :preselect-skipped="currentSkipped" @update:open="showSelect = $event" @apply="applySelection" />

    <!-- Shortcuts modal -->
    <AppModal v-model:open="showShortcuts" title="Keyboard shortcuts" width="480px">
      <dl class="grid grid-cols-[1fr_auto] gap-x-6 gap-y-2.5 text-sm items-center">
        <dt>Undo</dt><dd class="flex gap-1 justify-end"><kbd class="pa-kbd">Ctrl/⌘</kbd><kbd class="pa-kbd">Z</kbd></dd>
        <dt>Redo</dt><dd class="flex gap-1 justify-end items-center"><kbd class="pa-kbd">Ctrl/⌘</kbd><kbd class="pa-kbd">Shift</kbd><kbd class="pa-kbd">Z</kbd><span class="text-pebble-text-dim text-xs px-0.5">or</span><kbd class="pa-kbd">Ctrl/⌘</kbd><kbd class="pa-kbd">Y</kbd></dd>
        <dt>Save</dt><dd class="flex gap-1 justify-end"><kbd class="pa-kbd">Ctrl/⌘</kbd><kbd class="pa-kbd">S</kbd></dd>
        <dt>Previous / next page</dt><dd class="flex gap-1 justify-end"><kbd class="pa-kbd">←</kbd><kbd class="pa-kbd">→</kbd></dd>
        <dt>Remove selected</dt><dd class="flex gap-1 justify-end"><kbd class="pa-kbd">Delete</kbd></dd>
        <dt>Deselect / exit preview</dt><dd class="flex gap-1 justify-end"><kbd class="pa-kbd">Esc</kbd></dd>
        <dt>Fit page to window</dt><dd class="flex gap-1 justify-end"><kbd class="pa-kbd">Ctrl/⌘</kbd><kbd class="pa-kbd">0</kbd></dd>
        <dt>Zoom to 100%</dt><dd class="flex gap-1 justify-end"><kbd class="pa-kbd">Ctrl/⌘</kbd><kbd class="pa-kbd">1</kbd></dd>
        <dt>Show this panel</dt><dd class="flex gap-1 justify-end"><kbd class="pa-kbd">?</kbd></dd>
      </dl>
    </AppModal>

    <!-- Stats modal -->
    <AppModal v-model:open="showStats" title="Album statistics" width="480px">
      <div class="grid grid-cols-4 divide-x divide-pebble-border rounded-lg border border-pebble-border bg-pebble-surface-2">
        <div class="px-3 py-3"><div class="text-2xl font-semibold tabular-nums">{{ stats.pages }}</div><div class="pa-label mt-0.5">Pages</div></div>
        <div class="px-3 py-3"><div class="text-2xl font-semibold tabular-nums">{{ stats.used }}</div><div class="pa-label mt-0.5">Images used</div></div>
        <div class="px-3 py-3"><div class="text-2xl font-semibold tabular-nums" :class="stats.unused ? 'text-pebble-warning' : ''">{{ stats.unused }}</div><div class="pa-label mt-0.5">Unused</div></div>
        <div class="px-3 py-3"><div class="text-2xl font-semibold tabular-nums">{{ stats.avg }}</div><div class="pa-label mt-0.5">Avg / page</div></div>
      </div>
    </AppModal>
  </div>
</template>
