<script setup lang="ts">
/** AppSlider — labelled range input with debounced value display. */
defineProps<{ label?: string; min: number; max: number; step?: number; modelValue: number; unit?: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: number): void }>();
</script>

<template>
  <label class="block">
    <div v-if="label" class="flex justify-between text-xs text-pebble-text-dim mb-1">
      <span>{{ label }}</span>
      <span class="tabular-nums text-pebble-text">{{ modelValue }}{{ unit || '' }}</span>
    </div>
    <input type="range" :min="min" :max="max" :step="step || 1" :value="modelValue"
           class="w-full accent-pebble-accent"
           @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))" />
  </label>
</template>
