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
    <h2 class="text-xl font-semibold">Review &amp; generate</h2>
    <p class="text-sm text-pebble-text-dim mt-1 mb-6">Check the summary, then choose <b class="text-pebble-text font-medium">Generate album</b>. You can refine everything afterwards in the editor.</p>
    <dl class="pa-panel divide-y divide-pebble-border">
      <div v-for="[k, v] in rows" :key="k" class="flex items-baseline gap-6 px-4 py-2.5 text-sm">
        <dt class="w-36 shrink-0 text-pebble-text-dim">{{ k }}</dt>
        <dd class="flex-1 min-w-0 font-medium truncate" :title="String(v)">{{ v }}</dd>
      </div>
    </dl>
  </div>
</template>
