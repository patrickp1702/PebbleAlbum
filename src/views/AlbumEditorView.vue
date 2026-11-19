<script setup lang="ts">
/**
 * AlbumEditorView.vue
 * -----------------------------------------------------------------------------
 * The main editor: top toolbar, left PageStrip, center canvas (Fabric editor or
 * Three.js preview), right context panel (Properties / Image Bin), and a bottom
 * tool panel (Layouts / Themes / Decorations / Proverbs / Pages). Implements the
 * core keyboard shortcuts and the save/export actions.
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
import AppTooltip from '@/components/ui/AppTooltip.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AiConnectModal from '@/components/editor/AiConnectModal.vue';
import PhotoSelectionView from '@/components/editor/PhotoSelectionView.vue';
import CutoutEditor from '@/components/editor/CutoutEditor.vue';
import { SlideshowPlaylist, recordSlideshow, cancelRecording, slideshowTotalSec, pageDuration, type RecordProgress, type SceneHandle } from '@/engine/slideshowMedia';
import type { MusicTrack } from '@shared/ipc.types';

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
const bottomPanels = ['images', 'themes'] as const;

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

function onKey(e: KeyboardEvent) {
  // The Erase/restore studio is modal and owns the keyboard (its own undo/Esc/
  // Space) — page shortcuts must not fire underneath it.
  if (editor.cutoutRequest) return;
  const meta = e.ctrlKey || e.metaKey;
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
  else if (e.key === '?') { showShortcuts.value = true; }
}

onMounted(() => {
  if (!project.project) { router.replace('/'); return; }
  window.addEventListener('keydown', onKey);
});
onBeforeUnmount(() => { window.removeEventListener('keydown', onKey); stopAutoplay(); });
</script>

<template>
  <div class="h-full flex flex-col select-none">
    <!-- Top bar -->
    <header class="flex items-center gap-2 px-3 h-12 bg-pebble-surface border-b border-pebble-border text-sm">
      <button class="text-pebble-text-dim hover:text-pebble-text" @click="router.push('/')">☰</button>
      <span class="font-semibold">PebbleAlbum</span>
      <span class="text-pebble-text-dim mx-2">·</span>
      <span class="text-pebble-text-dim truncate max-w-[12rem]">{{ project.meta?.name }}</span>

      <div class="flex items-center gap-1 ml-4">
        <AppTooltip :text="history.undoLabel"><button class="px-2 py-1 rounded hover:bg-white/5 disabled:opacity-30" :disabled="!history.canUndo" @click="history.undo()">↶</button></AppTooltip>
        <AppTooltip :text="history.redoLabel"><button class="px-2 py-1 rounded hover:bg-white/5 disabled:opacity-30" :disabled="!history.canRedo" @click="history.redo()">↷</button></AppTooltip>
      </div>

      <div class="flex items-center gap-1 ml-4">
        <button class="px-2 py-1 rounded hover:bg-white/5" @click="editor.zoomOut()">−</button>
        <span class="w-12 text-center tabular-nums">{{ editor.zoomPercent }}%</span>
        <button class="px-2 py-1 rounded hover:bg-white/5" @click="editor.zoomIn()">＋</button>
      </div>

      <div class="flex-1 text-center text-pebble-text-dim">{{ pageLabel }}</div>

      <span class="text-xs mr-2" :class="project.saveState === 'saved' ? 'text-green-400' : 'text-pebble-text-dim'">
        {{ project.saveState === 'saving' ? 'Saving…' : project.saveState === 'saved' ? 'Saved' : project.dirty ? 'Unsaved' : '' }}
      </span>
      <AppButton size="sm" variant="ghost" @click="showStats = true">📊</AppButton>
      <AppButton size="sm" variant="ghost" @click="previewMode = !previewMode">{{ previewMode ? 'Edit' : '▶ Preview' }}</AppButton>
      <AppButton size="sm" variant="secondary" @click="showSelect = true">🖼 Select images</AppButton>
      <AppButton size="sm" variant="secondary" @click="showAi = true">🤖 Connect AI</AppButton>
      <AppButton size="sm" variant="secondary" @click="saveAndAnnounce">Save</AppButton>
      <AppButton size="sm" @click="router.push('/export')">Export</AppButton>
    </header>

    <!-- Body -->
    <div class="flex-1 flex min-h-0">
      <PageStrip />

      <!-- Center -->
      <section class="flex-1 flex flex-col min-w-0 relative">
        <AlbumCanvas />

        <!-- Bottom tool panel -->
        <div class="h-48 bg-pebble-surface border-t border-pebble-border flex flex-col">
          <nav class="flex items-center text-xs border-b border-pebble-border">
            <span class="px-3 text-[10px] uppercase tracking-wider text-pebble-text-dim/70">Album</span>
            <button v-for="p in bottomPanels" :key="p" @click="editor.bottomPanel = p"
                    :class="['px-4 py-2 capitalize', editor.bottomPanel === p ? 'text-pebble-accent border-b-2 border-pebble-accent' : 'text-pebble-text-dim']">{{ p }}</button>
            <button class="ml-auto mr-3 px-3 py-1 rounded bg-pebble-accent/20 text-pebble-accent-soft hover:bg-pebble-accent/30"
                    title="Re-flow every page with smart layouts" @click="regenerateAlbum">✨ Re-generate album</button>
          </nav>
          <div class="flex-1 overflow-hidden">
            <ImageStrip v-if="editor.bottomPanel === 'images'" />
            <ThemePanel v-else-if="editor.bottomPanel === 'themes'" />
          </div>
        </div>
      </section>

      <!-- Right panel -->
      <aside class="w-72 shrink-0 bg-pebble-surface border-l border-pebble-border">
        <TextPropertiesPanel v-if="editor.hasSelection && editor.propertiesOpen && editor.selectedType === 'text'" />
        <PropertiesPanel v-else-if="editor.hasSelection && editor.propertiesOpen && editor.selectedType === 'image'" />
        <PagePanel v-else />
      </aside>
    </div>

    <!-- Fullscreen preview (slideshow): only the page is shown, all chrome hidden -->
    <div v-if="previewMode" class="fixed inset-0 z-[80] bg-black flex flex-col">
      <PageTurnScene ref="turnScene" class="flex-1 min-h-0" :page-index="editor.activePageIndex"
                     :ken-burns="kenBurns" @page-changed="editor.setPage($event)" />
      <button class="absolute top-4 right-4 px-3 py-1.5 rounded-full bg-white/10 text-white text-sm hover:bg-white/20" @click="previewMode = false">✕ Exit preview</button>
      <button class="absolute inset-y-0 left-0 flex items-center px-4 text-white/70 hover:text-white text-4xl" @click="turnScene?.prev()">‹</button>
      <button class="absolute inset-y-0 right-0 flex items-center px-4 text-white/70 hover:text-white text-4xl" @click="turnScene?.next()">›</button>

      <!-- Slideshow control bar -->
      <div class="absolute bottom-5 left-1/2 -translate-x-1/2 flex items-center gap-3 px-5 py-2 rounded-full bg-white/10 backdrop-blur text-white text-sm">
        <button class="hover:text-pebble-accent-soft" :title="autoplay ? 'Pause' : 'Play'" @click="autoplay = !autoplay">{{ autoplay ? '❚❚' : '▶' }}</button>
        <span class="tabular-nums">{{ editor.activePageIndex + 1 }} / {{ project.pages.length }}</span>
        <label class="flex items-center gap-1 text-xs text-white/70">
          <span>every</span>
          <select v-model.number="intervalSec" class="bg-black/40 rounded px-1 py-0.5" title="Default seconds per page (pages can override in Page settings)">
            <option :value="2">2s</option><option :value="3">3s</option><option :value="4">4s</option><option :value="6">6s</option><option :value="8">8s</option>
          </select>
        </label>
        <label class="flex items-center gap-1 text-xs text-white/70">
          <span>turn</span>
          <select v-model="turnStyle" class="bg-black/40 rounded px-1 py-0.5" title="Page transition style">
            <option v-for="s in TURN_STYLES" :key="s.id" :value="s.id">{{ s.label }}</option>
          </select>
        </label>
        <button class="text-xs px-2 py-0.5 rounded-full"
                :class="selectedMusic.length ? 'bg-pebble-accent/40 text-white' : 'bg-black/30 text-white/70 hover:text-white'"
                title="Slideshow music" @click="showMusic = true; loadMusicList()">
          ♪ Music{{ selectedMusic.length ? ` (${selectedMusic.length})` : '' }}
        </button>
        <label class="flex items-center gap-1 text-xs text-white/70"><input type="checkbox" v-model="loopShow" /> Loop</label>
        <label class="flex items-center gap-1 text-xs text-white/70"><input type="checkbox" v-model="kenBurns" /> Ken Burns</label>
        <button class="text-xs px-2 py-0.5 rounded-full bg-black/30 text-white/80 hover:text-white" title="Download the slideshow as a video with music"
                :disabled="!!recording" @click="downloadVideo">⬇ Save video</button>
      </div>

      <!-- Music picker -->
      <div v-if="showMusic" class="absolute inset-0 z-[85] bg-black/60 flex items-center justify-center" @click.self="showMusic = false">
        <div class="w-[26rem] max-h-[70vh] overflow-auto rounded-xl bg-pebble-surface border border-pebble-border p-4 space-y-2">
          <div class="flex items-center justify-between">
            <div class="text-sm font-medium">♪ Slideshow music</div>
            <button class="h-7 px-2 rounded bg-pebble-surface-2 border border-pebble-border text-xs" @click="showMusic = false">✕</button>
          </div>
          <p class="text-[11px] text-pebble-text-dim">Pick one or more tracks — they play in order and loop back to the first when the show is longer than the music. Plays with ▶ and in the exported video.</p>
          <div v-if="!musicTracks.length" class="text-xs text-pebble-text-dim py-2">No tracks found.</div>
          <button v-for="t in musicTracks" :key="t.path" @click="toggleTrack(t.path)"
                  class="w-full flex items-center gap-2 px-2 py-1.5 rounded border text-left text-sm"
                  :class="selectedMusic.includes(t.path) ? 'border-pebble-accent bg-pebble-accent/10' : 'border-pebble-border hover:border-pebble-accent/50'">
            <span class="w-5 text-center text-xs tabular-nums text-pebble-accent">{{ selectedMusic.indexOf(t.path) >= 0 ? selectedMusic.indexOf(t.path) + 1 : '' }}</span>
            <span class="flex-1 truncate">{{ t.name }}</span>
            <span class="text-[10px] text-pebble-text-dim">{{ t.source === 'bundled' ? 'built-in' : 'my library' }}</span>
          </button>
          <AppButton size="sm" variant="secondary" block @click="addMusicFiles">＋ Add music from computer…</AppButton>
        </div>
      </div>

      <!-- Recording overlay -->
      <div v-if="recording" class="absolute inset-0 z-[86] bg-black/70 flex flex-col items-center justify-center gap-3 text-white">
        <div class="text-lg">🎬 Recording slideshow video…</div>
        <div class="text-sm text-white/80 tabular-nums">Page {{ recording.page }} / {{ recording.total }} · ~{{ Math.round(recording.totalSec) }}s total</div>
        <div class="w-72 h-2 rounded-full bg-white/15 overflow-hidden">
          <div class="h-full bg-pebble-accent transition-all" :style="{ width: `${Math.min(100, (recording.sec / Math.max(1, recording.totalSec)) * 100)}%` }" />
        </div>
        <p class="text-[11px] text-white/60 max-w-sm text-center">The video records the show in real time — exactly what you see, with your music. Keep this window visible.</p>
        <AppButton size="sm" variant="ghost" @click="cancelRecording()">Cancel</AppButton>
      </div>
    </div>

    <!-- Erase / restore studio (PicsArt-style, non-destructive mask) -->
    <CutoutEditor v-if="editor.cutoutRequest" :filename="editor.cutoutRequest.filename"
                  :image-id="editor.cutoutRequest.imageId" @close="editor.closeCutout()" />

    <!-- Shortcuts modal -->
    <AiConnectModal v-model:open="showAi" />
    <PhotoSelectionView v-if="project.meta" :open="showSelect" :folder="project.meta.sourceFolder" :records="project.images"
                        :preselect-skipped="currentSkipped" @update:open="showSelect = $event" @apply="applySelection" />

    <AppModal v-model:open="showShortcuts" title="Keyboard shortcuts">
      <ul class="text-sm space-y-1">
        <li><b>Ctrl/⌘ Z</b> — Undo · <b>Shift+Z</b> / <b>Y</b> — Redo</li>
        <li><b>Ctrl/⌘ S</b> — Save</li>
        <li><b>← / →</b> — Previous / next page</li>
        <li><b>Delete</b> — Remove selected</li>
        <li><b>Ctrl/⌘ 0</b> — Fit · <b>Ctrl/⌘ 1</b> — 100%</li>
        <li><b>?</b> — This panel</li>
      </ul>
    </AppModal>

    <!-- Stats modal -->
    <AppModal v-model:open="showStats" title="Album statistics">
      <div class="grid grid-cols-2 gap-3 text-sm">
        <div class="pa-panel p-3"><div class="text-2xl font-bold">{{ stats.pages }}</div><div class="text-pebble-text-dim text-xs">Pages</div></div>
        <div class="pa-panel p-3"><div class="text-2xl font-bold">{{ stats.used }}</div><div class="text-pebble-text-dim text-xs">Images used</div></div>
        <div class="pa-panel p-3"><div class="text-2xl font-bold">{{ stats.unused }}</div><div class="text-pebble-text-dim text-xs">Unused</div></div>
        <div class="pa-panel p-3"><div class="text-2xl font-bold">{{ stats.avg }}</div><div class="text-pebble-text-dim text-xs">Avg / page</div></div>
      </div>
    </AppModal>
  </div>
</template>
