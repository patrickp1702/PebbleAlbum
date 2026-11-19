<script setup lang="ts">
/** AppToast — bottom-right notification stack driven by appStore.toasts. */
import { useAppStore } from '@/stores/appStore';
const app = useAppStore();
const tone: Record<string, string> = {
  success: 'border-green-500/50 text-green-300',
  error: 'border-red-500/50 text-red-300',
  warning: 'border-amber-500/50 text-amber-300',
  info: 'border-pebble-accent/50 text-pebble-accent-soft',
};
</script>

<template>
  <div class="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80">
    <transition-group name="toast">
      <div v-for="t in app.toasts" :key="t.id"
           :class="['pa-panel px-4 py-3 text-sm flex items-start gap-2 shadow-xl border-l-4', tone[t.kind]]">
        <span class="flex-1 text-pebble-text">{{ t.message }}</span>
        <button class="text-pebble-text-dim hover:text-pebble-text" @click="app.dismissToast(t.id)">✕</button>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: all 0.25s ease; }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateX(20px); }
</style>
