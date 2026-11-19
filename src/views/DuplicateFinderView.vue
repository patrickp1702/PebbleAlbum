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
 *  • Per-set ⛶ full-screen compare overlay (Teleport; Esc to close).
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
    <header class="h-14 shrink-0 flex items-center gap-3 px-5 border-b border-pebble-border">
      <button class="h-8 px-3 rounded-lg text-sm text-pebble-text-dim hover:text-pebble-text hover:bg-pebble-hover" @click="router.push('/')">‹ Home</button>
      <div class="font-semibold">Duplicate Finder</div>
      <span v-if="analyzing" class="text-2xs text-pebble-accent-soft truncate max-w-[280px]">{{ progressLabel }}</span>
      <div class="flex-1"></div>
      <!-- view toggle -->
      <div v-if="records.length" class="flex rounded-lg bg-pebble-surface-2 p-0.5 text-xs">
        <button class="px-3 py-1 rounded-md" :class="view === 'grid' ? 'bg-pebble-accent text-white' : 'text-pebble-text-dim'" @click="setView('grid')">▦ Grid</button>
        <button class="px-3 py-1 rounded-md" :class="view === 'large' ? 'bg-pebble-accent text-white' : 'text-pebble-text-dim'" @click="setView('large')" title="Large side-by-side to spot the best">⛶ Compare</button>
      </div>
      <AppButton size="sm" :disabled="analyzing" @click="pickFolder">{{ folder ? 'Change folder…' : 'Pick folder…' }}</AppButton>
      <AppButton size="sm" variant="secondary" :disabled="!markedList.length || moving" @click="confirmMove = true">
        {{ moving ? 'Moving…' : `Move ${markedList.length} to /duplicate` }}
      </AppButton>
    </header>

    <!-- Live analysis progress -->
    <div v-if="analyzing" class="shrink-0 px-5 py-2.5 border-b border-pebble-border">
      <div class="flex justify-between text-2xs text-pebble-text-dim mb-1.5">
        <span>{{ progressLabel }}</span>
        <span v-if="progress?.total">{{ progressPct }}%</span>
      </div>
      <div class="h-1.5 rounded-full bg-pebble-surface-2 overflow-hidden">
        <div class="h-full bg-pebble-accent transition-all duration-200"
             :class="progress?.total ? '' : 'animate-pulse'"
             :style="{ width: (progress?.total ? progressPct : 20) + '%' }"></div>
      </div>
    </div>

    <!-- Controls: similarity strictness + collapse-all + counts -->
    <div v-if="records.length && !analyzing" class="shrink-0 px-5 py-2.5 border-b border-pebble-border flex items-center gap-x-5 gap-y-2 flex-wrap">
      <div class="flex items-center gap-2.5">
        <span class="text-2xs text-pebble-text-dim whitespace-nowrap">Match strictness</span>
        <span class="text-2xs text-pebble-text-dim">Loose</span>
        <div class="w-40"><AppSlider v-model="strictness" :min="1" :max="10" :step="1" /></div>
        <span class="text-2xs text-pebble-text-dim">Strict</span>
        <span class="text-2xs text-pebble-text-dim/70 italic">{{ strictness >= 8 ? 'near-identical only' : strictness <= 3 ? 'loosely similar' : 'similar' }}</span>
      </div>
      <span class="text-2xs text-pebble-text-dim">
        {{ groups.length }} set{{ groups.length === 1 ? '' : 's' }} · {{ blurry.length }} blurry · {{ otherPhotos.length }} unique
      </span>
      <div class="flex-1"></div>
      <button v-if="groups.length" class="text-2xs text-pebble-accent-soft hover:text-pebble-accent" @click="setAllCollapsed(!allCollapsed)">
        {{ allCollapsed ? 'Expand all sets' : 'Collapse all sets' }}
      </button>
    </div>

    <div class="flex-1 overflow-auto p-5 space-y-6">
      <div v-if="error" class="rounded-lg border border-pebble-danger/40 bg-pebble-danger/10 text-pebble-danger px-4 py-3 text-sm flex items-center justify-between">
        <span>{{ error }}</span>
        <button class="underline hover:text-pebble-danger" @click="analyze">Retry</button>
      </div>

      <div v-if="!folder" class="text-pebble-text-dim text-center mt-16">
        <div class="text-5xl mb-3">🔍</div>
        <p>Pick a folder to find duplicate & burst photos. Mark the ones you don't want, then move them to a <code>duplicate</code> subfolder.</p>
      </div>
      <div v-else-if="!analyzing && !groups.length && !ungrouped.length" class="text-pebble-text-dim">No photos found.</div>

      <!-- Duplicate groups -->
      <section v-if="groups.length">
        <div class="text-2xs font-semibold uppercase tracking-wider text-pebble-text-dim mb-3">Duplicate / similar sets ({{ groups.length }})</div>
        <div class="space-y-4">
          <div v-for="g in groups" :key="g.id" class="rounded-xl border border-pebble-border bg-pebble-surface/60 p-4">
            <div class="flex items-center justify-between mb-3 gap-3">
              <button class="flex items-center gap-2 min-w-0 text-left" @click="toggleCollapse(g.id)" :title="collapsed[g.id] ? 'Expand set' : 'Collapse set'">
                <span class="text-pebble-text-dim inline-block transition-transform" :class="collapsed[g.id] ? '-rotate-90' : ''">▾</span>
                <span class="text-xs text-pebble-text-dim truncate">
                  {{ g.members.length }} similar · ★ Best is kept<span v-if="markedInGroup(g)" class="text-pebble-danger"> · {{ markedInGroup(g) }} to move</span>
                </span>
              </button>
              <div class="flex items-center gap-3 text-2xs shrink-0">
                <button class="text-pebble-accent-soft hover:text-pebble-accent" @click="markOthers(g)">Mark all but best</button>
                <button class="text-pebble-text-dim hover:text-pebble-text" @click="clearGroup(g)">Clear</button>
                <button class="text-pebble-text-dim hover:text-pebble-text" title="View this set full screen to compare" @click="openFullscreen(g)">⛶ Full screen</button>
              </div>
            </div>
            <button v-if="collapsed[g.id]" class="text-2xs text-pebble-accent-soft hover:text-pebble-accent" @click="toggleCollapse(g.id)">Show {{ g.members.length }} photos…</button>
            <div v-else class="flex flex-wrap gap-3">
              <button v-for="m in g.members" :key="m" @click="toggle(m)"
                      class="relative rounded-xl overflow-hidden bg-pebble-surface-2 ring-2 transition text-left"
                      :class="[view === 'large' ? '' : 'w-44', marked[m] ? 'ring-pebble-danger' : 'ring-transparent hover:ring-pebble-accent/50']">
                <img v-if="view === 'large' ? bigSrc(m) : smallSrc(m)" :src="view === 'large' ? bigSrc(m) : smallSrc(m)"
                     class="object-contain bg-black/30" :class="view === 'large' ? 'max-h-[64vh] max-w-[44vw]' : 'w-44 h-32 object-cover'" />
                <div v-else class="bg-pebble-surface-2 animate-pulse" :class="view === 'large' ? 'w-80 h-56' : 'w-44 h-32'" />
                <span v-if="m === g.suggested" class="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-pebble-accent/90 text-white text-2xs font-semibold">★ Best</span>
                <span class="absolute top-2 right-2 px-2 py-0.5 rounded-full text-2xs font-semibold transition"
                      :class="marked[m] ? 'bg-pebble-danger text-white' : 'bg-black/50 text-white/80'">{{ marked[m] ? '✓ Move' : 'Keep' }}</span>
                <div class="px-2 py-1.5">
                  <div class="truncate text-2xs text-pebble-text-dim" :title="m">{{ fileOf(m) }}</div>
                  <div v-if="flags(m, g).length" class="flex flex-wrap gap-1 mt-1">
                    <span v-for="f in flags(m, g)" :key="f" class="px-1.5 rounded-full text-2xs bg-pebble-warning/20 text-pebble-warning capitalize">{{ f }}</span>
                  </div>
                </div>
              </button>
            </div>
          </div>
        </div>
      </section>

      <!-- Possibly blurry (ungrouped, sharpness well below the folder median) -->
      <section v-if="blurry.length">
        <div class="flex items-center gap-4 mb-3">
          <button class="flex items-center gap-2" @click="toggleCollapse('__blurry')">
            <span class="text-pebble-text-dim inline-block transition-transform" :class="collapsed['__blurry'] ? '-rotate-90' : ''">▾</span>
            <span class="text-2xs font-semibold uppercase tracking-wider text-pebble-warning/80">Possibly blurry ({{ blurry.length }})</span>
          </button>
          <button class="text-2xs text-pebble-accent-soft hover:text-pebble-accent" @click="blurry.forEach((r) => marked[r.relativePath] = true)">Mark all</button>
          <button class="text-2xs text-pebble-text-dim hover:text-pebble-text" @click="blurry.forEach((r) => marked[r.relativePath] = false)">Clear</button>
        </div>
        <div v-if="!collapsed['__blurry']" class="flex flex-wrap gap-3">
          <button v-for="r in blurry" :key="r.relativePath" @click="toggle(r.relativePath)"
                  class="relative w-40 rounded-xl overflow-hidden bg-pebble-surface-2 ring-2 transition text-left"
                  :class="marked[r.relativePath] ? 'ring-pebble-danger' : 'ring-transparent hover:ring-pebble-accent/50'">
            <img v-if="smallSrc(r.relativePath)" :src="smallSrc(r.relativePath)" class="w-40 h-28 object-cover" />
            <div v-else class="w-40 h-28 animate-pulse" />
            <span class="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-pebble-warning/80 text-white text-2xs font-semibold">blurry</span>
            <span class="absolute top-2 right-2 px-2 py-0.5 rounded-full text-2xs font-semibold"
                  :class="marked[r.relativePath] ? 'bg-pebble-danger text-white' : 'bg-black/50 text-white/80'">{{ marked[r.relativePath] ? '✓ Move' : 'Keep' }}</span>
            <div class="px-2 py-1.5"><div class="truncate text-2xs text-pebble-text-dim" :title="r.relativePath">{{ fileOf(r.relativePath) }}</div></div>
          </button>
        </div>
      </section>

      <!-- All other (unique, acceptably sharp) -->
      <section v-if="otherPhotos.length">
        <div class="text-2xs font-semibold uppercase tracking-wider text-pebble-text-dim mb-3">All other photos ({{ otherPhotos.length }})</div>
        <div class="grid gap-2.5 grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
          <div v-for="r in otherPhotos" :key="r.relativePath" class="aspect-square rounded-lg overflow-hidden bg-pebble-surface-2">
            <img v-if="smallSrc(r.relativePath)" :src="smallSrc(r.relativePath)" class="w-full h-full object-cover" />
            <div v-else class="w-full h-full animate-pulse" />
          </div>
        </div>
      </section>
    </div>

    <AppModal :open="confirmMove" title="Move to duplicate folder?" width="440px" @update:open="(v) => { if (!v) confirmMove = false; }">
      <p class="text-sm">Move <b>{{ markedList.length }}</b> photo{{ markedList.length === 1 ? '' : 's' }} into a <code>duplicate</code> subfolder of your chosen folder? Your originals aren't deleted — they're just moved there, so you can restore them anytime.</p>
      <template #footer>
        <AppButton variant="ghost" @click="confirmMove = false">Cancel</AppButton>
        <AppButton @click="doMove">Move</AppButton>
      </template>
    </AppModal>

    <!-- Per-set full-screen compare -->
    <Teleport to="body">
      <div v-if="fullscreenGroup" class="fixed inset-0 z-[200] bg-black/95 flex flex-col">
        <div class="h-14 shrink-0 flex items-center gap-3 px-5 border-b border-white/10 text-white">
          <div class="font-semibold">Compare set — {{ fullscreenGroup.members.length }} similar</div>
          <span class="text-2xs text-white/50 hidden sm:inline">Click a photo to mark it for moving · Esc to close</span>
          <div class="flex-1"></div>
          <button class="text-2xs text-pebble-accent-soft hover:text-white" @click="markOthers(fullscreenGroup)">Mark all but best</button>
          <button class="text-2xs text-white/60 hover:text-white" @click="clearGroup(fullscreenGroup)">Clear</button>
          <button class="h-8 px-3 rounded-lg text-sm text-white/80 hover:text-white hover:bg-pebble-hover" @click="closeFullscreen">✕ Close</button>
        </div>
        <div class="flex-1 overflow-auto p-5">
          <div class="flex flex-wrap gap-4 justify-center items-start">
            <button v-for="m in fullscreenGroup.members" :key="m" @click="toggle(m)"
                    class="relative rounded-xl overflow-hidden bg-pebble-surface-2 ring-2 transition"
                    :class="marked[m] ? 'ring-pebble-danger' : 'ring-transparent hover:ring-pebble-accent/60'">
              <img v-if="bigSrc(m)" :src="bigSrc(m)" class="object-contain bg-black max-h-[78vh] max-w-[88vw]" />
              <div v-else class="w-[40vw] h-[60vh] bg-pebble-surface-2 animate-pulse" />
              <span v-if="m === fullscreenGroup.suggested" class="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-pebble-accent/90 text-white text-xs font-semibold">★ Best</span>
              <span class="absolute top-3 right-3 px-2.5 py-1 rounded-full text-xs font-semibold"
                    :class="marked[m] ? 'bg-pebble-danger text-white' : 'bg-black/60 text-white/85'">{{ marked[m] ? '✓ Move' : 'Keep' }}</span>
              <div class="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/70 to-transparent px-3 py-2">
                <div class="truncate text-2xs text-white/85" :title="m">{{ fileOf(m) }}</div>
                <div v-if="flags(m, fullscreenGroup).length" class="flex flex-wrap gap-1 mt-1">
                  <span v-for="f in flags(m, fullscreenGroup)" :key="f" class="px-1.5 rounded-full text-2xs bg-pebble-warning/30 text-pebble-warning capitalize">{{ f }}</span>
                </div>
              </div>
            </button>
          </div>
        </div>
      </div>
    </Teleport>
  </div>
</template>
