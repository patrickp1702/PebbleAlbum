<script setup lang="ts">
/**
 * TextPropertiesPanel.vue — Context panel for the selected TEXT block (proverbs,
 * titles, captions, custom text). Lets the user edit the content and full
 * typography (font, size, weight, italic, colour, alignment, spacing), plus
 * rotation and opacity. The block is also movable/rotatable directly on the
 * canvas; this panel mirrors and refines those properties.
 */
import { computed } from 'vue';
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import fontsData from '@/config/fonts.json';
import AppSlider from '@/components/ui/AppSlider.vue';
import AppColorPicker from '@/components/ui/AppColorPicker.vue';
import AppButton from '@/components/ui/AppButton.vue';
import AppDropdown from '@/components/ui/AppDropdown.vue';
import AppIconButton from '@/components/ui/AppIconButton.vue';
import AppSegmented from '@/components/ui/AppSegmented.vue';

const project = useProjectStore();
const editor = useEditorStore();

const page = computed(() => project.pages[editor.activePageIndex]);
const block = computed(() =>
  page.value?.textBlocks.find((t) => t.id === editor.selectedObjectId) ?? null);

const fontOptions = (fontsData as { fonts: { family: string; label: string }[] }).fonts
  .map((f) => ({ value: f.family, label: f.label }));
const alignOptions = [
  { value: 'left', label: 'Left' }, { value: 'center', label: 'Center' },
  { value: 'right', label: 'Right' }, { value: 'justify', label: 'Justify' },
] as const;

// Text re-rendering needs a canvas rebuild; debounce continuous edits.
let timer: ReturnType<typeof setTimeout> | null = null;
const touch = () => {
  project.markDirty();
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => editor.requestRender(), 200);
};
const touchNow = () => { project.markDirty(); editor.requestRender(); };

function setFont(f: string | number) { if (block.value) { block.value.style.fontFamily = String(f); touchNow(); } }
function setAlign(a: string) { if (block.value) { block.value.style.align = a as 'left' | 'center' | 'right' | 'justify'; touchNow(); } }
function toggleBold() { const b = block.value; if (b) { b.style.fontWeight = b.style.fontWeight === 'bold' ? 'normal' : 'bold'; touchNow(); } }
function toggleItalic() { const b = block.value; if (b) { b.style.fontStyle = b.style.fontStyle === 'italic' ? 'normal' : 'italic'; touchNow(); } }
// Legibility kit (for text over busy photos)
function togglePlate(on: boolean) { const b = block.value; if (b) { b.style.background = on ? (b.style.background || 'rgba(0,0,0,0.6)') : undefined; touchNow(); } }
function setPlate(c: string) { const b = block.value; if (b) { b.style.background = c; touchNow(); } }
function toggleOutline(on: boolean) { const b = block.value; if (b) { b.style.textStroke = on ? (b.style.textStroke || { width: 2, color: '#000000' }) : undefined; touchNow(); } }
function setOutline(part: 'width' | 'color', v: number | string) { const b = block.value; if (b) { const s = b.style.textStroke ?? { width: 2, color: '#000000' }; b.style.textStroke = { ...s, [part]: v } as { width: number; color: string }; touchNow(); } }
function toggleTextShadow(on: boolean) { const b = block.value; if (b) { b.style.textShadow = on ? (b.style.textShadow || { offsetX: 0, offsetY: 2, blur: 6, spread: 0, color: '#000000', opacity: 0.6 }) : undefined; touchNow(); } }
function back() { editor.propertiesOpen = false; }
function remove() {
  const b = block.value; if (!b || !page.value) return;
  page.value.textBlocks = page.value.textBlocks.filter((t) => t.id !== b.id);
  editor.selectObject(null);
  project.markDirty(); editor.requestRender();
}
</script>

<template>
  <div v-if="block" class="flex flex-col h-full">
    <!-- What is selected -->
    <header class="pl-1.5 pr-3 h-12 shrink-0 border-b border-pebble-border flex items-center gap-1.5">
      <AppIconButton icon="chevron-left" label="Back to page" @click="back" />
      <div class="min-w-0">
        <div class="pa-section">{{ block.type }} text</div>
        <div class="text-sm font-medium truncate" :title="block.content">{{ block.content || 'Empty text' }}</div>
      </div>
    </header>

    <div class="flex-1 min-h-0 overflow-auto p-3 space-y-4 text-sm">
      <section class="space-y-1.5">
        <div class="pa-section">Content</div>
        <textarea v-model="block.content" rows="3" class="pa-input w-full block resize-y" aria-label="Text" @input="touch" />
      </section>

      <section class="space-y-2.5">
        <div class="pa-section">Typography</div>
        <AppDropdown label="Font" :model-value="block.style.fontFamily" :options="fontOptions" @update:model-value="setFont" />
        <AppSlider label="Size" :min="8" :max="200" v-model="block.style.fontSize" unit="px" @update:model-value="touch" />
        <div class="flex gap-2">
          <button type="button" class="pa-btn flex-1 !text-sm font-bold" title="Bold" :aria-pressed="block.style.fontWeight === 'bold'"
                  :class="block.style.fontWeight === 'bold' ? '!bg-pebble-accent !border-pebble-accent !text-pebble-on-accent' : ''"
                  @click="toggleBold">B</button>
          <button type="button" class="pa-btn flex-1 !text-sm italic font-serif" title="Italic" :aria-pressed="block.style.fontStyle === 'italic'"
                  :class="block.style.fontStyle === 'italic' ? '!bg-pebble-accent !border-pebble-accent !text-pebble-on-accent' : ''"
                  @click="toggleItalic">I</button>
        </div>
        <div>
          <div class="pa-label mb-1">Alignment</div>
          <AppSegmented :model-value="block.style.align" :options="alignOptions" @update:model-value="setAlign" />
        </div>
        <AppColorPicker label="Colour" v-model="block.style.color" @update:model-value="touch" />
      </section>

      <section class="space-y-2">
        <div class="pa-section">Spacing &amp; shape</div>
        <AppSlider label="Letter spacing" :min="-5" :max="40" v-model="block.style.letterSpacing" @update:model-value="touch" />
        <AppSlider label="Line height" :min="80" :max="240" :model-value="Math.round(block.style.lineHeight*100)" unit="%" @update:model-value="v => { block!.style.lineHeight = v/100; touch(); }" />
        <AppSlider label="Bend" :min="-100" :max="100" :model-value="Math.round(block.style.curve ?? 0)"
                   @update:model-value="v => { block!.style.curve = v; touch(); }" />
        <p v-if="block.style.curve" class="pa-hint">Positive arcs up (smile), negative arcs down; ±100 ≈ a full circle.</p>
      </section>

      <section class="space-y-2">
        <div class="pa-section">Rotation &amp; opacity</div>
        <AppSlider label="Rotation" :min="-180" :max="180" v-model="block.position.rotation" unit="°" @update:model-value="touch" />
        <AppSlider label="Opacity" :min="0" :max="100" :reset-to="100" :model-value="Math.round(block.style.opacity*100)" unit="%" @update:model-value="v => { block!.style.opacity = v/100; touch(); }" />
      </section>

      <!-- Legibility kit (for text over busy photos) -->
      <section class="space-y-1.5">
        <div class="pa-section">Legibility</div>
        <label class="flex items-center justify-between text-xs h-7 cursor-pointer"><span>Background plate</span>
          <input type="checkbox" :checked="!!block.style.background" @change="togglePlate(($event.target as HTMLInputElement).checked)" /></label>
        <AppColorPicker v-if="block.style.background" label="Plate colour" :model-value="block.style.background" @update:model-value="setPlate" />
        <label class="flex items-center justify-between text-xs h-7 cursor-pointer"><span>Outline</span>
          <input type="checkbox" :checked="!!block.style.textStroke" @change="toggleOutline(($event.target as HTMLInputElement).checked)" /></label>
        <template v-if="block.style.textStroke">
          <AppSlider label="Outline width" :min="0" :max="12" :model-value="block.style.textStroke.width" unit="px" @update:model-value="v => setOutline('width', v)" />
          <AppColorPicker label="Outline colour" :model-value="block.style.textStroke.color" @update:model-value="v => setOutline('color', v)" />
        </template>
        <label class="flex items-center justify-between text-xs h-7 cursor-pointer"><span>Drop shadow</span>
          <input type="checkbox" :checked="!!block.style.textShadow" @change="toggleTextShadow(($event.target as HTMLInputElement).checked)" /></label>
      </section>

      <div class="pt-3 border-t border-pebble-border">
        <AppButton size="sm" variant="ghost" icon="trash" block class="!text-pebble-danger" @click="remove">Delete text</AppButton>
      </div>
    </div>
  </div>
</template>
