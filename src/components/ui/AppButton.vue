<script setup lang="ts">
/** AppButton — primary/secondary/ghost button with optional icon slot. */
withDefaults(defineProps<{
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
  block?: boolean;
}>(), { variant: 'primary', size: 'md', disabled: false, block: false });
</script>

<template>
  <button
    :disabled="disabled"
    :class="[
      'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition active:scale-[.98] disabled:opacity-40 disabled:cursor-not-allowed',
      block ? 'w-full' : '',
      size === 'sm' ? 'px-3 py-1.5 text-xs' : size === 'lg' ? 'px-6 py-3 text-base' : 'px-4 py-2 text-sm',
      variant === 'primary' ? 'bg-pebble-accent text-white hover:bg-pebble-accent-soft shadow-lg shadow-pebble-accent/20' : '',
      variant === 'secondary' ? 'bg-pebble-surface-2 text-pebble-text border border-pebble-border hover:border-pebble-accent/60' : '',
      variant === 'ghost' ? 'text-pebble-text-dim hover:text-pebble-text hover:bg-white/5' : '',
      variant === 'danger' ? 'bg-red-600/90 text-white hover:bg-red-500' : '',
    ]"
  >
    <slot />
  </button>
</template>
