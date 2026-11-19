<script setup lang="ts">
/**
 * AppButton — the text button. Four weights so a screen can have exactly ONE
 * obvious primary action:
 *   primary   filled accent — the single main action of a screen / dialog
 *   secondary neutral raised — everything else that needs a visible button
 *   ghost     no chrome until hover — tertiary / toolbar text actions
 *   danger    filled red — destructive confirmation only
 * Sizes map to the density scale (28 / 32 / 40px). Optional leading `icon`.
 */
import AppIcon from '@/components/ui/AppIcon.vue';
import type { IconName } from '@/components/ui/icons';

withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  block?: boolean;
  /** Leading icon from the app icon set. */
  icon?: IconName;
}>(), { variant: 'primary', size: 'md', disabled: false, block: false });
</script>

<template>
  <button
    type="button"
    :disabled="disabled"
    :class="[
      'inline-flex items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap select-none transition-colors disabled:opacity-40 disabled:cursor-not-allowed',
      block ? 'w-full' : '',
      size === 'sm' ? 'h-7 px-2.5 text-xs' : size === 'lg' ? 'h-10 px-5 text-base' : 'h-8 px-3.5 text-sm',
      variant === 'primary' ? 'bg-pebble-accent text-pebble-on-accent enabled:hover:bg-pebble-accent-hover enabled:active:bg-pebble-accent-pressed' : '',
      variant === 'secondary' ? 'bg-pebble-surface-2 text-pebble-text border border-pebble-border enabled:hover:bg-pebble-hover enabled:hover:border-pebble-border-strong enabled:active:bg-pebble-pressed' : '',
      variant === 'ghost' ? 'text-pebble-text-dim enabled:hover:text-pebble-text enabled:hover:bg-pebble-hover enabled:active:bg-pebble-pressed' : '',
      variant === 'danger' ? 'bg-pebble-danger-fill text-white enabled:hover:brightness-110 enabled:active:brightness-90' : '',
    ]"
  >
    <AppIcon v-if="icon" :name="icon" :size="size === 'lg' ? 18 : size === 'sm' ? 14 : 16" />
    <slot />
  </button>
</template>
