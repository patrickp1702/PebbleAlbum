<script setup lang="ts">
/** AppDropdown — labelled native select (keyboard + screen-reader friendly) with the system chevron replaced by ours. */
import AppIcon from '@/components/ui/AppIcon.vue';

defineProps<{ label?: string; modelValue: string | number; options: { value: string | number; label: string }[] }>();
const emit = defineEmits<{ (e: 'update:modelValue', v: string | number): void }>();
</script>

<template>
  <label class="block">
    <span v-if="label" class="pa-label block mb-1">{{ label }}</span>
    <span class="relative block">
      <select :value="modelValue" class="pa-input w-full h-8 !py-0 pr-8 appearance-none cursor-pointer"
              @change="emit('update:modelValue', (($event.target as HTMLSelectElement).value))">
        <option v-for="o in options" :key="o.value" :value="o.value">{{ o.label }}</option>
      </select>
      <AppIcon name="chevron-down" :size="14" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-pebble-text-dim pointer-events-none" />
    </span>
  </label>
</template>
