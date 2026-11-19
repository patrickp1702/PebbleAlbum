<script setup lang="ts">
/**
 * AppModal — centred dialog over a dimmed backdrop. v-model:open controls
 * visibility; click the backdrop, the close button or press Esc to dismiss.
 * The footer slot holds the actions, right-aligned, primary last.
 */
import { watch, onBeforeUnmount } from 'vue';
import AppIcon from '@/components/ui/AppIcon.vue';

const props = defineProps<{ open: boolean; title?: string; width?: string }>();
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>();

/** Esc closes the top-most dialog only (capture phase: screens underneath that
 *  also listen for Esc — e.g. the editor's "deselect" — must not react too). */
function onKey(e: KeyboardEvent) {
  if (e.key !== 'Escape') return;
  e.stopPropagation();
  emit('update:open', false);
}
watch(() => props.open, (o) => {
  if (o) window.addEventListener('keydown', onKey, true);
  else window.removeEventListener('keydown', onKey, true);
}, { immediate: true });
onBeforeUnmount(() => window.removeEventListener('keydown', onKey, true));
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center p-6"
         @click.self="emit('update:open', false)">
      <div class="absolute inset-0 bg-black/60" @click="emit('update:open', false)" />
      <div class="relative bg-pebble-surface border border-pebble-border rounded-2xl shadow-modal w-full flex flex-col"
           role="dialog" aria-modal="true" :aria-label="title" :style="{ maxWidth: width || '560px' }">
        <header v-if="title" class="flex items-center justify-between pl-5 pr-3 h-12 border-b border-pebble-border shrink-0">
          <h3 class="text-base font-semibold">{{ title }}</h3>
          <button type="button" class="pa-iconbtn" aria-label="Close" title="Close (Esc)" @click="emit('update:open', false)">
            <AppIcon name="x" />
          </button>
        </header>
        <div class="p-5 max-h-[70vh] overflow-auto"><slot /></div>
        <footer v-if="$slots.footer" class="px-5 py-3 border-t border-pebble-border flex justify-end gap-2 shrink-0">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </transition>
</template>
