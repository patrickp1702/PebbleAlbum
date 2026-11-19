<script setup lang="ts">
/**
 * AppTooltip — hover/focus tooltip with a short reveal delay and an optional
 * keyboard-shortcut hint. The bubble is teleported to <body> and positioned
 * with fixed coordinates, so it is never clipped by a toolbar edge or a
 * scrolling panel, and it is clamped to stay inside the window.
 */
import { ref, nextTick } from 'vue';

const props = withDefaults(defineProps<{
  text: string;
  /** Optional shortcut shown as a key cap, e.g. "⌘Z". */
  shortcut?: string;
  /** Preferred side; flips automatically when there is no room. */
  placement?: 'top' | 'bottom';
}>(), { placement: 'bottom' });

const host = ref<HTMLElement | null>(null);
const bubble = ref<HTMLElement | null>(null);
const show = ref(false);
const pos = ref({ left: 0, top: 0 });
let timer: ReturnType<typeof setTimeout> | null = null;

async function place() {
  await nextTick();
  const h = host.value?.getBoundingClientRect();
  const b = bubble.value?.getBoundingClientRect();
  if (!h || !b) return;
  const gap = 6;
  let top = props.placement === 'top' ? h.top - b.height - gap : h.bottom + gap;
  if (top + b.height > window.innerHeight - 4) top = h.top - b.height - gap;
  if (top < 4) top = h.bottom + gap;
  const left = Math.min(Math.max(4, h.left + h.width / 2 - b.width / 2), window.innerWidth - b.width - 4);
  pos.value = { left, top };
}
const enter = () => {
  if (!props.text) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { show.value = true; void place(); }, 350);
};
const leave = () => { if (timer) clearTimeout(timer); show.value = false; };
/** Focus shows the tooltip only for KEYBOARD focus. A mouse click also focuses
 *  the button — without this check the bubble pops back up after every click. */
const focus = (e: FocusEvent) => {
  const el = e.target as HTMLElement | null;
  if (el?.matches?.(':focus-visible')) enter();
};
</script>

<template>
  <span ref="host" class="relative inline-flex" @mouseenter="enter" @mouseleave="leave"
        @focusin="focus" @focusout="leave" @pointerdown="leave">
    <slot />
    <Teleport to="body">
      <span v-if="show" ref="bubble" role="tooltip"
            class="fixed z-[300] pointer-events-none flex items-center gap-2 whitespace-nowrap px-2 py-1 rounded-md
                   bg-pebble-pressed border border-pebble-border-strong/40 text-xs text-pebble-text shadow-pop"
            :style="{ left: `${pos.left}px`, top: `${pos.top}px` }">
        {{ text }}
        <span v-if="shortcut" class="text-pebble-text-dim font-mono text-2xs">{{ shortcut }}</span>
      </span>
    </Teleport>
  </span>
</template>
