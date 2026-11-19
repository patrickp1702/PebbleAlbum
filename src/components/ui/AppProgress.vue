<script setup lang="ts">
/** AppProgress — labelled determinate progress bar (0..100). */
defineProps<{ value: number; label?: string }>();
</script>

<template>
  <div>
    <div v-if="label" class="flex justify-between text-xs text-pebble-text-dim mb-1.5">
      <span>{{ label }}</span><span class="tabular-nums text-pebble-text">{{ Math.round(value) }}%</span>
    </div>
    <div class="h-1.5 rounded-full bg-pebble-pressed overflow-hidden" role="progressbar"
         :aria-valuenow="Math.round(value)" aria-valuemin="0" aria-valuemax="100">
      <div class="h-full rounded-full bg-pebble-accent transition-[width] duration-200" :style="{ width: `${value}%` }" />
    </div>
  </div>
</template>
