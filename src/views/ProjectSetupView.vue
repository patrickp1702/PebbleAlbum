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
import AppIcon from '@/components/ui/AppIcon.vue';
import AppIconButton from '@/components/ui/AppIconButton.vue';
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
/** Why "Next" is unavailable — shown as the disabled button's tooltip. */
const nextHint = computed(() => {
  if (canNext.value) return undefined;
  return current.value === 0 ? 'Choose a folder that contains images first' : 'Give the album a name first';
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
    <!-- Top bar: leave + title, then the step indicator -->
    <header class="pa-topbar">
      <AppIconButton icon="home" label="Back to home" @click="router.push('/')" />
      <span class="font-semibold mr-4 whitespace-nowrap">New album</span>
      <ol class="flex-1 flex items-center gap-2 min-w-0">
        <template v-for="(s, i) in steps" :key="s">
          <li class="flex items-center gap-2 shrink-0" :aria-current="i === current ? 'step' : undefined">
            <span :class="['h-[22px] w-[22px] rounded-full grid place-items-center text-2xs font-semibold tabular-nums',
                           i === current ? 'bg-pebble-accent text-pebble-on-accent'
                           : i < current ? 'bg-pebble-accent/20 text-pebble-accent-soft'
                           : 'border border-pebble-border-strong text-pebble-text-dim']">
              <AppIcon v-if="i < current" name="check" :size="13" :stroke="2.25" />
              <template v-else>{{ i + 1 }}</template>
            </span>
            <!-- Labels of the other steps drop out on narrow windows; the current one always shows. -->
            <span :class="['text-xs whitespace-nowrap', i === current ? 'text-pebble-text font-medium' : 'text-pebble-text-dim hidden lg:inline']">{{ s }}</span>
          </li>
          <li v-if="i < steps.length - 1" class="flex-1 min-w-[12px] h-px bg-pebble-border" aria-hidden="true" />
        </template>
      </ol>
      <span class="text-xs text-pebble-text-dim whitespace-nowrap ml-4 tabular-nums">Step {{ current + 1 }} of {{ steps.length }}</span>
    </header>

    <!-- Step body -->
    <main class="flex-1 overflow-auto px-8 py-8">
      <component :is="stepComponents[current]" />
    </main>

    <!-- Footer nav: Back on the left, the ONE primary on the right -->
    <footer class="px-4 h-14 shrink-0 bg-pebble-surface border-t border-pebble-border flex items-center justify-between gap-4">
      <AppButton variant="ghost" icon="arrow-left" :disabled="current === 0 || generating" @click="prev">Back</AppButton>
      <div v-if="generating" class="flex-1 max-w-md"><AppProgress :value="progress.pct" :label="progress.step || 'Generating…'" /></div>
      <AppButton v-if="current < steps.length - 1" :variant="canNext ? 'primary' : 'secondary'" :disabled="!canNext" :title="nextHint" @click="next">
        Next <AppIcon name="arrow-right" :size="15" />
      </AppButton>
      <AppButton v-else icon="sparkles" :disabled="generating" @click="generate">{{ generating ? 'Generating…' : 'Generate album' }}</AppButton>
    </footer>
  </div>
</template>
