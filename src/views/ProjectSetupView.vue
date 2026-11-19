<script setup lang="ts">
/**
 * ProjectSetupView.vue — Six-step album creation wizard. Holds a reactive
 * `draft` (folder + scanned records + meta + generator config) and provides it
 * to each step. The final step runs the album generator and opens the editor.
 */
import { reactive, ref, provide, computed } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectStore, createDefaultMeta } from '@/stores/projectStore';
import { useAppStore } from '@/stores/appStore';
import { generateAlbum, DEFAULT_GENERATOR_CONFIG, GeneratorConfig } from '@/engine/albumGenerator';
import type { ImageRecord, AlbumMeta } from '@shared/pebble.types';
import AppButton from '@/components/ui/AppButton.vue';
import AppProgress from '@/components/ui/AppProgress.vue';
import StepFolderPicker from '@/components/setup/StepFolderPicker.vue';
import StepAlbumMeta from '@/components/setup/StepAlbumMeta.vue';
import StepTheme from '@/components/setup/StepTheme.vue';
import StepProverbs from '@/components/setup/StepProverbs.vue';
import StepAdvanced from '@/components/setup/StepAdvanced.vue';
import StepReview from '@/components/setup/StepReview.vue';

export interface WizardDraft {
  folder: string;
  records: ImageRecord[];
  meta: AlbumMeta;
  config: GeneratorConfig;
}

const router = useRouter();
const project = useProjectStore();
const app = useAppStore();

const draft = reactive<WizardDraft>({
  folder: '',
  records: [],
  meta: createDefaultMeta(),
  config: { ...DEFAULT_GENERATOR_CONFIG },
});
provide('wizard', draft);

const steps = ['Images', 'Identity', 'Theme', 'Proverbs', 'Advanced', 'Review'];
const stepComponents = [StepFolderPicker, StepAlbumMeta, StepTheme, StepProverbs, StepAdvanced, StepReview];
const current = ref(0);
const generating = ref(false);
const progress = reactive({ pct: 0, step: '' });

const canNext = computed(() => {
  if (current.value === 0) return draft.records.length > 0;
  if (current.value === 1) return draft.meta.name.trim().length > 0;
  return true;
});

function next() { if (current.value < steps.length - 1) current.value += 1; }
function prev() { if (current.value > 0) current.value -= 1; }

async function generate() {
  generating.value = true;
  try {
    draft.meta.sourceFolder = draft.folder;
    const pages = generateAlbum(draft.meta, draft.records, draft.config, (step, pct) => {
      progress.step = step; progress.pct = pct;
    });
    project.initProject(draft.meta, draft.records, pages);
    app.toast(`Album generated — ${pages.length} pages.`, 'success');
    router.push('/editor');
  } catch (e) {
    app.toast('Album generation failed.', 'error');
    generating.value = false;
  }
}
</script>

<template>
  <div class="h-full flex flex-col bg-pebble-bg">
    <!-- Step indicator -->
    <header class="flex items-center gap-2 px-6 py-4 border-b border-pebble-border">
      <button class="text-pebble-text-dim hover:text-pebble-text mr-2" @click="router.push('/')">←</button>
      <template v-for="(s, i) in steps" :key="s">
        <div class="flex items-center gap-2">
          <div :class="['h-7 w-7 rounded-full flex items-center justify-center text-xs font-semibold',
                        i === current ? 'bg-pebble-accent text-white' : i < current ? 'bg-pebble-accent/30 text-pebble-accent-soft' : 'bg-pebble-surface text-pebble-text-dim']">
            {{ i + 1 }}
          </div>
          <span :class="['text-sm', i === current ? 'text-pebble-text' : 'text-pebble-text-dim']">{{ s }}</span>
        </div>
        <div v-if="i < steps.length - 1" class="flex-1 h-px bg-pebble-border" />
      </template>
    </header>

    <!-- Step body -->
    <main class="flex-1 overflow-auto p-8">
      <component :is="stepComponents[current]" />
    </main>

    <!-- Footer nav -->
    <footer class="px-6 py-4 border-t border-pebble-border flex items-center justify-between">
      <AppButton variant="ghost" :disabled="current === 0" @click="prev">← Back</AppButton>
      <div v-if="generating" class="flex-1 mx-8"><AppProgress :value="progress.pct" :label="progress.step" /></div>
      <AppButton v-if="current < steps.length - 1" :disabled="!canNext" @click="next">Next →</AppButton>
      <AppButton v-else :disabled="generating" @click="generate">✨ Generate Album</AppButton>
    </footer>
  </div>
</template>
