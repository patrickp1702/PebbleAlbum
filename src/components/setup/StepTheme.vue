<script setup lang="ts">
/** Step 3 — theme selection with a live mini-preview per theme. */
import { inject } from 'vue';
import type { WizardDraft } from '@/views/ProjectSetupView.vue';
import { THEMES } from '@/engine/themeEngine';

const draft = inject<WizardDraft>('wizard')!;
function select(id: string) { draft.meta.theme = id; }
</script>

<template>
  <div class="max-w-4xl mx-auto">
    <h2 class="text-2xl font-bold mb-1">Pick a theme</h2>
    <p class="text-pebble-text-dim mb-6">Themes set the colours, fonts, borders and decorations. You can change this later.</p>

    <div class="grid grid-cols-3 gap-4">
      <button v-for="t in THEMES" :key="t.id" @click="select(t.id)"
        :class="['rounded-lg overflow-hidden border-2 text-left transition',
                 draft.meta.theme === t.id ? 'border-pebble-accent ring-2 ring-pebble-accent/40' : 'border-pebble-border hover:border-pebble-accent/50']">
        <div class="h-24 relative" :style="{ background: t.colors.background }">
          <div class="absolute inset-3 rounded flex items-center justify-center text-lg"
               :style="{ background: t.colors.surface, color: t.colors.accent, fontFamily: t.fonts.display }">
            {{ t.name }}
          </div>
          <div class="absolute bottom-2 right-2 h-4 w-4 rounded-full" :style="{ background: t.colors.accent }" />
        </div>
        <div class="p-3 bg-pebble-surface">
          <div class="font-medium text-sm">{{ t.name }}</div>
          <div class="text-xs text-pebble-text-dim line-clamp-2">{{ t.description }}</div>
        </div>
      </button>
    </div>
  </div>
</template>
