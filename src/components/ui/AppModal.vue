<script setup lang="ts">
/** AppModal — centered dialog with backdrop. v-model:open controls visibility. */
defineProps<{ open: boolean; title?: string; width?: string }>();
const emit = defineEmits<{ (e: 'update:open', v: boolean): void }>();
</script>

<template>
  <transition name="fade">
    <div v-if="open" class="fixed inset-0 z-50 flex items-center justify-center p-6"
         @click.self="emit('update:open', false)">
      <div class="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div class="relative pa-panel shadow-2xl w-full" :style="{ maxWidth: width || '560px' }">
        <header v-if="title" class="flex items-center justify-between px-5 py-3 border-b border-pebble-border">
          <h3 class="font-semibold">{{ title }}</h3>
          <button class="text-pebble-text-dim hover:text-pebble-text" @click="emit('update:open', false)">✕</button>
        </header>
        <div class="p-5 max-h-[70vh] overflow-auto"><slot /></div>
        <footer v-if="$slots.footer" class="px-5 py-3 border-t border-pebble-border flex justify-end gap-2">
          <slot name="footer" />
        </footer>
      </div>
    </div>
  </transition>
</template>
