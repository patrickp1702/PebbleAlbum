<script setup lang="ts">
/** AppColorPicker — native colour swatch + hex text field on one 32px row. */
defineProps<{ label?: string; modelValue: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();
</script>

<template>
  <label class="flex items-center gap-2">
    <span v-if="label" class="pa-label w-20 shrink-0">{{ label }}</span>
    <span class="relative h-8 w-8 shrink-0 rounded-md border border-pebble-border-strong overflow-hidden"
          :style="{ background: modelValue }">
      <input type="color" :value="modelValue" class="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
             :aria-label="label || 'Colour'"
             @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" />
    </span>
    <input type="text" :value="modelValue" class="pa-input flex-1 min-w-0 h-8 !py-0 text-xs uppercase font-mono"
           spellcheck="false"
           @change="emit('update:modelValue', ($event.target as HTMLInputElement).value)" />
  </label>
</template>
