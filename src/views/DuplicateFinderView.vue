<script setup lang="ts">
/**
 * DuplicateFinderView.vue — standalone Duplicate Finder (no project, no memory:
 * fresh every time it opens). Pick a folder, see near-duplicate groups (best frame
 * highlighted), mark the unwanted ones, and "Move to duplicate folder" — files are
 * moved into a reversible `<folder>/duplicate`. After a move, sets that drop to a
 * single photo fall into "All other photos".
 *
 * Features:
 *  • Live analysis progress (scan → analyze, done/total + %) via `onAnalyzeProgress`,
 *    with an inline error/Retry panel.
 *  • Match-strictness slider — re-clusters INSTANTLY in the renderer through the pure
 *    `buildDuplicateGroups` (no re-analysis); higher = only near-identical frames.
 *  • Per-set full-screen compare overlay (Teleport; Esc to close).
 *  • Collapsible sets (per-group + Collapse/Expand all).
 *  • A "Possibly blurry" bucket: ungrouped photos far below the folder's median
 *    sharpness, markable for moving.
 *  • Grid ↔ Compare (large) toggle for in-card thumbnail size.
 */
import { ref, reactive, computed, onMounted, onUnmounted, watch } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '@/stores/appStore';
import type { ImageRecord, DuplicateGroup, PhotoQuality } from '@shared/pebble.types';
import { buildDuplicateGroups, type SimItem } from '@/engine/similarity';
import AppButton from '@/components/ui/AppButton.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSlider from '@/components/ui/AppSlider.vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import AppIconButton from '@/components/ui/AppIconButton.vue';
import AppSegmented from '@/components/ui/AppSegmented.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';

const router = useRouter();
const app = useAppStore();

const folder = ref('');
const analyzing = ref(false);
const moving = ref(false);
const error = ref('');
const progress = ref<{ phase: 'scan' | 'analyze' | 'done'; done: number; total: number } | null>(null);
const progressPct = computed(() => (progress.value && progress.value.total ? Math.round((progress.value.done / progress.value.total) * 100) : 0));
const progressLabel = computed(() => {
  const p = progress.value;
  if (!p) return 'Starting…';
  if (p.phase === 'scan') return p.total ? `Scanning folder… ${p.done} / ${p.total}` : 'Scanning folder…';
  if (p.phase === 'analyze') return `Analyzing photos… ${p.done} / ${p.total}` + (p.total ? ` · ${p.total - p.done} left` : '');
  return 'Finishing…';
});
const records = ref<ImageRecord[]>([]);
const marked = reactive<Record<string, boolean>>({});   // relativePaths to MOVE
const thumbs = reactive<Record<string, string>>({});
const bigThumbs = reactive<Record<string, string>>({});
const view = ref<'grid' | 'large'>('grid');
const VIEW_OPTIONS = [
  { value: 'grid', label: 'Grid', icon: 'grid' },
  { value: 'large', label: 'Compare', icon: 'compare', title: 'Large side-by-side to spot the best' },
] as const;
const confirmMove = ref(false);
const collapsed = reactive<Record<string, boolean>>({}); // group id → collapsed?
const fullscreenId = ref<string | null>(null);            // group shown full-screen

// ── Similarity strictness slider ───────────────────────────────────────────
// Higher strictness = only VERY close matches group together (tighter sets).
// Re-clustering is instant (pure engine), so no re-analysis is needed.
const strictness = ref(5);          // live slider value 1..10
const strictnessApplied = ref(5);   // debounced (re-cluster is O(n²))
let strTimer: ReturnType<typeof setTimeout> | null = null;
watch(strictness, (v) => {
  if (strTimer) clearTimeout(strTimer);
  strTimer = setTimeout(() => { strictnessApplied.value = v; }, 160);
});
const threshold = computed(() => Math.max(2, Math.min(16, Math.round(18 - strictnessApplied.value * 1.6))));

const recByPath = computed(() => { const m = new Map<string, ImageRecord>(); for (const r of records.value) m.set(r.relativePath, r); return m; });

// Groups recomputed from records + threshold — re-clusters live as the slider moves.
const groups = computed<DuplicateGroup[]>(() => {
  if (!records.value.length) return [];
  const items: SimItem[] = records.value.map((r) => ({ id: r.relativePath, phash: r.phash, aspect: r.height ? r.width / r.height : 1 }));
  const qById: Record<string, PhotoQuality | undefined> = {};
  for (const r of records.value) qById[r.relativePath] = r.quality;
  return buildDuplicateGroups(items, qById, threshold.value);
});
const groupedPaths = computed(() => new Set(groups.value.flatMap((g) => g.members)));
const ungrouped = computed(() => records.value.filter((r) => !groupedPaths.value.has(r.relativePath)));
const markedList = computed(() => Object.keys(marked).filter((k) => marked[k]));

// ── Blurry bucket: ungrouped photos whose sharpness is well below the folder median.
const sharpThreshold = computed(() => {
  const vals = records.value.map((r) => r.quality?.sharpness).filter((s): s is number => typeof s === 'number' && s > 0).sort((a, b) => a - b);
  if (vals.length < 4) return 0;                 // too little data to judge
  const median = vals[Math.floor(vals.length / 2)];
  return median * 0.5;
});
function isBlurry(r: ImageRecord): boolean {
  const s = r.quality?.sharpness; const t = sharpThreshold.value;
  return t > 0 && typeof s === 'number' && s < t;
}
const blurry = computed(() => ungrouped.value.filter(isBlurry));
const otherPhotos = computed(() => ungrouped.value.filter((r) => !isBlurry(r)));

const fullscreenGroup = computed(() => groups.value.find((g) => g.id === fullscreenId.value) ?? null);
function openFullscreen(g: DuplicateGroup) { fullscreenId.value = g.id; for (const m of g.members) ensureBig(m); }
function closeFullscreen() { fullscreenId.value = null; }
function toggleCollapse(id: string) { collapsed[id] = !collapsed[id]; }
function setAllCollapsed(v: boolean) { for (const g of groups.value) collapsed[g.id] = v; }
const allCollapsed = computed(() => groups.value.length > 0 && groups.value.every((g) => collapsed[g.id]));
function markedInGroup(g: DuplicateGroup): number { return g.members.filter((m) => marked[m]).length; }
function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && fullscreenId.value) closeFullscreen(); }

onMounted(() => {
  folder.value = ''; records.value = []; view.value = 'grid'; error.value = ''; progress.value = null; fullscreenId.value = null; // always fresh
  window.pebble.onAnalyzeProgress?.((p) => { progress.value = p; });
  window.addEventListener('keydown', onKey);
});
onUnmounted(() => { window.removeEventListener('keydown', onKey); });

async function pickFolder() {
  if (!window.pebble?.openFolderDialog) { app.toast('File bridge unavailable — restart the app.', 'error'); return; }
  const f = await window.pebble.openFolderDialog();
  if (!f) return;
  folder.value = f;
  await analyze();
}

async function analyze() {
  if (!folder.value) return;
  analyzing.value = true; error.value = ''; progress.value = null;
  for (const k of Object.keys(marked)) delete marked[k];
  try {
    const res = await window.pebble.analyzeFolder(folder.value);
    records.value = res.records;   // groups are recomputed reactively from records + threshold
    res.records.forEach(ensureThumb);
    if (view.value === 'large') loadBigForGroups();
    if (!res.records.length) error.value = 'No photos found in that folder.';
  } catch (e) {
    error.value = `Analysis failed: ${(e as Error).message}`;
    app.toast(error.value, 'error', 5000);
  } finally { analyzing.value = false; progress.value = null; }
}

function ensureThumb(r: ImageRecord) {
  if (!r.thumbnailPath || thumbs[r.relativePath]) return;
  window.pebble.readImageBase64(r.thumbnailPath).then((d) => { thumbs[r.relativePath] = d; }).catch(() => {});
}
function ensureBig(rel: string) {
  if (bigThumbs[rel]) return;
  const rec = recByPath.value.get(rel); if (!rec) return;
  window.pebble.generateThumbnail(rec.absolutePath, 1400)
    .then((p) => window.pebble.readImageBase64(p)).then((d) => { bigThumbs[rel] = d; }).catch(() => {});
}
function loadBigForGroups() { for (const g of groups.value) for (const m of g.members) ensureBig(m); }
function setView(v: 'grid' | 'large') { view.value = v; if (v === 'large') loadBigForGroups(); }

const smallSrc = (rel: string) => thumbs[rel] ?? '';
const bigSrc = (rel: string) => bigThumbs[rel] ?? thumbs[rel] ?? '';

function toggle(rel: string) { marked[rel] = !marked[rel]; }
function markOthers(g: DuplicateGroup) { for (const m of g.members) marked[m] = m !== g.suggested; }
function clearGroup(g: DuplicateGroup) { for (const m of g.members) marked[m] = false; }

function flags(rel: string, group?: DuplicateGroup): string[] {
  const q = recByPath.value.get(rel)?.quality; if (!q) return [];
  const out: string[] = [];
  const maxSharp = group ? Math.max(0, ...group.members.map((m) => recByPath.value.get(m)?.quality?.sharpness ?? 0)) : 0;
  if (maxSharp > 0 && q.sharpness < maxSharp * 0.6) out.push('blurry');
  if (q.clipOver > 0.08) out.push('bright');
  if (q.clipUnder > 0.12) out.push('dark');
  return out;
}
const fileOf = (rel: string) => rel.split('/').pop();

async function doMove() {
  confirmMove.value = false;
  const files = markedList.value;
  if (!files.length) return;
  moving.value = true;
  try {
    const res = await window.pebble.moveToDuplicates(folder.value, files);
    app.toast(`Moved ${res.movedCount} photo${res.movedCount === 1 ? '' : 's'} to /duplicate.`, 'success', 2500);
    await analyze(); // re-cluster: singletons now fall into "All other photos"
  } catch (e) { app.toast(`Move failed: ${(e as Error).message}`, 'error'); }
  finally { moving.value = false; }
}
</script>

<template>
  <div class="h-full w-full flex flex-col bg-pebble-bg">
    <header class="pa-topbar">
      <AppIconButton icon="home" label="Back to home" @click="router.push('/')" />
      <div class="font-semibold whitespace-nowrap">Duplicate Finder</div>
      <span v-if="analyzing" class="text-xs text-pebble-accent-soft truncate max-w-[280px]">{{ progressLabel }}</span>
      <span v-else-if="folder" class="text-xs text-pebble-text-dim font-mono truncate min-w-0" :title="folder">{{ folder }}</span>
      <span v-else class="text-xs text-pebble-text-dim truncate hidden md:inline">Group similar and burst photos, keep the best, move the rest aside.</span>
      <div class="flex-1"></div>
      <!-- view toggle -->
      <div v-if="records.length" class="w-48 shrink-0">
        <AppSegmented :model-value="view" :options="VIEW_OPTIONS" @update:model-value="setView" />
      </div>
      <AppButton v-if="folder" size="sm" variant="secondary" icon="folder" :disabled="analyzing" @click="pickFolder">Change folder…</AppButton>
    </header>

    <!-- Live analysis progress -->
    <div v-if="analyzing" class="shrink-0 px-4 py-2.5 bg-pebble-surface border-b border-pebble-border">
      <div class="flex justify-between text-xs text-pebble-text-dim mb-1.5">
        <span>{{ progressLabel }}</span>
        <span v-if="progress?.total" class="tabular-nums text-pebble-text">{{ progressPct }}%</span>
      </div>
      <div class="h-1.5 rounded-full bg-pebble-pressed overflow-hidden">
        <div class="h-full rounded-full bg-pebble-accent transition-[width] duration-200"
             :class="progress?.total ? '' : 'animate-pulse'"
             :style="{ width: (progress?.total ? progressPct : 20) + '%' }"></div>
      </div>
    </div>

    <!-- Controls: similarity strictness + collapse-all -->
    <div v-if="records.length && !analyzing" class="shrink-0 px-4 h-11 bg-pebble-surface border-b border-pebble-border flex items-center gap-x-5">
      <div class="flex items-center gap-2.5 min-w-0">
        <span class="pa-label whitespace-nowrap">Match strictness</span>
        <span class="text-2xs text-pebble-text-dim">Loose</span>
        <div class="w-40"><AppSlider v-model="strictness" :min="1" :max="10" :step="1" :reset-to="5" /></div>
        <span class="text-2xs text-pebble-text-dim">Strict</span>
        <span class="text-xs text-pebble-text whitespace-nowrap">{{ strictness >= 8 ? 'Near-identical only' : strictness <= 3 ? 'Loosely similar' : 'Similar' }}</span>
      </div>
      <div class="flex-1"></div>
      <button v-if="groups.length" type="button" class="pa-btn !h-7 shrink-0" @click="setAllCollapsed(!allCollapsed)">
        <AppIcon :name="allCollapsed ? 'chevron-down' : 'chevron-up'" :size="14" />
        {{ allCollapsed ? 'Expand all sets' : 'Collapse all sets' }}
      </button>
    </div>

    <div class="flex-1 overflow-auto p-5 space-y-7">
      <div v-if="error" class="rounded-lg border border-pebble-danger/40 bg-pebble-danger/10 px-4 py-3 text-sm flex items-center gap-3" role="alert">
        <AppIcon name="alert" :size="17" class="text-pebble-danger" />
        <span class="flex-1 min-w-0">{{ error }}</span>
        <AppButton size="sm" variant="secondary" icon="rotate-cw" @click="analyze">Retry</AppButton>
      </div>

      <!-- First run: one instruction, one action -->
      <AppEmptyState v-if="!folder" icon="images" title="Find duplicate and burst photos" class="mt-10"
                     text="Choose a folder. Similar photos are grouped with the best one suggested; mark the ones you don't want and move them to a “duplicate” subfolder.">
        <AppButton size="lg" icon="folder" :disabled="analyzing" @click="pickFolder">Choose folder…</AppButton>
        <template #hint>Nothing is deleted — moved photos can be dragged back anytime.</template>
      </AppEmptyState>
      <div v-else-if="!analyzing && !groups.length && !ungrouped.length && !error" class="text-sm text-pebble-text-dim text-center mt-16">No photos found.</div>

      <!-- Duplicate groups -->
      <section v-if="groups.length">
        <h2 class="pa-section mb-3">Duplicate / similar sets ({{ groups.length }})</h2>
        <div class="space-y-3">
          <div v-for="g in groups" :key="g.id" class="rounded-lg border border-pebble-border bg-pebble-surface">
            <div class="flex items-center justify-between gap-3 pl-2 pr-3 h-11">
              <button type="button" class="flex items-center gap-2 min-w-0 h-8 px-1.5 rounded-md text-left hover:bg-pebble-hover transition-colors"
                      :aria-expanded="!collapsed[g.id]" :title="collapsed[g.id] ? 'Expand set' : 'Collapse set'" @click="toggleCollapse(g.id)">
                <AppIcon name="chevron-down" :size="15" class="text-pebble-text-dim transition-transform" :class="collapsed[g.id] ? '-rotate-90' : ''" />
                <span class="text-sm font-medium truncate">{{ g.members.length }} similar photos</span>
                <span v-if="markedInGroup(g)" class="text-xs text-pebble-danger whitespace-nowrap">{{ markedInGroup(g) }} to move</span>
                <span v-else class="text-xs text-pebble-text-dim whitespace-nowrap">all kept</span>
              </button>
              <div class="flex items-center gap-1.5 shrink-0">
                <button type="button" class="pa-btn !h-7" title="Keep the suggested best photo and mark the rest to move" @click="markOthers(g)">Mark all but best</button>
                <button type="button" class="pa-btn !h-7" @click="clearGroup(g)">Clear</button>
                <AppIconButton size="sm" icon="maximize" label="Compare this set full screen" @click="openFullscreen(g)" />
              </div>
            </div>
            <div v-if="collapsed[g.id]" class="px-4 pb-3">
              <button type="button" class="text-xs text-pebble-accent-soft hover:underline" @click="toggleCollapse(g.id)">Show {{ g.members.length }} photos…</button>
            </div>
            <div v-else class="flex flex-wrap gap-3 px-4 pb-4">
              <button v-for="m in g.members" :key="m" type="button" :aria-pressed="!!marked[m]" @click="toggle(m)"
                      class="relative rounded-lg overflow-hidden bg-pebble-surface-2 ring-2 transition-shadow text-left"
                      :class="[view === 'large' ? '' : 'w-44', marked[m] ? 'ring-pebble-danger' : 'ring-transparent hover:ring-pebble-border-strong']">
                <img v-if="view === 'large' ? bigSrc(m) : smallSrc(m)" :src="view === 'large' ? bigSrc(m) : smallSrc(m)"
                     class="object-contain bg-black/30" :class="[view === 'large' ? 'max-h-[64vh] max-w-[44vw]' : 'w-44 h-32 object-cover', marked[m] ? 'opacity-60' : '']" />
                <div v-else class="bg-pebble-surface-2 animate-pulse" :class="view === 'large' ? 'w-80 h-56' : 'w-44 h-32'" />
                <span v-if="m === g.suggested" class="absolute top-2 left-2 inline-flex items-center gap-1 h-5 px-1.5 rounded bg-pebble-accent text-pebble-on-accent text-2xs font-semibold">
                  <AppIcon name="star" :size="11" :stroke="2.25" /> Best
                </span>
                <span class="absolute top-2 right-2 inline-flex items-center gap-1 h-5 px-1.5 rounded text-2xs font-semibold"
                      :class="marked[m] ? 'bg-pebble-danger-fill text-white' : 'bg-black/65 text-white'">
                  <AppIcon v-if="marked[m]" name="check" :size="11" :stroke="2.5" />{{ marked[m] ? 'Move' : 'Keep' }}
                </span>
                <div class="px-2 py-1.5">
                  <div class="truncate text-xs text-pebble-text-dim" :title="m">{{ fileOf(m) }}</div>
                  <div v-if="flags(m, g).length" class="flex flex-wrap gap-1 mt-1">
                    <span v-for="f in flags(m, g)" :key="f" class="px-1.5 py-px rounded text-2xs bg-pebble-warning/15 text-pebble-warning capitalize">{{ f }}</span>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Possibly blurry (ungrouped, sharpness well below the folder median) -->
      <section v-if="blurry.length">
        <div class="flex items-center gap-1.5 mb-3">
          <button type="button" class="flex items-center gap-2 h-8 px-1.5 -ml-1.5 rounded-md hover:bg-pebble-hover transition-colors"
                  :aria-expanded="!collapsed['__blurry']" @click="toggleCollapse('__blurry')">
            <AppIcon name="chevron-down" :size="15" class="text-pebble-text-dim transition-transform" :class="collapsed['__blurry'] ? '-rotate-90' : ''" />
            <span class="pa-section !text-pebble-warning">Possibly blurry ({{ blurry.length }})</span>
          </button>
          <button type="button" class="pa-btn !h-7 ml-2" @click="blurry.forEach((r) => marked[r.relativePath] = true)">Mark all</button>
          <button type="button" class="pa-btn !h-7" @click="blurry.forEach((r) => marked[r.relativePath] = false)">Clear</button>
        </div>
        <div v-if="!collapsed['__blurry']" class="flex flex-wrap gap-3">
          <button v-for="r in blurry" :key="r.relativePath" type="button" :aria-pressed="!!marked[r.relativePath]" @click="toggle(r.relativePath)"
                  class="relative w-40 rounded-lg overflow-hidden bg-pebble-surface-2 ring-2 transition-shadow text-left"
                  :class="marked[r.relativePath] ? 'ring-pebble-danger' : 'ring-transparent hover:ring-pebble-border-strong'">
            <img v-if="smallSrc(r.relativePath)" :src="smallSrc(r.relativePath)" class="w-40 h-28 object-cover" :class="marked[r.relativePath] ? 'opacity-60' : ''" />
            <div v-else class="w-40 h-28 animate-pulse" />
            <span class="absolute top-2 left-2 inline-flex items-center h-5 px-1.5 rounded bg-pebble-warning text-black text-2xs font-semibold">Blurry</span>
            <span class="absolute top-2 right-2 inline-flex items-center gap-1 h-5 px-1.5 rounded text-2xs font-semibold"
                  :class="marked[r.relativePath] ? 'bg-pebble-danger-fill text-white' : 'bg-black/65 text-white'">
              <AppIcon v-if="marked[r.relativePath]" name="check" :size="11" :stroke="2.5" />{{ marked[r.relativePath] ? 'Move' : 'Keep' }}
            </span>
            <div class="px-2 py-1.5"><div class="truncate text-xs text-pebble-text-dim" :title="r.relativePath">{{ fileOf(r.relativePath) }}</div></div>
          </button>
        </div>
      </section>

      <!-- All other (unique, acceptably sharp) -->
      <section v-if="otherPhotos.length">
        <h2 class="pa-section mb-3">All other photos ({{ otherPhotos.length }})</h2>
        <div class="grid gap-2 grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
          <div v-for="r in otherPhotos" :key="r.relativePath" class="aspect-square rounded-md overflow-hidden bg-pebble-surface-2">
            <img v-if="smallSrc(r.relativePath)" :src="smallSrc(r.relativePath)" class="w-full h-full object-cover" />
            <div v-else class="w-full h-full animate-pulse" />
          </div>
        </div>
      </section>
    </div>

    <!-- Action bar: what was found, how many are marked, and the ONE action -->
    <footer v-if="records.length" class="px-4 h-14 shrink-0 bg-pebble-surface border-t border-pebble-border flex items-center gap-4">
      <span class="text-xs text-pebble-text-dim truncate">
        {{ groups.length }} set{{ groups.length === 1 ? '' : 's' }} · {{ blurry.length }} blurry · {{ otherPhotos.length }} unique
      </span>
      <div class="flex-1"></div>
      <span class="text-sm whitespace-nowrap" :class="markedList.length ? 'text-pebble-text' : 'text-pebble-text-dim'">
        <b class="font-semibold tabular-nums">{{ markedList.length }}</b> marked to move
      </span>
      <AppButton :variant="markedList.length ? 'primary' : 'secondary'" icon="folder" :disabled="!markedList.length || moving"
                 :title="markedList.length ? 'Move the marked photos into a “duplicate” subfolder (reversible)' : 'Click photos to mark the ones you do not want'"
                 @click="confirmMove = true">
        {{ moving ? 'Moving…' : `Move ${markedList.length} to duplicate folder` }}
      </AppButton>
    </footer>

    <AppModal :open="confirmMove" title="Move to duplicate folder?" width="440px" @update:open="(v) => { if (!v) confirmMove = false; }">
      <p class="text-sm">Move <b>{{ markedList.length }}</b> photo{{ markedList.length === 1 ? '' : 's' }} into a <code class="font-mono text-xs px-1 py-0.5 rounded bg-pebble-surface-2">duplicate</code> subfolder of your chosen folder?</p>
      <p class="text-sm text-pebble-text-dim mt-2">Your originals aren't deleted — they're just moved there, so you can restore them anytime.</p>
      <template #footer>
        <AppButton variant="ghost" @click="confirmMove = false">Cancel</AppButton>
        <AppButton icon="folder" @click="doMove">Move {{ markedList.length }}</AppButton>
      </template>
    </AppModal>

    <!-- Per-set full-screen compare -->
    <Teleport to="body">
      <div v-if="fullscreenGroup" class="fixed inset-0 z-[200] bg-pebble-bg flex flex-col">
        <div class="pa-topbar">
          <div class="font-semibold whitespace-nowrap">Compare set — {{ fullscreenGroup.members.length }} similar</div>
          <span class="text-xs text-pebble-text-dim hidden sm:inline truncate">Click a photo to mark it for moving</span>
          <div class="flex-1"></div>
          <span v-if="markedInGroup(fullscreenGroup)" class="text-xs text-pebble-danger whitespace-nowrap">{{ markedInGroup(fullscreenGroup) }} to move</span>
          <button type="button" class="pa-btn !h-7" @click="markOthers(fullscreenGroup)">Mark all but best</button>
          <button type="button" class="pa-btn !h-7" @click="clearGroup(fullscreenGroup)">Clear</button>
          <AppIconButton icon="x" label="Close" shortcut="Esc" @click="closeFullscreen" />
        </div>
        <div class="flex-1 overflow-auto p-5">
          <div class="flex flex-wrap gap-4 justify-center items-start">
            <button v-for="m in fullscreenGroup.members" :key="m" type="button" :aria-pressed="!!marked[m]" @click="toggle(m)"
                    class="relative rounded-lg overflow-hidden bg-pebble-surface-2 ring-2 transition-shadow text-left"
                    :class="marked[m] ? 'ring-pebble-danger' : 'ring-transparent hover:ring-pebble-border-strong'">
              <img v-if="bigSrc(m)" :src="bigSrc(m)" class="block object-contain bg-black max-h-[72vh] max-w-[88vw]" :class="marked[m] ? 'opacity-60' : ''" />
              <div v-else class="w-[40vw] h-[60vh] bg-pebble-surface-2 animate-pulse" />
              <span v-if="m === fullscreenGroup.suggested" class="absolute top-3 left-3 inline-flex items-center gap-1 h-6 px-2 rounded bg-pebble-accent text-pebble-on-accent text-xs font-semibold">
                <AppIcon name="star" :size="12" :stroke="2.25" /> Best
              </span>
              <span class="absolute top-3 right-3 inline-flex items-center gap-1 h-6 px-2 rounded text-xs font-semibold"
                    :class="marked[m] ? 'bg-pebble-danger-fill text-white' : 'bg-black/65 text-white'">
                <AppIcon v-if="marked[m]" name="check" :size="12" :stroke="2.5" />{{ marked[m] ? 'Move' : 'Keep' }}
              </span>
              <!-- Caption on a solid strip (legible over any photo) -->
              <div class="px-3 py-2 bg-pebble-surface-2">
                <div class="truncate text-xs text-pebble-text" :title="m">{{ fileOf(m) }}</div>
                <div v-if="flags(m, fullscreenGroup).length" class="flex flex-wrap gap-1 mt-1">
                  <span v-for="f in flags(m, fullscreenGroup)" :key="f" class="px-1.5 py-px rounded text-2xs bg-pebble-warning/15 text-pebble-warning capitalize">{{ f }}</span>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
