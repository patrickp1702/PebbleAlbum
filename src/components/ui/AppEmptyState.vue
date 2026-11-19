<script setup lang="ts">
/**
 * AppEmptyState — what a screen shows when there is nothing yet: one icon, one
 * line saying what this place is for, one line saying what to do next, and the
 * action itself (default slot). Never a dead end.
 */
import AppIcon from '@/components/ui/AppIcon.vue';
import type { IconName } from '@/components/ui/icons';

defineProps<{ icon: IconName; title: string; text?: string }>();
</script>

<template>
  <div class="flex flex-col items-center text-center max-w-md mx-auto px-6 py-10">
    <div class="h-12 w-12 rounded-xl bg-pebble-surface-2 border border-pebble-border grid place-items-center text-pebble-text-dim mb-4">
      <AppIcon :name="icon" :size="22" />
    </div>
    <h2 class="text-lg font-semibold">{{ title }}</h2>
    <p v-if="text" class="text-sm text-pebble-text-dim mt-1.5">{{ text }}</p>
    <div v-if="$slots.default" class="mt-5 flex items-center gap-2"><slot /></div>
    <p v-if="$slots.hint" class="pa-hint mt-3"><slot name="hint" /></p>
  </div>
</template>
