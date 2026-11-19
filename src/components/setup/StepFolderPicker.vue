<script setup lang="ts">
/** Step 1 — pick the source image folder and preview what was found. */
import { inject, computed, ref, reactive, watch } from 'vue';
import type { WizardDraft } from '@/views/ProjectSetupView.vue';
import { useAppStore } from '@/stores/appStore';
import AppButton from '@/components/ui/AppButton.vue';
import PhotoSelectionView from '@/components/editor/PhotoSelectionView.vue';

const draft = inject<WizardDraft>('wizard')!;
const app = useAppStore();
const loading = ref(false);
const showSelect = ref(false);
const keptCount = computed(() => draft.records.filter((r) => !r.skipped).length);
const currentSkipped = computed(() => draft.records.filter((r) => r.skipped).map((r) => r.relativePath));
function applySelection(skipped: string[]) {
  const skip = new Set(skipped);
  for (const r of draft.records) r.skipped = skip.has(r.relativePath);
  app.toast(`Keeping ${draft.records.filter((r) => !r.skipped).length} of ${draft.records.length} photos`, 'success', 1800);
}

const totalSize = computed(() =>
  (draft.records.reduce((s, r) => s + r.fileSize, 0) / 1_048_576).toFixed(1));
const labelCount = computed(() =>
  draft.records.filter((r) => Object.keys(r.parsedLabels).length > 0).length);

// Preview thumbnails via base64 (file:// is blocked in the renderer).
const thumbs = reactive<Record<string, string>>({});
const PAGE_SIZE = 24; // 6 columns × 4 rows
const previewPage = ref(0);
const pageCount = computed(() => Math.max(1, Math.ceil(draft.records.length / PAGE_SIZE)));
const preview = computed(() => draft.records.slice(previewPage.value * PAGE_SIZE, previewPage.value * PAGE_SIZE + PAGE_SIZE));
watch(() => draft.records.length, () => { previewPage.value = 0; });
watch(preview, (list) => {
  list.forEach((r) => {
    if (r.thumbnailPath && !thumbs[r.thumbnailPath]) {
      window.pebble.readImageBase64(r.thumbnailPath).then((d) => { thumbs[r.thumbnailPath] = d; }).catch(() => {});
    }
  });
}, { immediate: true });

async function pick() {
  // Guard: if the preload bridge failed to load, surface it instead of failing silently.
  if (!window.pebble?.openFolderDialog) {
    app.toast('Internal error: the file bridge is unavailable. Please restart the app.', 'error', 6000);
    return;
  }
  try {
    const folder = await window.pebble.openFolderDialog();
    if (!folder) return; // user cancelled the dialog
    loading.value = true;
    draft.folder = folder;
    draft.records = await window.pebble.listImages(folder);
    if (!draft.meta.name || draft.meta.name === 'Untitled Album') {
      draft.meta.name = folder.split(/[\\/]/).pop() || 'My Album';
    }
    if (draft.records.length === 0) app.toast('No images found in that folder.', 'warning');
    else if (draft.records.length < 3) app.toast('This folder has fewer than 3 images.', 'warning');
  } catch (e) {
    app.toast(`Could not read that folder: ${(e as Error).message}`, 'error', 6000);
  } finally {
    loading.value = false;
  }
}
</script>

<template>
  <div class="max-w-3xl mx-auto">
    <h2 class="text-2xl font-bold mb-1">Choose your images</h2>
    <p class="text-pebble-text-dim mb-6">Pick a folder. Images stay where they are — PebbleAlbum never copies or uploads them.</p>

    <div class="pa-panel p-5 mb-6 flex items-center justify-between">
      <div>
        <div class="text-sm text-pebble-text-dim">Source folder</div>
        <div class="font-mono text-sm truncate max-w-md">{{ draft.folder || 'No folder selected' }}</div>
      </div>
      <AppButton :disabled="loading" @click="pick">{{ loading ? 'Scanning…' : 'Select Folder…' }}</AppButton>
    </div>

    <div v-if="draft.records.length" class="grid grid-cols-3 gap-4 mb-4">
      <div class="pa-panel p-4 text-center"><div class="text-2xl font-bold">{{ draft.records.length }}</div><div class="text-xs text-pebble-text-dim">images</div></div>
      <div class="pa-panel p-4 text-center"><div class="text-2xl font-bold">{{ totalSize }} MB</div><div class="text-xs text-pebble-text-dim">total size</div></div>
      <div class="pa-panel p-4 text-center"><div class="text-2xl font-bold">{{ keptCount }}</div><div class="text-xs text-pebble-text-dim">selected</div></div>
    </div>

    <div v-if="draft.records.length" class="pa-panel p-4 mb-6 flex items-center justify-between">
      <div>
        <div class="text-sm font-medium">Remove duplicates & weak shots</div>
        <div class="text-xs text-pebble-text-dim">We'll group similar/burst photos and pre-pick the sharpest, best-exposed one. Only selected photos go into the album.</div>
      </div>
      <AppButton variant="secondary" @click="showSelect = true">Review &amp; select…</AppButton>
    </div>

    <div v-if="draft.records.length">
      <div class="grid grid-cols-6 gap-2">
        <div v-for="r in preview" :key="r.absolutePath"
             class="aspect-square rounded overflow-hidden bg-pebble-surface">
          <img v-if="thumbs[r.thumbnailPath]" :src="thumbs[r.thumbnailPath]" class="w-full h-full object-cover" :alt="r.filename" />
          <div v-else class="w-full h-full animate-pulse bg-pebble-surface-2" />
        </div>
      </div>
      <div v-if="pageCount > 1" class="flex items-center justify-center gap-4 mt-3 text-sm">
        <button class="px-3 py-1 rounded border border-pebble-border disabled:opacity-40 hover:border-pebble-accent"
                :disabled="previewPage === 0" @click="previewPage -= 1">‹ Prev</button>
        <span class="text-pebble-text-dim">Page {{ previewPage + 1 }} / {{ pageCount }} · {{ draft.records.length }} images</span>
        <button class="px-3 py-1 rounded border border-pebble-border disabled:opacity-40 hover:border-pebble-accent"
                :disabled="previewPage >= pageCount - 1" @click="previewPage += 1">Next ›</button>
      </div>
    </div>

    <PhotoSelectionView :open="showSelect" :folder="draft.folder" :records="draft.records" :preselect-skipped="currentSkipped"
                        @update:open="showSelect = $event" @apply="applySelection" />
  </div>
</template>
