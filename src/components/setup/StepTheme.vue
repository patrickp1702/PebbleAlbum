<script setup lang="ts">
/** Step 3 — theme selection with a live mini-preview per theme. */
import { inject } from 'vue';
import type { WizardDraft } from '@/views/ProjectSetupView.vue';
import { THEMES } from '@/engine/themeEngine';
import AppIcon from '@/components/ui/AppIcon.vue';

const draft = inject<WizardDraft>('wizard')!;
function select(id: string) { draft.meta.theme = id; }
</script>

<template>
  <div class="max-w-4xl mx-auto">
    <h2 class="text-xl font-semibold">Pick a theme</h2>
    <p class="text-sm text-pebble-text-dim mt-1 mb-6">Themes set the colours, fonts, borders and decorations. You can change this later.</p>

    <div class="grid grid-cols-3 gap-3">
      <button v-for="t in THEMES" :key="t.id" type="button" :aria-pressed="draft.meta.theme === t.id" @click="select(t.id)"
        :class="['pa-tile overflow-hidden text-left relative flex flex-col items-stretch', draft.meta.theme === t.id ? 'is-active' : '']">
        <!-- The swatch shows the ALBUM theme's own colours (user content, not app chrome). -->
        <div class="h-24 shrink-0 relative" :style="{ background: t.colors.background }">
          <div class="absolute inset-3 rounded flex items-center justify-center text-lg"
               :style="{ background: t.colors.surface, color: t.colors.accent, fontFamily: t.fonts.display }">
            {{ t.name }}
          </div>
          <div class="absolute bottom-2 right-2 h-4 w-4 rounded-full" :style="{ background: t.colors.accent }" />
        </div>
        <div class="px-3 py-2.5 bg-pebble-surface flex-1">
          <div class="font-medium text-sm text-pebble-text flex items-center gap-1.5">
            <span class="truncate">{{ t.name }}</span>
          </div>
          <div class="text-xs text-pebble-text-dim line-clamp-2 mt-0.5">{{ t.description }}</div>
        </div>
        <span v-if="draft.meta.theme === t.id"
              class="absolute top-2 left-2 h-5 w-5 rounded-full bg-pebble-accent text-pebble-on-accent grid place-items-center">
          <AppIcon name="check" :size="12" :stroke="2.5" />
        </span>
      </button>
    </div>
  </div>
</template>
