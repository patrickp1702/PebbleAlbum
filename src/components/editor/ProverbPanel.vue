<script setup lang="ts">
/**
 * ProverbPanel.vue — Manage the current page's proverbs. Proverbs are real text
 * blocks, so each one can be MOVED, ROTATED, RESTYLED (font/size/colour) on the
 * canvas, and a page can have MORE THAN ONE. Click a proverb to select + edit it
 * (opens the Text panel); add from the theme suggestions, your album proverbs, or
 * a blank one. Legacy single-proverb pages are migrated to a text block on open.
 */
import { computed, onMounted, watch } from 'vue';
import { v4 as uuid } from 'uuid';
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { proverbsByCategory } from '@/engine/proverbSelector';
import type { TextBlock } from '@shared/pebble.types';
import AppButton from '@/components/ui/AppButton.vue';

const project = useProjectStore();
const editor = useEditorStore();
const page = computed(() => project.pages[editor.activePageIndex]);

const proverbBlocks = computed(() => page.value?.textBlocks.filter((t) => t.type === 'proverb') ?? []);

const themeSuggestions = computed(() => {
  const cat = project.theme?.proverbCategory;
  return cat ? proverbsByCategory(cat).slice(0, 12) : [];
});

/** Build a proverb text block, staggered so multiple don't stack exactly. */
function makeProverbBlock(text: string): TextBlock {
  const m = project.meta!;
  const th = project.theme;
  const n = proverbBlocks.value.length;
  return {
    id: uuid(),
    content: text,
    type: 'proverb',
    position: {
      x: m.albumWidth * 0.1,
      y: m.albumHeight * (0.8 - Math.min(0.5, n * 0.12)),
      width: m.albumWidth * 0.8,
      height: Math.round(m.albumHeight * 0.08),
      rotation: 0,
    },
    style: {
      fontFamily: th?.fonts.display ?? 'Playfair Display',
      fontSize: Math.round(m.albumHeight * 0.035),
      fontWeight: 'normal', fontStyle: 'italic',
      color: th?.colors.text ?? '#222222', align: 'center',
      letterSpacing: 0, lineHeight: 1.3, textTransform: 'none', opacity: 0.95,
    },
    zIndex: 300 + n,
    visible: true, locked: false,
  };
}

/** Older projects stored a single `page.proverb`; convert it to a text block. */
function migrateLegacy() {
  const pg = page.value;
  if (!pg || !project.meta) return;
  if (pg.proverb && !proverbBlocks.value.length) {
    pg.textBlocks.push(makeProverbBlock(pg.proverb));
    pg.proverb = undefined;
    project.markDirty();
  }
}
onMounted(migrateLegacy);
watch(() => editor.activePageIndex, migrateLegacy);

function addProverb(text: string) {
  const pg = page.value;
  if (!pg || !project.meta) return;
  migrateLegacy();
  const tb = makeProverbBlock(text);
  pg.textBlocks.push(tb);
  // Select + open the Text panel so the user can style/move it immediately.
  editor.selectObject(tb.id, 'text');
  editor.propertiesOpen = true;
  project.markDirty();
  editor.requestRender();
}

function selectProverb(id: string) { editor.requestSelect(id, true); }
function removeProverb(id: string) {
  const pg = page.value;
  if (!pg) return;
  pg.textBlocks = pg.textBlocks.filter((t) => t.id !== id);
  if (editor.selectedObjectId === id) editor.selectObject(null);
  project.markDirty();
  editor.requestRender();
}
</script>

<template>
  <div class="p-3 flex flex-col gap-3 h-full overflow-auto">
    <div class="flex items-center justify-between">
      <div class="text-2xs uppercase tracking-wider text-pebble-text-dim">Proverbs on this page</div>
      <AppButton size="sm" @click="addProverb('Your proverb here')">+ Add</AppButton>
    </div>

    <div v-if="proverbBlocks.length" class="space-y-1.5">
      <div v-for="p in proverbBlocks" :key="p.id"
           class="flex items-center gap-2 rounded bg-pebble-bg p-1.5 cursor-pointer hover:bg-pebble-hover transition"
           :class="editor.selectedObjectId === p.id ? 'ring-1 ring-pebble-accent' : ''"
           @click="selectProverb(p.id)">
        <span class="flex-1 truncate text-[12px] italic" :style="{ fontFamily: p.style.fontFamily }">{{ p.content || 'Empty proverb' }}</span>
        <button class="px-1.5 py-1 rounded text-pebble-text-dim hover:text-pebble-accent hover:bg-pebble-hover" title="Edit" @click.stop="selectProverb(p.id)">✎</button>
        <button class="px-1.5 py-1 rounded text-pebble-text-dim hover:text-pebble-danger hover:bg-pebble-hover" title="Remove" @click.stop="removeProverb(p.id)">✕</button>
      </div>
      <p class="text-2xs text-pebble-text-dim">Click a proverb to edit its font, size, colour & rotation. Drag it on the page to reposition.</p>
    </div>
    <p v-else class="text-2xs text-pebble-text-dim">No proverbs yet. Add one, or pick a suggestion below.</p>

    <div class="flex-1 space-y-3">
      <div v-if="themeSuggestions.length">
        <div class="text-xs text-pebble-text-dim mb-1">Suggested for this theme</div>
        <div class="flex flex-wrap gap-2">
          <button v-for="p in themeSuggestions" :key="p" class="pa-chip max-w-xs truncate" @click="addProverb(p)">{{ p }}</button>
        </div>
      </div>
      <div v-if="(project.meta?.proverbs || []).length">
        <div class="text-xs text-pebble-text-dim mb-1">From your album proverbs</div>
        <div class="flex flex-wrap gap-2">
          <button v-for="p in project.meta?.proverbs || []" :key="p" class="pa-chip max-w-xs truncate" @click="addProverb(p)">{{ p }}</button>
        </div>
      </div>
    </div>
  </div>
</template>
