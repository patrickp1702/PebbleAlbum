<script setup lang="ts">
/** Step 2 — album identity, dimensions, DPI and binding. */
import { inject } from 'vue';
import type { WizardDraft } from '@/views/ProjectSetupView.vue';
import AppDropdown from '@/components/ui/AppDropdown.vue';

const draft = inject<WizardDraft>('wizard')!;

const PRESETS: Record<string, [number, number]> = {
  '12×8 inch': [12, 8], '14×10 inch': [14, 10], '10×10 inch (square)': [10, 10],
  'A4': [11.69, 8.27], 'A3': [16.54, 11.69],
};

function applyPreset(name: string) {
  const [w, h] = PRESETS[name];
  draft.meta.albumWidth = Math.round(w * draft.meta.dpi);
  draft.meta.albumHeight = Math.round(h * draft.meta.dpi);
  draft.meta.orientation = w === h ? 'square' : w > h ? 'landscape' : 'portrait';
}
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-5">
    <h2 class="text-2xl font-bold">Album identity</h2>

    <label class="block">
      <span class="text-xs text-pebble-text-dim">Project name *</span>
      <input v-model="draft.meta.name" class="pa-input w-full mt-1" placeholder="Our Wedding 2026" />
    </label>

    <div class="grid grid-cols-2 gap-4">
      <label class="block"><span class="text-xs text-pebble-text-dim">Cover title</span>
        <input v-model="draft.meta.coverTitle" class="pa-input w-full mt-1" /></label>
      <label class="block"><span class="text-xs text-pebble-text-dim">Cover subtitle</span>
        <input v-model="draft.meta.coverSubtitle" class="pa-input w-full mt-1" placeholder="A Family Album · 2026" /></label>
    </div>

    <label class="block"><span class="text-xs text-pebble-text-dim">Cover date</span>
      <input v-model="draft.meta.coverDate" class="pa-input w-full mt-1" placeholder="June 2026" /></label>

    <div class="grid grid-cols-3 gap-4">
      <AppDropdown label="Size preset" :model-value="''"
        :options="[{ value: '', label: 'Custom…' }, ...Object.keys(PRESETS).map(k => ({ value: k, label: k }))]"
        @update:model-value="v => v && applyPreset(String(v))" />
      <AppDropdown label="DPI" :model-value="draft.meta.dpi"
        :options="[{ value: 150, label: '150 — Screen' }, { value: 300, label: '300 — Print' }, { value: 600, label: '600 — Pro' }]"
        @update:model-value="v => draft.meta.dpi = Number(v)" />
      <AppDropdown label="Binding" :model-value="draft.meta.bindingType"
        :options="[{ value: 'left', label: 'Left-bound' }, { value: 'top', label: 'Top-bound' }]"
        @update:model-value="v => draft.meta.bindingType = v as 'left' | 'top'" />
    </div>

    <div class="grid grid-cols-2 gap-4">
      <label class="block"><span class="text-xs text-pebble-text-dim">Width (px)</span>
        <input type="number" v-model.number="draft.meta.albumWidth" class="pa-input w-full mt-1" /></label>
      <label class="block"><span class="text-xs text-pebble-text-dim">Height (px)</span>
        <input type="number" v-model.number="draft.meta.albumHeight" class="pa-input w-full mt-1" /></label>
    </div>
  </div>
</template>
