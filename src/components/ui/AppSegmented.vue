<script setup lang="ts" generic="T extends string | number">
/**
 * AppSegmented — a segmented control: one choice out of a few, all visible at
 * once (tool modes, fit modes, line styles). The selected segment is filled
 * with the accent so the current mode is unmistakable. Options may carry an
 * icon and a `title` (native tooltip — e.g. the shortcut key).
 * `size="lg"` stacks icon above label for primary tool choices.
 */
import AppIcon from '@/components/ui/AppIcon.vue';
import type { IconName } from '@/components/ui/icons';

withDefaults(defineProps<{
  modelValue: T;
  options: readonly { value: T; label: string; icon?: IconName; title?: string }[];
  size?: 'md' | 'lg';
  disabled?: boolean;
}>(), { size: 'md', disabled: false });
const emit = defineEmits<{ (e: 'update:modelValue', v: T): void }>();
</script>

<template>
  <div class="pa-seg" role="group">
    <button v-for="o in options" :key="o.value" type="button" :title="o.title" :disabled="disabled"
            :aria-pressed="modelValue === o.value"
            :class="['pa-seg-item', size === 'lg' ? '!h-12 flex-col !gap-0.5' : '']"
            @click="emit('update:modelValue', o.value)">
      <AppIcon v-if="o.icon" :name="o.icon" :size="size === 'lg' ? 18 : 14" />
      <span class="truncate">{{ o.label }}</span>
    </button>
  </div>
</template>
