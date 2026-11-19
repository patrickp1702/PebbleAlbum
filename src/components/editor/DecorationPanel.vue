<script setup lang="ts">
/**
 * DecorationPanel.vue — page decoration controls, in four sections:
 *  1. Page patterns  — procedural fills (bokeh, confetti, triangles, …) drawn
 *                      BEHIND the photos.
 *  2. Frames & corners — SVG overlay art (corners, frames, bands) drawn at the
 *                      page edges, behind the subjects.
 *  3. Graphic stickers — full-colour SVG stickers (any shape, true aspect ratio).
 *  4. Emoji stickers   — unicode glyph stickers; the theme suggests a set.
 * Stickers are movable objects placed in FRONT of the photos.
 * Stickers are listed first: the editor's "Sticker" insert button opens this
 * panel, so the thing the user came for is at the top.
 */
import { computed, ref, onMounted, reactive } from 'vue';
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { PATTERNS } from '@/engine/decoEngine';
import { SVG_STICKERS, stickerDataUrl, type SvgSticker } from '@/config/stickers';
import type { CustomSticker } from '@shared/ipc.types';
import { v4 as uuid } from 'uuid';
import AppIcon from '@/components/ui/AppIcon.vue';

const project = useProjectStore();
const editor = useEditorStore();

// "My stickers" — user-made cutouts saved in the global library (PNG files).
const customStickers = ref<CustomSticker[]>([]);
const customThumbs = reactive<Record<string, string>>({});
async function loadCustomStickers() {
  try {
    customStickers.value = await window.pebble.listCustomStickers();
    for (const s of customStickers.value) {
      if (!customThumbs[s.path]) {
        window.pebble.readImageBase64(s.path).then((d) => { customThumbs[s.path] = d; }).catch(() => {});
      }
    }
  } catch { customStickers.value = []; }
}
onMounted(loadCustomStickers);

function addCustomSticker(s: CustomSticker) {
  const page = project.pages[editor.activePageIndex];
  if (!page || !project.meta) return;
  const h = Math.round(project.meta.albumHeight * 0.22);
  const w = Math.round(h * ((s.width || 1) / (s.height || 1)));
  page.decorations.push({
    id: uuid(), type: 'sticker', params: { file: s.path },
    position: { x: project.meta.albumWidth / 2 - w / 2, y: project.meta.albumHeight / 2 - h / 2, width: w, height: h, rotation: 0 },
    opacity: 1, blendMode: 'normal', zIndex: 400, visible: true, locked: false,
  });
  project.markDirty();
  editor.requestRender();
}

async function removeCustomSticker(s: CustomSticker) {
  try { await window.pebble.deleteCustomSticker(s.path); await loadCustomStickers(); } catch { /* keep list */ }
}
const drawable = PATTERNS.filter((p) => p.type === 'canvas_draw');
const overlays = PATTERNS.filter((p) => p.type === 'svg_overlay');

const GENERAL_STICKERS = ['🦋', '🌸', '💐', '🌿', '🍃', '⭐', '✨', '❤️', '🤍', '🎈', '🎉', '🕊️', '🌙', '☀️', '🌊', '🧭', '📷', '💍'];
const themeStickers = computed(() => project.theme?.stickers ?? []);

// Decorations are keyed by the pattern *id* (stored in `renderer`), which is what
// the renderer looks up — for BOTH canvas_draw and svg_overlay patterns.
function has(id: string): boolean {
  return !!project.pages[editor.activePageIndex]?.decorations.some((d) => d.renderer === id);
}

function togglePattern(id: string) {
  const page = project.pages[editor.activePageIndex];
  if (!page) return;
  const idx = page.decorations.findIndex((d) => d.renderer === id);
  if (idx >= 0) page.decorations.splice(idx, 1);
  else page.decorations.push({
    id: uuid(), type: 'pattern_tile', renderer: id, params: {},
    position: { x: 0, y: 0, width: 1, height: 1, rotation: 0 },
    opacity: 1, blendMode: 'normal', zIndex: -5, visible: true, locked: false,
  });
  project.markDirty();
  editor.requestRender();
}

/** Add an emoji/glyph sticker at the page centre; the user can drag it anywhere. */
function addSticker(emoji: string) {
  const page = project.pages[editor.activePageIndex];
  if (!page || !project.meta) return;
  const size = Math.round(project.meta.albumHeight * 0.12);
  page.decorations.push({
    id: uuid(), type: 'sticker', params: { emoji },
    position: { x: project.meta.albumWidth / 2 - size / 2, y: project.meta.albumHeight / 2 - size / 2, width: size, height: size, rotation: 0 },
    opacity: 1, blendMode: 'normal', zIndex: 400, visible: true, locked: false,
  });
  project.markDirty();
  editor.requestRender();
}

/**
 * Add an SVG sticker. The placed box is sized to the sticker's INTRINSIC aspect
 * ratio (from its <svg> width/height), so a non-square sticker keeps its shape
 * and is never stretched.
 */
function addSvgSticker(s: SvgSticker) {
  const page = project.pages[editor.activePageIndex];
  if (!page || !project.meta) return;
  const h = Math.round(project.meta.albumHeight * 0.16);
  const w = Math.round(h * (s.w / s.h));
  page.decorations.push({
    id: uuid(), type: 'sticker', params: { svg: s.id },
    position: { x: project.meta.albumWidth / 2 - w / 2, y: project.meta.albumHeight / 2 - h / 2, width: w, height: h, rotation: 0 },
    opacity: 1, blendMode: 'normal', zIndex: 400, visible: true, locked: false,
  });
  project.markDirty();
  editor.requestRender();
}
</script>

<template>
  <div class="p-3 overflow-auto h-full space-y-5">
    <section>
      <div class="pa-section mb-1">Stickers</div>
      <p class="pa-hint mb-2">Click to drop one on the page, then drag it into place. Select it and press Delete to remove.</p>
      <div class="grid grid-cols-4 gap-1.5">
        <button v-for="s in SVG_STICKERS" :key="s.id" type="button" @click="addSvgSticker(s)" :title="s.label"
                class="pa-tile aspect-square !bg-pebble-bg flex items-center justify-center p-1.5">
          <img :src="stickerDataUrl(s.id) || ''" :alt="s.label" class="max-h-full max-w-full object-contain pointer-events-none" />
        </button>
      </div>
    </section>

    <section v-if="customStickers.length">
      <div class="pa-section mb-1">My stickers</div>
      <p class="pa-hint mb-2">Saved from the Erase / restore studio — available in every project.</p>
      <div class="grid grid-cols-4 gap-1.5">
        <div v-for="s in customStickers" :key="s.path" class="relative group">
          <button type="button" @click="addCustomSticker(s)" :title="s.name"
                  class="pa-tile w-full aspect-square !bg-pebble-bg flex items-center justify-center p-1.5 overflow-hidden">
            <img v-if="customThumbs[s.path]" :src="customThumbs[s.path]" :alt="s.name" class="max-h-full max-w-full object-contain pointer-events-none" />
          </button>
          <button type="button" class="absolute -top-1.5 -right-1.5 hidden group-hover:flex group-focus-within:flex h-5 w-5 items-center justify-center rounded-full bg-pebble-danger-fill text-white"
                  title="Delete sticker" aria-label="Delete sticker" @click.stop="removeCustomSticker(s)"><AppIcon name="x" :size="11" :stroke="2.5" /></button>
        </div>
      </div>
    </section>

    <section>
      <div class="pa-section mb-2">
        Emoji stickers <span v-if="themeStickers.length" class="normal-case tracking-normal font-normal text-pebble-accent-soft">· theme picks first</span>
      </div>
      <div class="grid grid-cols-6 gap-1.5">
        <button v-for="(s, i) in [...themeStickers, ...GENERAL_STICKERS]" :key="s + i" type="button" @click="addSticker(s)"
                class="pa-tile aspect-square text-xl leading-none">
          {{ s }}
        </button>
      </div>
    </section>

    <section>
      <div class="pa-section mb-1">Page patterns</div>
      <p class="pa-hint mb-2">Drawn behind the photos. Click to switch on or off.</p>
      <div class="grid grid-cols-3 gap-1.5">
        <button v-for="p in drawable" :key="p.id" type="button" @click="togglePattern(p.id)" :aria-pressed="has(p.id)"
                :class="['pa-tile px-1.5 h-9 text-2xs leading-tight', has(p.id) ? 'is-active !bg-pebble-accent/15' : '']">
          {{ p.label }}
        </button>
      </div>
    </section>

    <section>
      <div class="pa-section mb-2">Frames &amp; corners</div>
      <div class="grid grid-cols-3 gap-1.5">
        <button v-for="p in overlays" :key="p.id" type="button" @click="togglePattern(p.id)" :aria-pressed="has(p.id)"
                :class="['pa-tile px-1.5 h-9 text-2xs leading-tight', has(p.id) ? 'is-active !bg-pebble-accent/15' : '']">
          {{ p.label }}
        </button>
      </div>
    </section>
  </div>
</template>
