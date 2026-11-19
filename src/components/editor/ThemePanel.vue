<script setup lang="ts">
/** ThemePanel.vue — Live theme switcher. Changing the theme re-renders the page. */
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { THEMES, injectThemeVars, resolveTheme } from '@/engine/themeEngine';
import AppIcon from '@/components/ui/AppIcon.vue';

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
  <div class="h-full overflow-auto p-3">
    <div class="grid grid-cols-[repeat(auto-fill,minmax(120px,1fr))] gap-2.5">
      <button v-for="t in THEMES" :key="t.id" type="button" @click="pick(t.id)" :aria-pressed="project.meta?.theme === t.id"
              :class="['pa-tile overflow-hidden text-left', project.meta?.theme === t.id ? 'is-active' : '']">
        <!-- Swatch uses the ALBUM theme's own colours/fonts (user content, not app chrome). -->
        <div class="h-14 flex items-center justify-center text-lg" :style="{ background: t.colors.background, color: t.colors.accent, fontFamily: t.fonts.display }">Aa</div>
        <div class="px-2 h-7 flex items-center gap-1 text-2xs">
          <AppIcon v-if="project.meta?.theme === t.id" name="check" :size="12" class="text-pebble-accent-soft" />
          <span class="truncate">{{ t.name }}</span>
        </div>
      </button>
    </div>
  </div>
</template>
