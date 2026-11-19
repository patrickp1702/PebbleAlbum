<script setup lang="ts">
/** AppProgress — labelled determinate progress bar (0..100). */
defineProps<{ value: number; label?: string }>();
</script>

<template>
  <div>
    <div v-if="label" class="flex justify-between text-xs text-pebble-text-dim mb-1">
      <span>{{ label }}</span><span>{{ Math.round(value) }}%</span>
    </div>
    <div class="h-2 rounded-full bg-pebble-bg overflow-hidden">
      <div class="h-full bg-pebble-accent transition-all duration-200" :style="{ width: `${value}%` }" />
    </div>
  </div>
</template>
