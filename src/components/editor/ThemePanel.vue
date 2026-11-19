<script setup lang="ts">
/** ThemePanel.vue — Live theme switcher. Changing the theme re-renders the page. */
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { THEMES, injectThemeVars, resolveTheme } from '@/engine/themeEngine';

const project = useProjectStore();
const editor = useEditorStore();
function pick(id: string) {
  if (!project.meta) return;
  project.meta.theme = id;
  injectThemeVars(resolveTheme(project.meta));
  project.markDirty();
  editor.requestRender();
}
</script>

<template>
  <div class="grid grid-cols-5 gap-3 p-3 overflow-auto">
    <button v-for="t in THEMES" :key="t.id" @click="pick(t.id)"
            :class="['rounded overflow-hidden border-2 text-left', project.meta?.theme === t.id ? 'border-pebble-accent' : 'border-pebble-border']">
      <div class="h-12 flex items-center justify-center text-sm" :style="{ background: t.colors.background, color: t.colors.accent, fontFamily: t.fonts.display }">Aa</div>
      <div class="px-2 py-1 text-2xs bg-pebble-surface truncate">{{ t.name }}</div>
    </button>
  </div>
</template>
