<script setup lang="ts">
/**
 * AppSlider — labelled range input. Label on the left, the LIVE value on the
 * right (tabular figures so it does not jitter), an accent fill up to the thumb
 * (from the zero point for bipolar ranges, so "0" reads as untouched).
 * Double-click the slider to reset it — the convention photo editors share:
 * to `resetTo` when given, otherwise to 0 for a bipolar range (min < 0 < max).
 * Unipolar sliders without `resetTo` have no implied default and do not reset.
 */
import { computed } from 'vue';

const props = defineProps<{
  label?: string; min: number; max: number; step?: number; modelValue: number; unit?: string;
  /** Value restored on double-click. */
  resetTo?: number;
  disabled?: boolean;
}>();
const emit = defineEmits<{ (e: 'update:modelValue', v: number): void }>();

const resetValue = computed<number | null>(() =>
  props.resetTo !== undefined ? props.resetTo : (props.min < 0 && props.max > 0 ? 0 : null));
/** Accent fill as [from%, to%] of the track. A bipolar range (min < 0 < max)
 *  fills FROM ITS ZERO POINT outwards, so a neutral value shows no fill at all;
 *  a unipolar range fills from the left edge to the thumb. */
const fill = computed(() => {
  const span = props.max - props.min;
  const at = (v: number) => (span > 0 ? Math.min(100, Math.max(0, ((v - props.min) / span) * 100)) : 0);
  const thumb = at(Number(props.modelValue));
  const origin = props.min < 0 && props.max > 0 ? at(0) : 0;
  return { from: `${Math.min(origin, thumb)}%`, to: `${Math.max(origin, thumb)}%` };
});
const changed = computed(() => resetValue.value !== null && Number(props.modelValue) !== resetValue.value);
function reset() { if (resetValue.value !== null && !props.disabled) emit('update:modelValue', resetValue.value); }
</script>

<template>
  <label class="block">
    <div v-if="label" class="flex items-baseline justify-between mb-0.5">
      <span class="pa-label">{{ label }}</span>
      <span class="text-xs tabular-nums" :class="changed ? 'text-pebble-accent-soft' : 'text-pebble-text'">{{ modelValue }}{{ unit || '' }}</span>
    </div>
    <input type="range" :min="min" :max="max" :step="step || 1" :value="modelValue" :disabled="disabled"
           class="w-full block" :style="{ '--pa-fill-from': fill.from, '--pa-fill': fill.to }"
           :title="resetValue !== null ? 'Double-click to reset' : undefined"
           @input="emit('update:modelValue', Number(($event.target as HTMLInputElement).value))"
           @dblclick="reset" />
  </label>
</template>
