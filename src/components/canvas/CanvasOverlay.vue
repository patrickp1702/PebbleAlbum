<script setup lang="ts">
/**
 * CanvasOverlay.vue — Non-interactive overlays drawn above the canvas:
 * rulers, safe-zone and bleed guides. Driven by app preferences.
 */
import { computed } from 'vue';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';

const app = useAppStore();
const project = useProjectStore();
const prefs = computed(() => app.preferences);
const meta = computed(() => project.meta);
</script>

<template>
  <div class="pointer-events-none absolute inset-0 z-10" v-if="meta">
    <div v-if="prefs.showSafeZone"
         class="absolute border border-dashed border-pebble-success/40"
         :style="{ inset: `${(meta.safeMargin / meta.albumHeight) * 100}%` }" />
    <div v-if="prefs.showBleed"
         class="absolute border border-dashed border-pebble-danger/40"
         :style="{ inset: `-${(meta.bleedMargin / meta.albumHeight) * 100}%` }" />
    <div v-if="prefs.showRulers"
         class="absolute top-0 left-0 right-0 h-4 bg-pebble-surface/60 border-b border-pebble-border text-2xs text-pebble-text-dim" />
  </div>
</template>
