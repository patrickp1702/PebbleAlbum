<script setup lang="ts">
/** AppDropdown — simple select wrapper bound with v-model. */
defineProps<{ label?: string; modelValue: string | number; options: { value: string | number; label: string }[] }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: string | number): void }>();
</script>

<template>
  <label class="block">
    <span v-if="label" class="text-xs text-pebble-text-dim block mb-1">{{ label }}</span>
    <select :value="modelValue" class="pa-input w-full"
            @change="emit('update:modelValue', (($event.target as HTMLSelectElement).value))">
      <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
    </select>
  </label>
</template>
