<script setup lang="ts">
/** Step 4 — proverbs/quotes input, frequency, style + built-in library. */
import { inject, ref, computed } from 'vue';
import type { WizardDraft } from '@/views/ProjectSetupView.vue';
import { searchProverbs } from '@/engine/proverbSelector';
import AppDropdown from '@/components/ui/AppDropdown.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppButton from '@/components/ui/AppButton.vue';

const draft = inject<WizardDraft>('wizard')!;
const text = ref(draft.meta.proverbs.join('\n'));
const libOpen = ref(false);
const query = ref('');
const results = computed(() => searchProverbs(query.value).slice(0, 80));

function sync() { draft.meta.proverbs = text.value.split('\n').map(s => s.trim()).filter(Boolean); }
function add(p: string) { text.value = text.value ? `${text.value}\n${p}` : p; sync(); }
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-5">
    <div>
      <h2 class="text-xl font-semibold">Proverbs &amp; quotes</h2>
      <p class="text-sm text-pebble-text-dim mt-1">Optional. One per line — these are sprinkled across your album.</p>
    </div>

    <label class="block">
      <span class="flex items-baseline justify-between mb-1">
        <span class="pa-label">Your proverbs</span>
        <span class="text-xs text-pebble-text-dim tabular-nums">{{ draft.meta.proverbs.length }} added</span>
      </span>
      <textarea v-model="text" rows="8" class="pa-input w-full font-serif !text-base" placeholder="Family is not an important thing — it's everything." @input="sync" />
    </label>

    <AppButton variant="secondary" icon="book" @click="libOpen = true">Browse library (150+)</AppButton>

    <div class="grid grid-cols-2 gap-4">
      <AppDropdown label="Frequency" :model-value="draft.config.proverbFrequency"
        :options="[{value:'every',label:'Every page'},{value:'every2',label:'Every 2nd page'},{value:'every3',label:'Every 3rd page'},{value:'flagged',label:'Only flagged pages'},{value:'none',label:'None'}]"
        @update:model-value="v => draft.config.proverbFrequency = v as any" />
    </div>

    <AppModal v-model:open="libOpen" title="Proverb library" width="640px">
      <input v-model="query" class="pa-input w-full mb-3" placeholder="Search love, family, wedding…" />
      <p class="pa-hint mb-2">Click a proverb to add it to your list.</p>
      <div class="space-y-0.5 max-h-80 overflow-auto">
        <button v-for="r in results" :key="r.text" type="button"
                class="flex items-start gap-2 w-full text-left px-2.5 py-2 rounded-md hover:bg-pebble-hover text-sm transition-colors"
                @click="add(r.text)">
          <span class="pa-chip shrink-0 mt-px">{{ r.category }}</span><span class="min-w-0">{{ r.text }}</span>
        </button>
        <div v-if="!results.length" class="py-8 text-center text-sm text-pebble-text-dim">No proverbs match “{{ query }}”.</div>
      </div>
      <template #footer>
        <AppButton @click="libOpen = false">Done</AppButton>
      </template>
    </AppModal>
  </div>
</template>
