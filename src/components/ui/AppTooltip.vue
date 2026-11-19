<script setup lang="ts">
/** AppTooltip — hover tooltip with a 300ms reveal delay. */
import { ref } from 'vue';
defineProps<{ text: string }>();
const show = ref(false);
let timer: ReturnType<typeof setTimeout> | null = null;
const enter = () => { timer = setTimeout(() => { show.value = true; }, 300); };
const leave = () => { if (timer) clearTimeout(timer); show.value = false; };
</script>

<template>
  <span class="relative inline-flex" @mouseenter="enter" @mouseleave="leave">
    <slot />
    <transition name="fade">
      <span v-if="show" class="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 whitespace-nowrap
                   px-2 py-1 rounded bg-black/90 text-[11px] text-white z-50 pointer-events-none">
        {{ text }}
      </span>
    </transition>
  </span>
</template>
