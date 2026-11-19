<script setup lang="ts">
/** Step 1 — pick the source image folder and preview what was found. */
import { inject, computed, ref, reactive, watch } from 'vue';
import type { WizardDraft } from '@/views/ProjectSetupView.vue';
import { useAppStore } from '@/stores/appStore';
import AppButton from '@/components/ui/AppButton.vue';
import AppIcon from '@/components/ui/AppIcon.vue';
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
    <h2 class="text-xl font-semibold">Choose your images</h2>
    <p class="text-sm text-pebble-text-dim mt-1 mb-6">Pick a folder. Images stay where they are — PebbleAlbum never copies or uploads them.</p>

    <!-- Source folder: the primary action of this step until a folder is chosen -->
    <div class="pa-panel p-4 mb-5 flex items-center gap-4">
      <div class="h-10 w-10 shrink-0 rounded-md bg-pebble-surface-2 border border-pebble-border grid place-items-center text-pebble-text-dim">
        <AppIcon name="folder" :size="18" />
      </div>
      <div class="flex-1 min-w-0">
        <div class="pa-label">Source folder</div>
        <div class="font-mono text-sm truncate" :class="draft.folder ? '' : 'text-pebble-text-dim'" :title="draft.folder">{{ draft.folder || 'No folder selected' }}</div>
      </div>
      <AppButton :variant="draft.records.length ? 'secondary' : 'primary'" icon="folder" :disabled="loading" @click="pick">
        {{ loading ? 'Scanning…' : draft.folder ? 'Change folder…' : 'Select folder…' }}
      </AppButton>
    </div>

    <!-- What was found -->
    <dl v-if="draft.records.length" class="grid grid-cols-3 pa-panel divide-x divide-pebble-border mb-5">
      <div class="px-4 py-3"><dt class="pa-label">Images found</dt><dd class="text-xl font-semibold tabular-nums mt-0.5">{{ draft.records.length }}</dd></div>
      <div class="px-4 py-3"><dt class="pa-label">Total size</dt><dd class="text-xl font-semibold tabular-nums mt-0.5">{{ totalSize }} MB</dd></div>
      <div class="px-4 py-3"><dt class="pa-label">Selected for the album</dt><dd class="text-xl font-semibold tabular-nums mt-0.5">{{ keptCount }}</dd></div>
    </dl>

    <div v-if="draft.records.length" class="pa-panel p-4 mb-6 flex items-center justify-between gap-4">
      <div class="min-w-0">
        <div class="text-sm font-medium">Remove duplicates &amp; weak shots</div>
        <div class="text-xs text-pebble-text-dim mt-0.5">We'll group similar/burst photos and pre-pick the sharpest, best-exposed one. Only selected photos go into the album.</div>
      </div>
      <AppButton variant="secondary" icon="images" class="shrink-0" @click="showSelect = true">Review &amp; select…</AppButton>
    </div>

    <div v-if="draft.records.length">
      <h3 class="pa-section mb-2">Preview</h3>
      <div class="grid grid-cols-6 gap-2">
        <div v-for="r in preview" :key="r.absolutePath"
             class="aspect-square rounded-md overflow-hidden bg-pebble-surface">
          <img v-if="thumbs[r.thumbnailPath]" :src="thumbs[r.thumbnailPath]" class="w-full h-full object-cover" :alt="r.filename" />
          <div v-else class="w-full h-full animate-pulse bg-pebble-surface-2" />
        </div>
      </div>
      <div v-if="pageCount > 1" class="flex items-center justify-center gap-3 mt-3 text-xs">
        <button type="button" class="pa-btn" :disabled="previewPage === 0" @click="previewPage -= 1">
          <AppIcon name="chevron-left" :size="14" /> Prev
        </button>
        <span class="text-pebble-text-dim tabular-nums">Page {{ previewPage + 1 }} / {{ pageCount }} · {{ draft.records.length }} images</span>
        <button type="button" class="pa-btn" :disabled="previewPage >= pageCount - 1" @click="previewPage += 1">
          Next <AppIcon name="chevron-right" :size="14" />
        </button>
      </div>
    </div>

    <PhotoSelectionView :open="showSelect" :folder="draft.folder" :records="draft.records" :preselect-skipped="currentSkipped"
                        @update:open="showSelect = $event" @apply="applySelection" />
  </div>
</template>
