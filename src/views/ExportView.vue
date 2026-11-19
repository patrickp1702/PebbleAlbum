<script setup lang="ts">
/**
 * ExportView.vue — Export configuration + progress. Renders each page at full
 * DPI via the shared page renderer and dispatches to PDF / JPEG / PNG over IPC.
 * Runs the pre-export print checklist (low-res + missing image warnings).
 */
import { ref, reactive, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useProjectStore } from '@/stores/projectStore';
import { useAppStore } from '@/stores/appStore';
import { renderPageStatic } from '@/engine/pageRenderer';
import { runExport, runPrintChecklist, ExportRequest, ExportFormat } from '@/engine/exportEngine';
import AppButton from '@/components/ui/AppButton.vue';
import AppDropdown from '@/components/ui/AppDropdown.vue';
import AppSlider from '@/components/ui/AppSlider.vue';
import AppProgress from '@/components/ui/AppProgress.vue';

const router = useRouter();
const project = useProjectStore();
const app = useAppStore();

const req = reactive<ExportRequest>({
  format: 'pdf', quality: 95, includeBleedMarks: false, includePageNumbers: false,
  range: 'all', rangeStart: 1, rangeEnd: project.pages.length, outputDir: '', openAfter: true,
});
const busy = ref(false);
const progress = reactive({ pct: 0, step: '' });

const warnings = computed(() => {
  if (!project.project) return [];
  return runPrintChecklist(project.project, project.images.map((r) => ({ filename: r.relativePath, width: r.width, height: r.height })));
});

onMounted(async () => {
  const base = await window.pebble.getPebbleFolderPath();
  req.outputDir = base.replace(/projects$/, `exports/${project.meta?.name ?? 'Album'}`);
  window.pebble.onExportProgress((pct, step) => { progress.pct = pct; progress.step = step; });
});

async function pickDir() {
  const dir = await window.pebble.openFolderDialog();
  if (dir) req.outputDir = dir;
}

async function doExport() {
  if (!project.project) return;
  busy.value = true;
  try {
    const result = await runExport(
      project.project, req, 0,
      (page, dpi) => renderPageStatic(page, project.meta!, project.theme!,
        (f) => window.pebble.readImageBase64(`${project.meta!.sourceFolder}/${f}`),
        dpi / 96),
      (pct, step) => { progress.pct = pct; progress.step = step; },
    );
    app.toast('Export complete.', 'success');
    if (req.openAfter) await window.pebble.revealInExplorer(Array.isArray(result) ? result[0] : result);
  } catch (e) {
    app.toast('Export failed.', 'error');
  } finally { busy.value = false; }
}
</script>

<template>
  <div class="h-full flex flex-col bg-pebble-bg">
    <header class="flex items-center gap-2 px-6 py-4 border-b border-pebble-border">
      <button class="text-pebble-text-dim hover:text-pebble-text" @click="router.push('/editor')">←</button>
      <h1 class="text-lg font-semibold">Export album</h1>
    </header>

    <main class="flex-1 overflow-auto p-8 max-w-2xl mx-auto w-full space-y-5">
      <div class="grid grid-cols-2 gap-4">
        <AppDropdown label="Format" :model-value="req.format"
          :options="[{value:'pdf',label:'PDF (multi-page)'},{value:'jpeg',label:'JPEG sequence'},{value:'png',label:'PNG sequence'}]"
          @update:model-value="v => req.format = v as ExportFormat" />
        <AppDropdown label="Range" :model-value="req.range"
          :options="[{value:'all',label:'All pages'},{value:'current',label:'Current page'},{value:'custom',label:'Custom range'}]"
          @update:model-value="v => req.range = v as any" />
      </div>

      <div v-if="req.range === 'custom'" class="grid grid-cols-2 gap-4">
        <label class="text-xs">From<input type="number" v-model.number="req.rangeStart" class="pa-input w-full py-1 mt-1" /></label>
        <label class="text-xs">To<input type="number" v-model.number="req.rangeEnd" class="pa-input w-full py-1 mt-1" /></label>
      </div>

      <AppSlider v-if="req.format === 'jpeg'" label="JPEG quality" :min="50" :max="100" v-model="req.quality" unit="%" />

      <div class="flex gap-4">
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" v-model="req.includeBleedMarks" class="accent-pebble-accent" /> Bleed marks</label>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" v-model="req.includePageNumbers" class="accent-pebble-accent" /> Page numbers</label>
        <label class="flex items-center gap-2 text-sm"><input type="checkbox" v-model="req.openAfter" class="accent-pebble-accent" /> Open folder after</label>
      </div>

      <div>
        <div class="text-xs text-pebble-text-dim mb-1">Output folder</div>
        <div class="flex gap-2">
          <input v-model="req.outputDir" class="pa-input flex-1 font-mono text-xs" />
          <AppButton variant="secondary" size="sm" @click="pickDir">Browse…</AppButton>
        </div>
      </div>

      <div v-if="warnings.length" class="pa-panel p-3 border-l-4 border-amber-500/60">
        <div class="text-amber-300 text-sm font-medium mb-1">⚠ Print checklist ({{ warnings.length }})</div>
        <ul class="text-xs text-pebble-text-dim max-h-32 overflow-auto space-y-0.5">
          <li v-for="(w, i) in warnings" :key="i">Page {{ w.page }}: {{ w.message }}</li>
        </ul>
      </div>

      <div v-if="busy"><AppProgress :value="progress.pct" :label="progress.step" /></div>
    </main>

    <footer class="px-6 py-4 border-t border-pebble-border flex justify-end">
      <AppButton :disabled="busy" @click="doExport">{{ busy ? 'Exporting…' : 'Export now' }}</AppButton>
    </footer>
  </div>
</template>
