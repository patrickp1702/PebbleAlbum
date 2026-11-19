/**
 * useAddPhoto.ts — the ONE implementation of "＋ Add photo" (PicsArt-style
 * overlay), shared by every editor that composes the album editing module:
 * PagePanel's Layers tab (album + Collage) and PixartView's header button.
 *
 * Flow: file dialog (multi-select, `window.pebble.addPhotos`) → main copies
 * outside files into `<sourceFolder>/added/` and returns registry records →
 * records are merged into the registry (by relativePath) → each becomes a FREE
 * overlay `PageImage` on the active page, as ONE undoable history command.
 * New records stay in the registry on undo (they are just "unused images" then —
 * the copied file is still on disk).
 *
 * `buildFreePhotos` is the pure placement half, exported so a caller can place
 * records it already has without a dialog or a history entry (Pixart's first
 * pick: photos 2..n of the opening dialog become overlays of the new base).
 *
 * Lives in composables/ (not a store) because it is UI orchestration over the
 * stores — dialog, toasts, selection — not state. `adding` is module-scoped so
 * two buttons wired to it (header + panel) can never open two dialogs at once.
 */
import { ref } from 'vue';
import { v4 as uuid } from 'uuid';
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { useHistoryStore } from '@/stores/historyStore';
import { useAppStore } from '@/stores/appStore';
import { defaultEffects } from '@/engine/collageComposer';
import type { AlbumPage, ImageRecord, PageImage } from '@shared/pebble.types';

/** Shared across every caller: true while the OS file dialog / copy is running. */
const adding = ref(false);

/**
 * Records → FREE overlay photos for `page` (pure; does not mutate the page).
 * Placement: centred, ~45% of the album width but capped at 70% of its height,
 * TRUE aspect ratio (⚠ never stretched), above every photo already on the page,
 * and staggered so several photos don't hide each other. No slotRect / border /
 * shadow — it's a plain cut-out-friendly overlay.
 */
export function buildFreePhotos(recs: ImageRecord[], page: AlbumPage, W: number, H: number): PageImage[] {
  const topZ = page.images.reduce((z, i) => Math.max(z, i.zIndex), -1);
  const step = Math.min(W, H) * 0.04; // stagger so photos don't stack exactly
  return recs.map((rec, i) => {
    const ar = rec.width && rec.height ? rec.width / rec.height : 1.5;
    let w = W * 0.45; let h = w / ar;
    if (h > H * 0.7) { h = H * 0.7; w = h * ar; }
    const off = (i - (recs.length - 1) / 2) * step;
    return {
      id: uuid(), filename: rec.relativePath, slotId: 'free', free: true,
      position: { x: W / 2 - w / 2 + off, y: H / 2 - h / 2 + off, width: w, height: h, rotation: 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false },
      crop: { x: 0, y: 0, width: 1, height: 1 },
      parsedLabels: rec.parsedLabels ?? {}, overrides: {}, effects: defaultEffects(),
      border: null, shadow: null,
      opacity: 1, zIndex: topZ + 1 + i, visible: true,
    };
  });
}

/** Merge records into the project's registry, skipping relativePaths already there. */
export function mergeIntoRegistry(registry: ImageRecord[], recs: ImageRecord[]): void {
  for (const r of recs) if (!registry.some((x) => x.relativePath === r.relativePath)) registry.push(r);
}

export function useAddPhoto() {
  const project = useProjectStore();
  const editor = useEditorStore();
  const history = useHistoryStore();
  const app = useAppStore();

  /**
   * ＋ Add photo on the ACTIVE page. Locked page → warning toast; dialog/copy
   * failure → error toast; cancel → no-op. The new photo is selected through
   * `editor.selectedObjectId` BEFORE requesting the rebuild: AlbumCanvas.render()
   * re-selects that id once the new objects exist (a `requestSelect` fired now
   * would run before the rebuild and miss).
   */
  async function addPhotos(): Promise<void> {
    const pg = project.pages[editor.activePageIndex];
    const m = project.meta;
    if (!pg || !m || !project.project || adding.value) return;
    if (pg.locked) { app.toast('This page is locked — unlock it to add photos.', 'warning'); return; }
    adding.value = true;
    let recs: ImageRecord[] = [];
    try {
      recs = await window.pebble.addPhotos(m.sourceFolder);
    } catch (err) {
      app.toast(`Couldn't add photo: ${err instanceof Error ? err.message : String(err)}`, 'error', 5000);
    } finally {
      adding.value = false;
    }
    if (!recs.length || !project.project) return; // cancelled (or nothing readable)

    mergeIntoRegistry(project.project.imageRegistry, recs);

    const added = buildFreePhotos(recs, pg, m.albumWidth, m.albumHeight);
    const ids = new Set(added.map((a) => a.id));
    const last = added[added.length - 1];
    const sync = () => { if (project.project) project.syncUsage(project.project); project.markDirty(); };

    history.run({
      type: 'add', description: added.length > 1 ? `Add ${added.length} photos` : 'Add photo',
      execute: () => {
        pg.images.push(...added);
        sync();
        // Select the top-most new photo + open its properties once the canvas rebuilt.
        editor.selectObject(last.id, 'image');
        editor.propertiesOpen = true;
        editor.requestRender();
      },
      undo: () => {
        pg.images = pg.images.filter((i) => !ids.has(i.id));
        sync();
        if (editor.selectedObjectId && ids.has(editor.selectedObjectId)) editor.selectObject(null);
        editor.requestRender();
      },
    });
  }

  return { adding, addPhotos };
}
