<script setup lang="ts" generic="T">
/**
 * VirtualList — minimal fixed-row-height windowed list. Renders only the rows
 * inside the viewport (+ overscan), so tens of thousands of result rows scroll
 * without lag. No external deps: a scroll container, a full-height spacer and
 * an absolutely-positioned window of rows.
 */
import { ref, computed } from 'vue';

const props = withDefaults(defineProps<{
  items: T[];
  /** Fixed pixel height of every row. */
  itemHeight: number;
  /** Extra rows rendered above/below the viewport. */
  overscan?: number;
}>(), { overscan: 6 });

const host = ref<HTMLDivElement | null>(null);
const scrollTop = ref(0);
const viewH = ref(0);

function onScroll() {
  if (!host.value) return;
  scrollTop.value = host.value.scrollTop;
  viewH.value = host.value.clientHeight;
}

const range = computed(() => {
  const h = Math.max(1, props.itemHeight);
  const vh = viewH.value || host.value?.clientHeight || 800;
  const start = Math.max(0, Math.floor(scrollTop.value / h) - props.overscan);
  const end = Math.min(props.items.length, Math.ceil((scrollTop.value + vh) / h) + props.overscan);
  return { start, end };
});

const visible = computed(() =>
  props.items.slice(range.value.start, range.value.end).map((item, i) => ({ item, index: range.value.start + i })));
</script>

<template>
  <div ref="host" class="h-full overflow-y-auto relative" @scroll.passive="onScroll">
    <div :style="{ height: `${items.length * itemHeight}px`, position: 'relative' }">
      <div v-for="v in visible" :key="v.index"
           :style="{ position: 'absolute', top: `${v.index * itemHeight}px`, left: 0, right: 0, height: `${itemHeight}px` }">
        <slot :item="v.item" :index="v.index" />
      </div>
    </div>
    <div v-if="!items.length" class="absolute inset-0 grid place-items-center text-sm text-pebble-text-dim">
      <slot name="empty">Nothing to show.</slot>
    </div>
  </div>
</template>
