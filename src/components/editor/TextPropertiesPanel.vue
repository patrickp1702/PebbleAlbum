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
];

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
    <div class="px-3 py-2 border-b border-pebble-border flex items-center gap-2">
      <button class="shrink-0 h-7 px-2 rounded bg-pebble-surface-2 border border-pebble-border text-xs hover:border-pebble-accent"
              title="Back to page settings" @click="back">‹ Back</button>
      <div class="min-w-0">
        <div class="text-xs text-pebble-text-dim capitalize">{{ block.type }} text</div>
        <div class="text-sm truncate">{{ block.content || 'Empty text' }}</div>
      </div>
    </div>

    <div class="flex-1 overflow-auto p-3 space-y-3 text-sm">
      <label class="text-xs block">Text
        <textarea v-model="block.content" rows="3" class="pa-input w-full mt-1" @input="touch" />
      </label>

      <AppDropdown label="Font" :model-value="block.style.fontFamily" :options="fontOptions" @update:model-value="setFont" />

      <AppSlider label="Size" :min="8" :max="200" v-model="block.style.fontSize" unit="px" @update:model-value="touch" />

      <div class="flex gap-2">
        <button class="flex-1 py-1 rounded border text-sm font-bold"
                :class="block.style.fontWeight === 'bold' ? 'border-pebble-accent bg-pebble-accent/10' : 'border-pebble-border'"
                @click="toggleBold">B</button>
        <button class="flex-1 py-1 rounded border text-sm italic"
                :class="block.style.fontStyle === 'italic' ? 'border-pebble-accent bg-pebble-accent/10' : 'border-pebble-border'"
                @click="toggleItalic">I</button>
      </div>

      <div>
        <div class="text-xs text-pebble-text-dim mb-1">Alignment</div>
        <div class="flex rounded bg-pebble-bg p-0.5 text-2xs">
          <button v-for="a in alignOptions" :key="a.value" @click="setAlign(a.value)"
                  :class="['flex-1 py-1 rounded', block.style.align === a.value ? 'bg-pebble-accent text-white' : 'text-pebble-text-dim']">{{ a.label }}</button>
        </div>
      </div>

      <AppColorPicker label="Colour" v-model="block.style.color" @update:model-value="touch" />
      <AppSlider label="Bend" :min="-100" :max="100" :model-value="Math.round(block.style.curve ?? 0)"
                 @update:model-value="v => { block!.style.curve = v; touch(); }" />
      <p v-if="block.style.curve" class="text-2xs text-pebble-text-dim -mt-1">Positive arcs up (smile), negative arcs down; ±100 ≈ a full circle.</p>
      <AppSlider label="Letter spacing" :min="-5" :max="40" v-model="block.style.letterSpacing" @update:model-value="touch" />
      <AppSlider label="Line height" :min="80" :max="240" :model-value="Math.round(block.style.lineHeight*100)" unit="%" @update:model-value="v => { block!.style.lineHeight = v/100; touch(); }" />
      <AppSlider label="Rotation" :min="-180" :max="180" v-model="block.position.rotation" unit="°" @update:model-value="touch" />
      <AppSlider label="Opacity" :min="0" :max="100" :model-value="Math.round(block.style.opacity*100)" unit="%" @update:model-value="v => { block!.style.opacity = v/100; touch(); }" />

      <!-- Legibility kit (for text over busy photos) -->
      <div class="pt-2 border-t border-pebble-border space-y-2">
        <div class="text-2xs uppercase tracking-wider text-pebble-text-dim">Legibility</div>
        <label class="flex items-center justify-between text-xs"><span>Background plate</span>
          <input type="checkbox" :checked="!!block.style.background" @change="togglePlate(($event.target as HTMLInputElement).checked)" /></label>
        <AppColorPicker v-if="block.style.background" label="Plate colour" :model-value="block.style.background" @update:model-value="setPlate" />
        <label class="flex items-center justify-between text-xs"><span>Outline</span>
          <input type="checkbox" :checked="!!block.style.textStroke" @change="toggleOutline(($event.target as HTMLInputElement).checked)" /></label>
        <template v-if="block.style.textStroke">
          <AppSlider label="Outline width" :min="0" :max="12" :model-value="block.style.textStroke.width" unit="px" @update:model-value="v => setOutline('width', v)" />
          <AppColorPicker label="Outline colour" :model-value="block.style.textStroke.color" @update:model-value="v => setOutline('color', v)" />
        </template>
        <label class="flex items-center justify-between text-xs"><span>Drop shadow</span>
          <input type="checkbox" :checked="!!block.style.textShadow" @change="toggleTextShadow(($event.target as HTMLInputElement).checked)" /></label>
      </div>

      <AppButton size="sm" variant="ghost" block @click="remove">Delete text</AppButton>
    </div>
  </div>
</template>
