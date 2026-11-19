<script setup lang="ts">
/** AppColorPicker — native colour input + hex text field. */
defineProps<{ label?: string; modelValue: string }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: string): void }>();
</script>

<template>
  <label class="flex items-center gap-2">
    <span v-if="label" class="text-xs text-pebble-text-dim w-20">{{ label }}</span>
    <input type="color" :value="modelValue" class="h-8 w-10 rounded bg-transparent cursor-pointer"
           @input="emit('update:modelValue', ($event.target as HTMLInputElement).value)" />
    <input type="text" :value="modelValue" class="pa-input flex-1 py-1 text-xs uppercase"
           @change="emit('update:modelValue', ($event.target as HTMLInputElement).value)" />
  </label>
</template>
