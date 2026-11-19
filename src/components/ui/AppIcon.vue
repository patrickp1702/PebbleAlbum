<script setup lang="ts">
/**
 * AppIcon — renders ONE glyph from the app's stroke-icon set (ui/icons.ts) as
 * inline SVG. Colour follows `currentColor`, so an icon always matches the text
 * it sits beside; size is in px. Decorative by default (aria-hidden) — the
 * control that hosts it carries the accessible name.
 */
import { ICONS, type IconName } from '@/components/ui/icons';

withDefaults(defineProps<{
  name: IconName;
  /** Rendered width/height in px. 16 inline, 18–20 in rails, 24+ in empty states. */
  size?: number;
  /** Stroke weight on the 24px grid. */
  stroke?: number;
}>(), { size: 16, stroke: 1.75 });
</script>

<template>
  <svg :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor"
       :stroke-width="stroke" stroke-linecap="round" stroke-linejoin="round"
       class="shrink-0 inline-block" aria-hidden="true" focusable="false">
    <path :d="ICONS[name]" />
  </svg>
</template>
