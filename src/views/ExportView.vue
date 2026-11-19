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
import AppIcon from '@/components/ui/AppIcon.vue';
import AppIconButton from '@/components/ui/AppIconButton.vue';

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
    <header class="pa-topbar">
      <AppIconButton icon="arrow-left" label="Back to the editor" @click="router.push('/editor')" />
      <h1 class="font-semibold">Export album</h1>
      <span v-if="project.meta?.name" class="text-pebble-text-dim truncate">{{ project.meta.name }} · {{ project.pages.length }} page{{ project.pages.length === 1 ? '' : 's' }}</span>
    </header>

    <main class="flex-1 overflow-auto">
      <div class="max-w-2xl mx-auto w-full px-8 py-8 space-y-7">
        <section class="space-y-3">
          <h2 class="pa-section">Format &amp; range</h2>
          <div class="grid grid-cols-2 gap-4">
            <AppDropdown label="Format" :model-value="req.format"
              :options="[{value:'pdf',label:'PDF (multi-page)'},{value:'jpeg',label:'JPEG sequence'},{value:'png',label:'PNG sequence'}]"
              @update:model-value="v => req.format = v as ExportFormat" />
            <AppDropdown label="Range" :model-value="req.range"
              :options="[{value:'all',label:'All pages'},{value:'current',label:'Current page'},{value:'custom',label:'Custom range'}]"
              @update:model-value="v => req.range = v as any" />
          </div>

          <div v-if="req.range === 'custom'" class="grid grid-cols-2 gap-4">
            <label class="block"><span class="pa-label">From page</span><input type="number" v-model.number="req.rangeStart" class="pa-input w-full mt-1 tabular-nums" /></label>
            <label class="block"><span class="pa-label">To page</span><input type="number" v-model.number="req.rangeEnd" class="pa-input w-full mt-1 tabular-nums" /></label>
          </div>

          <AppSlider v-if="req.format === 'jpeg'" label="JPEG quality" :min="50" :max="100" v-model="req.quality" unit="%" :reset-to="95" />
        </section>

        <section class="space-y-3">
          <h2 class="pa-section">Options</h2>
          <div class="flex flex-wrap gap-x-6 gap-y-2.5">
            <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" v-model="req.includeBleedMarks" /> Bleed marks</label>
            <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" v-model="req.includePageNumbers" /> Page numbers</label>
            <label class="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" v-model="req.openAfter" /> Open folder after export</label>
          </div>
        </section>

        <section class="space-y-3">
          <h2 class="pa-section">Destination</h2>
          <div>
            <div class="pa-label mb-1">Output folder</div>
            <div class="flex gap-2">
              <input v-model="req.outputDir" class="pa-input flex-1 min-w-0 h-8 !py-0 font-mono text-xs" spellcheck="false" aria-label="Output folder" />
              <AppButton variant="secondary" icon="folder" @click="pickDir">Browse…</AppButton>
            </div>
          </div>
        </section>

        <!-- Print checklist: a warning, not a blocker -->
        <section v-if="warnings.length" class="rounded-lg border border-pebble-warning/40 bg-pebble-warning/10 p-3.5 flex gap-3" role="note">
          <AppIcon name="alert" :size="18" class="text-pebble-warning mt-px" />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium">Print checklist — {{ warnings.length }} thing{{ warnings.length === 1 ? '' : 's' }} to check</div>
            <p class="text-xs text-pebble-text-dim mt-0.5">You can still export; these pages may not print sharply.</p>
            <ul class="text-xs text-pebble-text mt-2 max-h-32 overflow-auto space-y-1">
              <li v-for="(w, i) in warnings" :key="i"><span class="text-pebble-text-dim">Page {{ w.page }}</span> · {{ w.message }}</li>
            </ul>
          </div>
        </section>
      </div>
    </main>

    <footer class="px-4 h-14 shrink-0 bg-pebble-surface border-t border-pebble-border flex items-center gap-4">
      <AppButton variant="ghost" :disabled="busy" @click="router.push('/editor')">Cancel</AppButton>
      <div class="flex-1 max-w-md ml-auto"><AppProgress v-if="busy" :value="progress.pct" :label="progress.step || 'Exporting…'" /></div>
      <AppButton icon="upload" :disabled="busy" @click="doExport">{{ busy ? 'Exporting…' : 'Export' }}</AppButton>
    </footer>
  </div>
</template>
