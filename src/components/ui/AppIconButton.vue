<script setup lang="ts">
/**
 * AppIconButton — square icon-only button for toolbars. An icon without words
 * must explain itself, so `label` is REQUIRED: it is the accessible name and
 * the tooltip text (plus an optional `shortcut` hint). `active` shows a
 * toggled/on state; `disabledHint` replaces the tooltip while disabled so the
 * user learns why the control is unavailable.
 */
import AppIcon from '@/components/ui/AppIcon.vue';
import AppTooltip from '@/components/ui/AppTooltip.vue';
import type { IconName } from '@/components/ui/icons';

withDefaults(defineProps<{
  icon: IconName;
  label: string;
  shortcut?: string;
  active?: boolean;
  disabled?: boolean;
  /** Tooltip shown instead of `label` while disabled (says why). */
  disabledHint?: string;
  size?: 'sm' | 'md';
  placement?: 'top' | 'bottom';
}>(), { active: false, disabled: false, size: 'md', placement: 'bottom' });
</script>

<template>
  <AppTooltip :text="disabled && disabledHint ? disabledHint : label" :shortcut="disabled ? undefined : shortcut" :placement="placement">
    <button type="button" :aria-label="label" :aria-pressed="active || undefined" :disabled="disabled"
            :class="['pa-iconbtn', size === 'sm' ? '!h-7 !w-7' : '', active ? '!bg-pebble-accent/20 !text-pebble-accent-soft' : '']">
      <AppIcon :name="icon" :size="size === 'sm' ? 15 : 17" />
    </button>
  </AppTooltip>
</template>
