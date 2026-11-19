<script setup lang="ts">
/**
 * ProverbPanel.vue — Manage the current page's proverbs. Proverbs are real text
 * blocks, so each one can be MOVED, ROTATED, RESTYLED (font/size/colour) on the
 * canvas, and a page can have MORE THAN ONE. Click a proverb to select + edit it
 * (opens the Text panel); add from the theme suggestions, your album proverbs, or
 * a blank one (shown to the user as the page's "Text" tab). Legacy single-proverb pages are migrated to a text block on open.
 */
import { computed, onMounted, watch } from 'vue';
import { v4 as uuid } from 'uuid';
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { proverbsByCategory } from '@/engine/proverbSelector';
import type { TextBlock } from '@shared/pebble.types';
import AppIcon from '@/components/ui/AppIcon.vue';

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
  <div class="p-3 flex flex-col gap-4 h-full overflow-auto">
    <section>
      <div class="flex items-center justify-between mb-2">
        <div class="pa-section">Text on this page</div>
        <button type="button" class="pa-btn !h-7 !px-2" title="Add a text block you can move, rotate and restyle" @click="addProverb('Your proverb here')">
          <AppIcon name="plus" :size="14" />Add text
        </button>
      </div>

      <div v-if="proverbBlocks.length" class="space-y-0.5">
        <div v-for="p in proverbBlocks" :key="p.id"
             class="flex items-center gap-1 h-9 pl-2 pr-1 rounded-md border-l-2 cursor-pointer transition-colors"
             :class="editor.selectedObjectId === p.id ? 'bg-pebble-accent/15 border-pebble-accent' : 'border-transparent hover:bg-pebble-hover'"
             @click="selectProverb(p.id)">
          <span class="flex-1 truncate text-xs italic" :style="{ fontFamily: p.style.fontFamily }">{{ p.content || 'Empty text' }}</span>
          <button type="button" class="pa-iconbtn !h-7 !w-7" title="Edit text" aria-label="Edit text" @click.stop="selectProverb(p.id)"><AppIcon name="pencil" :size="14" /></button>
          <button type="button" class="pa-iconbtn !h-7 !w-7 hover:!text-pebble-danger" title="Remove text" aria-label="Remove text" @click.stop="removeProverb(p.id)"><AppIcon name="trash" :size="14" /></button>
        </div>
        <p class="pa-hint pt-1.5">Click a text to edit its font, size, colour and rotation. Drag it on the page to reposition.</p>
      </div>
      <div v-else class="rounded-md border border-dashed border-pebble-border px-3 py-4 text-center pa-hint">
        No text on this page yet. Use <b class="text-pebble-text">Add text</b>, or pick a proverb below.
      </div>
    </section>

    <section v-if="themeSuggestions.length">
      <div class="pa-section mb-2">Proverbs for this theme</div>
      <div class="flex flex-col gap-1">
        <button v-for="p in themeSuggestions" :key="p" type="button" :title="p"
                class="pa-tile px-2 py-1.5 text-left text-xs leading-snug" @click="addProverb(p)">{{ p }}</button>
      </div>
    </section>
    <section v-if="(project.meta?.proverbs || []).length">
      <div class="pa-section mb-2">Your album proverbs</div>
      <div class="flex flex-col gap-1">
        <button v-for="p in project.meta?.proverbs || []" :key="p" type="button" :title="p"
                class="pa-tile px-2 py-1.5 text-left text-xs leading-snug" @click="addProverb(p)">{{ p }}</button>
      </div>
    </section>
  </div>
</template>
