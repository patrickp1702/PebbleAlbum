<script setup lang="ts">
/**
 * AppToast — bottom-right notification stack driven by appStore.toasts. The
 * kind is carried by an icon + its semantic colour (never by colour alone);
 * the message itself stays primary text for legibility.
 */
import { useAppStore } from '@/stores/appStore';
import AppIcon from '@/components/ui/AppIcon.vue';
import type { IconName } from '@/components/ui/icons';

const app = useAppStore();
const tone: Record<string, { icon: IconName; cls: string }> = {
  success: { icon: 'check-circle', cls: 'text-pebble-success' },
  error: { icon: 'alert', cls: 'text-pebble-danger' },
  warning: { icon: 'alert', cls: 'text-pebble-warning' },
  info: { icon: 'info', cls: 'text-pebble-accent-soft' },
};
</script>

<template>
  <div class="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 w-80" role="status" aria-live="polite">
    <transition-group name="toast">
      <div v-for="t in app.toasts" :key="t.id"
           class="bg-pebble-surface-2 border border-pebble-border-strong/50 rounded-lg shadow-pop pl-3 pr-1.5 py-2.5 text-sm flex items-start gap-2.5">
        <AppIcon :name="(tone[t.kind] ?? tone.info).icon" :size="17" :class="['mt-px', (tone[t.kind] ?? tone.info).cls]" />
        <span class="flex-1 min-w-0 break-words text-pebble-text">{{ t.message }}</span>
        <button type="button" class="pa-iconbtn !h-6 !w-6 -mt-0.5" aria-label="Dismiss" @click="app.dismissToast(t.id)">
          <AppIcon name="x" :size="13" />
        </button>
      </div>
    </transition-group>
  </div>
</template>

<style scoped>
.toast-enter-active, .toast-leave-active { transition: opacity 160ms var(--ui-ease), transform 160ms var(--ui-ease); }
.toast-enter-from, .toast-leave-to { opacity: 0; transform: translateY(8px); }
</style>
