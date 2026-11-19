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
    <h2 class="text-2xl font-bold">Proverbs &amp; quotes</h2>
    <p class="text-pebble-text-dim">One per line. These are sprinkled across your album.</p>

    <textarea v-model="text" rows="8" class="pa-input w-full font-serif" placeholder="Family is not an important thing — it's everything." @input="sync" />

    <div class="flex gap-3">
      <AppButton variant="secondary" @click="libOpen = true">📚 Browse library (150+)</AppButton>
      <span class="self-center text-xs text-pebble-text-dim">{{ draft.meta.proverbs.length }} added</span>
    </div>

    <div class="grid grid-cols-2 gap-4">
      <AppDropdown label="Frequency" :model-value="draft.config.proverbFrequency"
        :options="[{value:'every',label:'Every page'},{value:'every2',label:'Every 2nd page'},{value:'every3',label:'Every 3rd page'},{value:'flagged',label:'Only flagged pages'},{value:'none',label:'None'}]"
        @update:model-value="v => draft.config.proverbFrequency = v as any" />
    </div>

    <AppModal v-model:open="libOpen" title="Proverb library" width="640px">
      <input v-model="query" class="pa-input w-full mb-3" placeholder="Search love, family, wedding…" />
      <div class="space-y-1 max-h-80 overflow-auto">
        <button v-for="r in results" :key="r.text" class="block w-full text-left px-3 py-2 rounded hover:bg-pebble-hover text-sm"
                @click="add(r.text)">
          <span class="pa-chip mr-2">{{ r.category }}</span>{{ r.text }}
        </button>
      </div>
    </AppModal>
  </div>
</template>
