/**
 * projectStore.ts
 * -----------------------------------------------------------------------------
 * Single source of truth for the loaded album. Holds meta, pages and the image
 * registry, tracks the dirty flag, and persists every change back to the
 * `.pebble` file via debounced autosave.
 */
import { defineStore } from 'pinia';
import { ref, computed, watch } from 'vue';
import { v4 as uuid } from 'uuid';
import type {
  PebbleProject, AlbumMeta, AlbumPage, ImageRecord, PageImage,
} from '@shared/pebble.types';
import { resolveTheme } from '@/engine/themeEngine';
import { injectThemeVars } from '@/engine/themeEngine';
import { generateAlbum, type GeneratorConfig } from '@/engine/albumGenerator';

export type SaveState = 'idle' | 'saving' | 'saved' | 'error';

/** A blank album meta with sensible print defaults. */
export function createDefaultMeta(partial: Partial<AlbumMeta> = {}): AlbumMeta {
  const now = new Date().toISOString();
  return {
    name: 'Untitled Album', createdAt: now, updatedAt: now, sourceFolder: '',
    albumWidth: 3600, albumHeight: 2400, dpi: 300, unit: 'inch',
    theme: 'elegant_rose', coverTitle: '', coverSubtitle: '', coverDate: '',
    proverbs: [], pageBackgroundColor: '#ffffff', gutterWidth: 20,
    bleedMargin: 10, safeMargin: 20, pageCount: 0, orientation: 'landscape',
    bindingType: 'left', pageTurnStyle: 'curl', pageTurnSpeed: 'normal', autoSave: true,
    ...partial,
  };
}

export const useProjectStore = defineStore('project', () => {
  const project = ref<PebbleProject | null>(null);
  const savePath = ref<string | null>(null);
  const dirty = ref(false);
  const saveState = ref<SaveState>('idle');

  let autosaveTimer: ReturnType<typeof setTimeout> | null = null;

  const meta = computed(() => project.value?.meta ?? null);
  const pages = computed(() => project.value?.pages ?? []);
  const images = computed(() => project.value?.imageRegistry ?? []);
  const theme = computed(() => (meta.value ? resolveTheme(meta.value) : null));

  /** Images not yet placed on any page (drives the Image Bin). */
  const unusedImages = computed<ImageRecord[]>(() =>
    images.value.filter((r) => !r.skipped && r.usedOnPages.length === 0));

  function setProject(p: PebbleProject, path: string | null): void {
    // ⚠ Drop any autosave armed for the PREVIOUS project. Otherwise an album
    // edited <2s before Collage/Pixart swaps in its in-memory project would
    // fire save() on THAT project (no save path) and write a stray .pebble.
    if (autosaveTimer) { clearTimeout(autosaveTimer); autosaveTimer = null; }
    project.value = p;
    savePath.value = path;
    dirty.value = false;
    saveState.value = 'idle';
    if (p.meta) injectThemeVars(resolveTheme(p.meta));
  }

  /** Create a fresh project shell from generated pages + scanned images. */
  function initProject(m: AlbumMeta, registry: ImageRecord[], generated: AlbumPage[]): void {
    const p: PebbleProject = {
      version: '1.0', meta: { ...m, pageCount: generated.length },
      pages: generated, imageRegistry: registry,
    };
    syncUsage(p);
    setProject(p, null);
    dirty.value = true;
  }

  /** Recompute which pages each registry image is used on. */
  function syncUsage(p: PebbleProject): void {
    const map = new Map<string, string[]>();
    for (const page of p.pages) {
      for (const img of page.images) {
        const arr = map.get(img.filename) ?? [];
        arr.push(page.id);
        map.set(img.filename, arr);
      }
    }
    for (const rec of p.imageRegistry) rec.usedOnPages = map.get(rec.relativePath) ?? [];
  }

  function markDirty(): void {
    dirty.value = true;
    if (project.value) project.value.meta.updatedAt = new Date().toISOString();
    scheduleAutosave();
  }

  function scheduleAutosave(): void {
    if (!project.value?.meta.autoSave) return;
    if (autosaveTimer) clearTimeout(autosaveTimer);
    // Re-check at fire time: the in-memory tools (autoSave:false) must never save.
    autosaveTimer = setTimeout(() => { autosaveTimer = null; if (project.value?.meta.autoSave) void save(); }, 2000);
  }

  /** Last saved-to path, surfaced to the UI so the user knows where it went. */
  const lastSavedPath = ref<string | null>(null);

  /**
   * Persist to disk. The first save writes to ~/Documents/Pebble/<name>.pebble
   * (NO dialog) and registers it in the saved-projects list; later saves update
   * that file in place. So every project is automatically listed and openable.
   * @returns the saved path on the FIRST save (so the caller can announce it), else null.
   */
  async function save(): Promise<string | null> {
    if (!project.value) return null;
    saveState.value = 'saving';
    try {
      syncUsage(project.value);
      // ⚠ Send a PLAIN deep copy over IPC. The store holds a Vue reactive proxy,
      // and Electron's structured-clone of a proxy can throw "could not be
      // cloned" — which surfaced as "Could not save the project". JSON round-trip
      // guarantees a serialisable, proxy-free object.
      const payload = JSON.parse(JSON.stringify(project.value)) as PebbleProject;
      let firstSavePath: string | null = null;
      if (!savePath.value) {
        const saved = await window.pebble.saveProject(payload);
        savePath.value = saved;
        firstSavePath = saved;
        await window.pebble.addRecentProject(saved, project.value.meta.name);
      } else {
        await window.pebble.saveProject(payload, savePath.value);
      }
      lastSavedPath.value = savePath.value;
      dirty.value = false;
      saveState.value = 'saved';
      setTimeout(() => { if (saveState.value === 'saved') saveState.value = 'idle'; }, 1500);
      return firstSavePath;
    } catch (e) {
      saveState.value = 'error';
      throw e;
    }
  }

  /**
   * Re-run the album generator on the current images + meta with the new smart
   * (aspect-aware) layout logic, replacing all pages. Returns the new page count.
   */
  function regenerate(config: Partial<GeneratorConfig> = {}): number {
    if (!project.value) return 0;
    const generated = generateAlbum(project.value.meta, project.value.imageRegistry, config);
    project.value.pages = generated;
    project.value.meta.pageCount = generated.length;
    syncUsage(project.value);
    markDirty();
    return generated.length;
  }

  function getPage(index: number): AlbumPage | undefined { return pages.value[index]; }

  /** Find a PageImage by id across pages (used by properties panel). */
  function findImage(id: string): { page: AlbumPage; image: PageImage } | null {
    for (const page of pages.value) {
      const image = page.images.find((i) => i.id === id);
      if (image) return { page, image };
    }
    return null;
  }

  function addPage(at: number, page: AlbumPage): void {
    if (!project.value) return;
    project.value.pages.splice(at, 0, page);
    project.value.pages.forEach((p, i) => { p.index = i; });
    project.value.meta.pageCount = project.value.pages.length;
    markDirty();
  }

  function deletePage(index: number): void {
    if (!project.value) return;
    project.value.pages.splice(index, 1);
    project.value.pages.forEach((p, i) => { p.index = i; });
    project.value.meta.pageCount = project.value.pages.length;
    markDirty();
  }

  function duplicatePage(index: number): void {
    const src = pages.value[index];
    if (!src) return;
    const copy: AlbumPage = JSON.parse(JSON.stringify(src));
    copy.id = uuid();
    copy.images.forEach((i) => { i.id = uuid(); });
    addPage(index + 1, copy);
  }

  function reorderPage(from: number, to: number): void {
    if (!project.value) return;
    const arr = project.value.pages;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    arr.forEach((p, i) => { p.index = i; });
    markDirty();
  }

  // Keep the dirty flag in sync with deep mutations of the project tree.
  watch(project, () => { /* deep watch handled by explicit markDirty calls */ }, { deep: false });

  return {
    project, savePath, dirty, saveState, lastSavedPath,
    meta, pages, images, theme, unusedImages,
    setProject, initProject, syncUsage, markDirty, save, regenerate,
    getPage, findImage, addPage, deletePage, duplicatePage, reorderPage,
  };
});
