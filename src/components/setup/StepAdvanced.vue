<script setup lang="ts">
/** Step 5 — advanced generation options mapped to meta + generator config. */
import { inject } from 'vue';
import type { WizardDraft } from '@/views/ProjectSetupView.vue';
import AppSlider from '@/components/ui/AppSlider.vue';
import AppDropdown from '@/components/ui/AppDropdown.vue';

const draft = inject<WizardDraft>('wizard')!;
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-5">
    <h2 class="text-2xl font-bold">Advanced options</h2>

    <div class="grid grid-cols-2 gap-5">
      <AppSlider label="Min images / page" :min="1" :max="6" v-model="draft.config.minImagesPerPage" />
      <AppSlider label="Max images / page" :min="1" :max="6" v-model="draft.config.maxImagesPerPage" />
      <AppSlider label="Layout variety" :min="0" :max="100" :model-value="Math.round(draft.config.variety*100)" unit="%"
        @update:model-value="v => draft.config.variety = v/100" />
      <AppSlider label="Gutter width" :min="0" :max="80" v-model="draft.meta.gutterWidth" unit="px" />
      <AppSlider label="Page margin" :min="0" :max="120" v-model="draft.meta.safeMargin" unit="px" />
      <AppSlider label="Bleed margin" :min="0" :max="40" v-model="draft.meta.bleedMargin" unit="px" />
    </div>

    <div class="grid grid-cols-2 gap-4">
      <AppDropdown label="Sort order" :model-value="draft.config.sortBy"
        :options="[{value:'filename',label:'Filename'},{value:'date',label:'Date taken'},{value:'manual',label:'Manual (ord- label)'}]"
        @update:model-value="v => draft.config.sortBy = v as any" />
      <AppDropdown label="Caption style" :model-value="draft.config.compose.captionStyle || 'none'"
        :options="[{value:'none',label:'None'},{value:'filename',label:'Filename'},{value:'exif',label:'EXIF date'}]"
        @update:model-value="v => draft.config.compose.captionStyle = v as any" />
      <AppDropdown label="Page turn style" :model-value="draft.meta.pageTurnStyle"
        :options="[{value:'curl',label:'Curl'},{value:'slide',label:'Slide'},{value:'fade',label:'Fade'},{value:'hard',label:'Hard page'}]"
        @update:model-value="v => draft.meta.pageTurnStyle = v as any" />
      <AppDropdown label="Page turn speed" :model-value="draft.meta.pageTurnSpeed"
        :options="[{value:'slow',label:'Slow'},{value:'normal',label:'Normal'},{value:'fast',label:'Fast'}]"
        @update:model-value="v => draft.meta.pageTurnSpeed = v as any" />
    </div>

    <div class="grid grid-cols-2 gap-3">
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" v-model="draft.config.compose.borderOnAll" class="accent-pebble-accent" /> Border on all images</label>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" v-model="draft.config.compose.shadowOnAll" class="accent-pebble-accent" /> Shadow on all images</label>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" v-model="draft.config.groupByDate" class="accent-pebble-accent" /> Auto-group by date</label>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" v-model="draft.config.sectionDividers" class="accent-pebble-accent" /> Section dividers</label>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" v-model="draft.config.backCover" class="accent-pebble-accent" /> Generate back cover</label>
      <label class="flex items-center gap-2 text-sm"><input type="checkbox" v-model="draft.config.randomLayouts" class="accent-pebble-accent" /> Randomise layouts</label>
    </div>
  </div>
</template>
