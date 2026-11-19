<script setup lang="ts">
/**
 * LayoutPicker.vue — Bottom panel grid of layout templates. Applying a layout
 * re-maps the current page's images into the new slots (keeps image content,
 * updates positions). Shows a tiny slot diagram per template.
 */
import { useProjectStore } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { LAYOUTS } from '@/engine/layoutSelector';
import { coverBox } from '@/engine/collageComposer';

const project = useProjectStore();
const editor = useEditorStore();

/** Re-map the current page's images into a new layout, cover-fitting each. */
function applyLayout(layoutId: string) {
  const page = project.pages[editor.activePageIndex];
  const layout = LAYOUTS.find((l) => l.id === layoutId);
  if (!page || !layout || !project.meta) return;
  const m = project.meta;
  page.layoutId = layoutId;
  // Slot images map to layout slots in order; free images are left untouched.
  const slotImages = page.images.filter((i) => !i.free);
  slotImages.forEach((img, i) => {
    const slot = layout.slots[i];
    if (!slot) { img.visible = false; return; }
    img.visible = true;
    img.slotId = slot.id;
    const rec = project.images.find((r) => r.relativePath === img.filename);
    const frame = { x: slot.x * m.albumWidth, y: slot.y * m.albumHeight, width: slot.w * m.albumWidth, height: slot.h * m.albumHeight };
    const box = coverBox(frame, rec?.width ?? frame.width, rec?.height ?? frame.height);
    img.position.x = box.x; img.position.y = box.y;
    img.position.width = box.width; img.position.height = box.height;
    img.position.rotation = slot.rotation ?? 0;
    img.slotRect = slot.rotation ? undefined : frame;
    img.zIndex = slot.zIndex ?? i;
  });
  project.markDirty();
  editor.requestRender();
}
</script>

<template>
  <div class="grid grid-cols-3 gap-2 p-3 overflow-auto">
    <button v-for="l in LAYOUTS" :key="l.id" @click="applyLayout(l.id)"
            :class="['rounded border p-2 text-left transition',
                     project.pages[editor.activePageIndex]?.layoutId === l.id ? 'border-pebble-accent' : 'border-pebble-border hover:border-pebble-accent/50']">
      <div class="relative aspect-[3/2] bg-pebble-bg rounded mb-1">
        <div v-for="s in l.slots" :key="s.id" class="absolute bg-pebble-accent/40 rounded-[1px]"
             :style="{ left: `${s.x*100}%`, top: `${s.y*100}%`, width: `${s.w*100}%`, height: `${s.h*100}%` }" />
      </div>
      <div class="text-2xs truncate">{{ l.name }}</div>
    </button>
  </div>
</template>
