<script setup lang="ts">
/** Step 6 — review summary + estimated page count before generation. */
import { inject, computed } from 'vue';
import type { WizardDraft } from '@/views/ProjectSetupView.vue';
import { getTheme } from '@/engine/themeEngine';

const draft = inject<WizardDraft>('wizard')!;
const usable = computed(() => draft.records.filter(r => !r.skipped).length);
const estPages = computed(() => {
  const perPage = (draft.config.minImagesPerPage + draft.config.maxImagesPerPage) / 2;
  return Math.ceil(usable.value / Math.max(1, perPage)) + 2; // + cover + back cover
});
const theme = computed(() => getTheme(draft.meta.theme));
const rows = computed(() => [
  ['Album', draft.meta.name],
  ['Source folder', draft.folder],
  ['Images', `${usable.value} usable`],
  ['Dimensions', `${draft.meta.albumWidth} × ${draft.meta.albumHeight}px @ ${draft.meta.dpi} DPI`],
  ['Theme', theme.value.name],
  ['Proverbs', `${draft.meta.proverbs.length} (${draft.config.proverbFrequency})`],
  ['Estimated pages', `~${estPages.value}`],
]);
</script>

<template>
  <div class="max-w-2xl mx-auto">
    <h2 class="text-2xl font-bold mb-6">Review &amp; generate</h2>
    <div class="pa-panel divide-y divide-pebble-border">
      <div v-for="[k, v] in rows" :key="k" class="flex justify-between px-5 py-3 text-sm">
        <span class="text-pebble-text-dim">{{ k }}</span>
        <span class="font-medium text-right truncate max-w-sm">{{ v }}</span>
      </div>
    </div>
    <p class="text-xs text-pebble-text-dim mt-4">Click <b>Generate Album</b> to build pages. You can refine everything afterwards in the editor.</p>
  </div>
</template>
