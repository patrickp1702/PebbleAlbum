/**
 * collageStore.ts — in-memory state for the standalone Collage Creator tool.
 * No project / no disk persistence: the last collage stays in view while the app
 * is open; "Clear" starts fresh. (A fresh app launch starts empty.)
 */
import { defineStore } from 'pinia';
import { ref } from 'vue';
import type { ImageRecord, Orientation } from '@shared/pebble.types';

export const useCollageStore = defineStore('collage', () => {
  const folder = ref('');
  const records = ref<ImageRecord[]>([]);
  const selected = ref<string[]>([]);          // relativePaths, in click order
  const layoutId = ref('auto');
  const themeId = ref('modern_minimal');
  const orientation = ref<Orientation>('landscape');
  const bgColor = ref('#ffffff');
  const resultDataUrl = ref('');                // last rendered collage (PNG data URL)
  /** 'setup' = pick photos + layout/theme; 'edit' = full interactive editor. */
  const phase = ref<'setup' | 'edit'>('setup');

  function clear(): void {
    folder.value = ''; records.value = []; selected.value = [];
    layoutId.value = 'auto'; resultDataUrl.value = ''; phase.value = 'setup';
  }

  return { folder, records, selected, layoutId, themeId, orientation, bgColor, resultDataUrl, phase, clear };
});
