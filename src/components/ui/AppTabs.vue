<script setup lang="ts" generic="T extends string">
/**
 * AppTabs — panel tab bar. Each tab is icon + label so a section can be found
 * by shape as well as by word. `stacked` puts the icon above the label, which
 * lets five or six tabs fit a narrow side panel without shrinking the text.
 * The active tab is primary-text with an accent underline; the rest are quiet.
 */
import AppIcon from '@/components/ui/AppIcon.vue';
import type { IconName } from '@/components/ui/icons';

withDefaults(defineProps<{
  modelValue: T;
  tabs: readonly { id: T; label: string; icon?: IconName }[];
  stacked?: boolean;
}>(), { stacked: false });
const emit = defineEmits<{ (e: 'update:modelValue', v: T): void }>();
</script>

<template>
  <nav class="flex border-b border-pebble-border shrink-0" role="tablist">
    <button v-for="t in tabs" :key="t.id" type="button" role="tab" :aria-selected="modelValue === t.id"
            :class="['pa-tab', stacked ? 'flex-1 flex-col !gap-1 !h-[52px] !px-1 !text-2xs' : '', modelValue === t.id ? 'is-active' : '']"
            @click="emit('update:modelValue', t.id)">
      <AppIcon v-if="t.icon" :name="t.icon" :size="stacked ? 17 : 15"
               :class="modelValue === t.id ? 'text-pebble-accent-soft' : ''" />
      <span class="truncate max-w-full">{{ t.label }}</span>
    </button>
  </nav>
</template>
