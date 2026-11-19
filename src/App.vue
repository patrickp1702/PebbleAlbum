<script setup lang="ts">
/**
 * App.vue — Root shell. Hosts the router view and global overlays (toasts).
 */
import { onMounted } from 'vue';
import { useAppStore } from '@/stores/appStore';
import AppToast from '@/components/ui/AppToast.vue';

const app = useAppStore();
onMounted(() => {
  document.documentElement.classList.toggle('light', app.preferences.uiTheme === 'light');
});
</script>

<template>
  <div class="h-full w-full text-pebble-text">
    <router-view v-slot="{ Component }">
      <transition name="fade" mode="out-in">
        <component :is="Component" />
      </transition>
    </router-view>
    <AppToast />
  </div>
</template>
