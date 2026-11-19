<script setup lang="ts">
/** Step 5 — advanced generation options mapped to meta + generator config. */
import { inject } from 'vue';
import type { WizardDraft } from '@/views/ProjectSetupView.vue';
import AppSlider from '@/components/ui/AppSlider.vue';
import AppDropdown from '@/components/ui/AppDropdown.vue';

const draft = inject<WizardDraft>('wizard')!;
</script>

<template>
  <div class="max-w-2xl mx-auto space-y-7">
    <div>
      <h2 class="text-xl font-semibold">Advanced options</h2>
      <p class="text-sm text-pebble-text-dim mt-1">Optional. The defaults suit most albums — everything here can be changed later in the editor.</p>
    </div>

    <section class="space-y-3">
      <h3 class="pa-section">Pages &amp; spacing</h3>
      <div class="grid grid-cols-2 gap-x-6 gap-y-4">
        <AppSlider label="Min images / page" :min="1" :max="6" v-model="draft.config.minImagesPerPage" />
        <AppSlider label="Max images / page" :min="1" :max="6" v-model="draft.config.maxImagesPerPage" />
        <AppSlider label="Layout variety" :min="0" :max="100" :model-value="Math.round(draft.config.variety*100)" unit="%"
          @update:model-value="v => draft.config.variety = v/100" />
        <AppSlider label="Gutter width" :min="0" :max="80" v-model="draft.meta.gutterWidth" unit="px" />
        <AppSlider label="Page margin" :min="0" :max="120" v-model="draft.meta.safeMargin" unit="px" />
        <AppSlider label="Bleed margin" :min="0" :max="40" v-model="draft.meta.bleedMargin" unit="px" />
      </div>
    </section>

    <section class="space-y-3">
      <h3 class="pa-section">Order, captions &amp; page turn</h3>
      <div class="grid grid-cols-2 gap-x-6 gap-y-4">
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
    </section>

    <section class="space-y-3">
      <h3 class="pa-section">Generation</h3>
      <div class="grid grid-cols-2 gap-x-6 gap-y-2.5">
        <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" v-model="draft.config.compose.borderOnAll" /> Border on all images</label>
        <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" v-model="draft.config.compose.shadowOnAll" /> Shadow on all images</label>
        <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" v-model="draft.config.groupByDate" /> Auto-group by date</label>
        <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" v-model="draft.config.sectionDividers" /> Section dividers</label>
        <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" v-model="draft.config.backCover" /> Generate back cover</label>
        <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" v-model="draft.config.randomLayouts" /> Randomise layouts</label>
      </div>
    </section>
  </div>
</template>
