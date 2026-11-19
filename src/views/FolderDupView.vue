<script setup lang="ts">
/**
 * FolderDupView.vue — "Duplicate Folder Finder" standalone quick tool.
 *
 * Pick one or many root folders (even whole disks). The main-process engine
 * scans once and returns EVERY candidate folder pair (sim ≥ 30%) + duplicate
 * file groups. This view does the rest purely client-side so it stays instant:
 *   • the similarity slider re-filters without any rescan,
 *   • parent-suppression hides pairs/files already covered by a shown outer
 *     duplicate folder,
 *   • scope badges distinguish within-root vs across-root duplicates.
 * Click any path to reveal it in Finder; Sync re-scans incrementally.
 */
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '@/stores/appStore';
import AppButton from '@/components/ui/AppButton.vue';
import AppSlider from '@/components/ui/AppSlider.vue';
import VirtualList from '@/components/ui/VirtualList.vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import AppIconButton from '@/components/ui/AppIconButton.vue';
import AppSegmented from '@/components/ui/AppSegmented.vue';
import AppTabs from '@/components/ui/AppTabs.vue';
import type { DupReport, DupFolderInfo, DupMatchBy, DupProgress } from '@shared/ipc.types';

const router = useRouter();
const app = useAppStore();

const roots = ref<string[]>([]);
const matchBy = ref<DupMatchBy>('name_date');
const skipSystemDirs = ref(true);
const busy = ref(false);
const progress = ref<DupProgress | null>(null);
const report = ref<DupReport | null>(null);

// Result controls (all client-side — no rescan).
const threshold = ref(70);
const scopeFilter = ref<'all' | 'within' | 'across'>('all');
const search = ref('');
const minFiles = ref(0);
const tab = ref<'folders' | 'files'>('folders');

const MATCH_OPTS: { v: DupMatchBy; label: string }[] = [
  { v: 'name_date', label: 'Name + date' },
  { v: 'name', label: 'Name only' },
  { v: 'name_size', label: 'Name + size' },
  { v: 'name_date_size', label: 'Name + date + size' },
];
// Presentation-only option lists for the segmented controls / tab bar.
const MATCH_SEG = MATCH_OPTS.map((o) => ({ value: o.v, label: o.label }));
const SCOPE_SEG = [
  { value: 'all', label: 'All' },
  { value: 'within', label: 'Within', title: 'Duplicates inside one selected folder' },
  { value: 'across', label: 'Across', title: 'Duplicates between different selected folders' },
] as const;

// ── Folder table helpers (id → info, ancestor walks for suppression) ─────────
const folderMap = computed(() => {
  const m = new Map<number, DupFolderInfo>();
  for (const f of report.value?.folders ?? []) m.set(f.id, f);
  return m;
});
function depthOf(id: number): number {
  const m = folderMap.value; let d = 0; let cur = m.get(id)?.parent ?? -1;
  while (cur >= 0) { d += 1; cur = m.get(cur)?.parent ?? -1; }
  return d;
}
/** true if `anc` is `node` or an ancestor of it (within the folder table). */
function isAncOrEq(anc: number, node: number): boolean {
  const m = folderMap.value; let cur = node;
  while (cur >= 0) { if (cur === anc) return true; cur = m.get(cur)?.parent ?? -1; }
  return false;
}
const baseName = (p: string) => p.split('/').filter(Boolean).pop() || p;
const rootLabel = (i: number) => baseName(report.value?.roots[i] ?? `root ${i}`);
// Distinct hue per root for the little colour chips.
const ROOT_HUES = ['#2B66F6', '#22c55e', '#f59e0b', '#ec4899', '#06b6d4', '#a855f7', '#ef4444', '#14b8a6'];

// ── Duplicate FOLDER rows: threshold filter → outermost-only suppression ─────
interface FolderRow { a: DupFolderInfo; b: DupFolderInfo; sim: number; recShared: number; scope: 'within' | 'across' }
const shownPairs = computed<FolderRow[]>(() => {
  const rep = report.value; if (!rep) return [];
  const th = threshold.value / 100;
  const q = search.value.trim().toLowerCase();
  // Candidates meeting ALL active filters, shallowest first (so the outer pair
  // wins and suppresses its children). Applying search/minFiles here (not after
  // suppression) means a filtered-out pair never hides a match.
  const cand = rep.pairs
    .filter((p) => {
      if (p.sim < th) return false;
      if (scopeFilter.value !== 'all' && p.scope !== scopeFilter.value) return false;
      const fa = folderMap.value.get(p.a); const fb = folderMap.value.get(p.b);
      if (!fa || !fb) return false;
      if (minFiles.value && Math.min(fa.recFiles, fb.recFiles) < minFiles.value) return false;
      if (q && !fa.path.toLowerCase().includes(q) && !fb.path.toLowerCase().includes(q)) return false;
      return true;
    })
    .map((p) => ({ p, d: Math.min(depthOf(p.a), depthOf(p.b)) }))
    .sort((x, y) => x.d - y.d || y.p.sim - x.p.sim);
  const accepted: { a: number; b: number }[] = [];
  const rows: FolderRow[] = [];
  for (const { p } of cand) {
    // Suppress if an already-accepted (outer) pair covers both endpoints.
    const covered = accepted.some((qq) =>
      (isAncOrEq(qq.a, p.a) && isAncOrEq(qq.b, p.b)) || (isAncOrEq(qq.a, p.b) && isAncOrEq(qq.b, p.a)));
    if (covered) continue;
    accepted.push({ a: p.a, b: p.b });
    const fa = folderMap.value.get(p.a)!; const fb = folderMap.value.get(p.b)!;
    // Show the more-contained (smaller) folder first — that's the deletion candidate.
    const [small, big] = fa.recFiles <= fb.recFiles ? [fa, fb] : [fb, fa];
    rows.push({ a: small, b: big, sim: p.sim, recShared: p.recShared, scope: p.scope });
  }
  return rows.sort((x, y) => y.sim - x.sim);
});

// Folder ids whose subtree is already represented by a shown duplicate folder,
// used to suppress redundant duplicate-file rows. Only the SMALLER/contained
// side (row.a — the deletion candidate) counts: the larger "also in" reference
// may be a whole drive with its own unrelated duplicates that should still show.
// A shared file's other copy (on the reference side) then drops to a single
// visible occurrence and its group disappears on its own — so no noise remains.
const shownFolderIds = computed(() => {
  const s = new Set<number>();
  for (const r of shownPairs.value) s.add(r.a.id);
  return s;
});
function underShownFolder(id: number): boolean {
  const m = folderMap.value; let cur = id;
  while (cur >= 0) { if (shownFolderIds.value.has(cur)) return true; cur = m.get(cur)?.parent ?? -1; }
  return false;
}

// ── Duplicate FILE rows: hide occurrences inside a shown duplicate folder ─────
interface FileRow { name: string; size: number; scope: 'within' | 'across'; locs: DupFolderInfo[]; total: number }
const shownFiles = computed<FileRow[]>(() => {
  const rep = report.value; if (!rep) return [];
  const q = search.value.trim().toLowerCase();
  const rows: FileRow[] = [];
  for (const g of rep.fileGroups) {
    if (scopeFilter.value !== 'all' && g.scope !== scopeFilter.value) continue;
    if (q && !g.name.toLowerCase().includes(q)) continue;
    const locs = g.locs.map((id) => folderMap.value.get(id)).filter((f): f is DupFolderInfo => !!f)
      .filter((f) => !underShownFolder(f.id));
    if (locs.length < 2) continue; // fully covered by shown folders, or nothing left
    rows.push({ name: g.name, size: g.size, scope: g.scope, locs, total: g.total });
  }
  return rows;
});

const RESULT_TABS = computed(() => [
  { id: 'folders' as const, label: `Duplicate folders (${shownPairs.value.length})`, icon: 'folders' as const },
  { id: 'files' as const, label: `Duplicate files (${shownFiles.value.length})`, icon: 'page' as const },
]);

const stats = computed(() => report.value?.stats);
const reusePct = computed(() => {
  const s = report.value?.stats; if (!s || !s.dirs) return 0;
  return Math.round((s.reusedDirs / s.dirs) * 100);
});

function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1073741824) return `${(n / 1048576).toFixed(1)} MB`;
  return `${(n / 1073741824).toFixed(2)} GB`;
}

// ── Actions ──────────────────────────────────────────────────────────────────
async function addRoot() {
  const f = await window.pebble.openFolderDialog();
  if (f && !roots.value.includes(f)) roots.value.push(f);
}
function removeRoot(i: number) { roots.value.splice(i, 1); }

async function analyze() {
  if (!roots.value.length || busy.value) return;
  busy.value = true; progress.value = { phase: 'scan', dirs: 0, files: 0, reusedDirs: 0 };
  try {
    report.value = await window.pebble.dupScan([...roots.value], { matchBy: matchBy.value, skipSystemDirs: skipSystemDirs.value });
  } catch (e) { app.toast(`Scan failed: ${(e as Error).message}`, 'error', 6000); }
  finally { busy.value = false; progress.value = null; }
}
async function sync() {
  if (busy.value || !report.value) return;
  busy.value = true; progress.value = { phase: 'scan', dirs: 0, files: 0, reusedDirs: 0 };
  try {
    report.value = await window.pebble.dupSync();
    app.toast(`Synced — reused ${reusePct.value}% of the previous scan.`, 'success', 3500);
  } catch (e) { app.toast(`Sync failed: ${(e as Error).message}`, 'error', 6000); }
  finally { busy.value = false; progress.value = null; }
}
async function changeMatchBy(v: DupMatchBy) {
  matchBy.value = v;
  if (!report.value) return;
  busy.value = true;
  try { report.value = await window.pebble.dupSetMatchBy(v); }
  finally { busy.value = false; }
}
/** Open a folder in Finder (goes INTO it so the user can act). */
async function openFolder(p: string) {
  try {
    const err = await window.pebble.openPath(p);
    if (err) app.toast(`Couldn't open: ${err}`, 'error', 5000);
  } catch { app.toast('Could not open the folder.', 'error'); }
}
/** Reveal a specific file selected inside its folder. */
function revealFile(folderPath: string, name: string) {
  window.pebble.revealInExplorer(`${folderPath}/${name}`).catch(() => {});
}

function onKey(e: KeyboardEvent) { if (e.key === 'Escape' && !busy.value) router.push('/'); }
onMounted(() => {
  window.pebble.onDupProgress?.((p) => { progress.value = p; });
  window.addEventListener('keydown', onKey);
  // Dev-only automation hook (tree-shaken from production builds): lets the
  // test harness seed roots since the native folder dialog can't be stubbed.
  if (import.meta.env.DEV) {
    (window as unknown as { __dupSeedRoots?: (r: string[]) => void }).__dupSeedRoots = (r) => { roots.value = r; };
  }
});
onBeforeUnmount(() => window.removeEventListener('keydown', onKey));
</script>

<template>
  <div class="h-full w-full flex flex-col bg-pebble-bg text-pebble-text">
    <!-- Header -->
    <header class="pa-topbar">
      <AppIconButton icon="home" label="Back to home" shortcut="Esc" @click="router.push('/')" />
      <div class="font-semibold whitespace-nowrap">Duplicate Folder Finder</div>
      <div class="text-xs text-pebble-text-dim truncate min-w-0 hidden md:block">Find folders &amp; files duplicated within or across your selected drives — by name{{ matchBy.includes('date') ? ' + date' : '' }}.</div>
      <div class="flex-1" />
      <AppButton v-if="report" size="sm" variant="ghost" icon="plus" :disabled="busy" title="Back to the folder list to start a different scan" @click="report = null">New scan</AppButton>
      <AppButton v-if="report" size="sm" variant="secondary" icon="rotate-cw" :disabled="busy" title="Re-scan, reusing everything that has not changed" @click="sync">Sync</AppButton>
    </header>

    <!-- Setup (no report yet) -->
    <div v-if="!report && !busy" class="flex-1 overflow-auto px-6 py-8">
      <div class="max-w-2xl mx-auto space-y-7">
        <div>
          <h1 class="text-xl font-semibold">Find duplicate folders</h1>
          <p class="text-sm text-pebble-text-dim mt-1">Nothing is changed or deleted — you get a list, and each result opens in your file manager.</p>
        </div>

        <section class="space-y-3">
          <h2 class="pa-section">1 · Folders to compare</h2>
          <p class="text-xs text-pebble-text-dim">Add one folder to find duplicates inside it, or several (even from different disks) to also find duplicates across them.</p>
          <div v-if="roots.length" class="pa-panel divide-y divide-pebble-border">
            <div v-for="(r, i) in roots" :key="r" class="flex items-center gap-2.5 pl-3 pr-1.5 h-10">
              <span class="h-2.5 w-2.5 rounded-full shrink-0" :style="{ background: ROOT_HUES[i % ROOT_HUES.length] }" />
              <span class="text-sm font-mono truncate flex-1" :title="r">{{ r }}</span>
              <AppIconButton size="sm" icon="x" label="Remove this folder" @click="removeRoot(i)" />
            </div>
          </div>
          <AppButton :variant="roots.length ? 'secondary' : 'primary'" icon="plus" @click="addRoot">Add folder…</AppButton>
        </section>

        <section class="space-y-3">
          <h2 class="pa-section">2 · Match files by</h2>
          <AppSegmented v-model="matchBy" :options="MATCH_SEG" />
          <label class="flex items-center gap-2 text-sm cursor-pointer pt-1">
            <input type="checkbox" v-model="skipSystemDirs" />
            <span>Skip system &amp; dev folders (.git, node_modules, .Trash, …) and junk files</span>
          </label>
        </section>

        <div class="pt-1 border-t border-pebble-border">
          <AppButton size="lg" icon="search" class="mt-5" :variant="roots.length ? 'primary' : 'secondary'" :disabled="!roots.length"
                     :title="roots.length ? undefined : 'Add at least one folder first'" @click="analyze">Find duplicates</AppButton>
        </div>
      </div>
    </div>

    <!-- Progress -->
    <div v-if="busy" class="flex-1 flex flex-col items-center justify-center gap-3 px-6" role="status">
      <div class="h-12 w-12 rounded-xl bg-pebble-surface-2 border border-pebble-border grid place-items-center text-pebble-accent-soft animate-pulse">
        <AppIcon :name="progress?.phase === 'analyze' ? 'sliders' : 'folders'" :size="22" />
      </div>
      <div class="text-lg font-semibold">{{ progress?.phase === 'analyze' ? 'Analysing…' : 'Scanning…' }}</div>
      <div class="text-sm text-pebble-text-dim tabular-nums">
        {{ (progress?.dirs ?? 0).toLocaleString() }} folders · {{ (progress?.files ?? 0).toLocaleString() }} files
        <span v-if="(progress?.reusedDirs ?? 0) > 0"> · {{ (progress?.reusedDirs ?? 0).toLocaleString() }} reused</span>
      </div>
      <!-- The scan reports running counts but no total, so the bar is indeterminate. -->
      <div class="w-72 h-1.5 rounded-full bg-pebble-pressed overflow-hidden" aria-hidden="true">
        <div class="h-full w-1/3 rounded-full bg-pebble-accent pa-indeterminate"></div>
      </div>
      <div class="text-xs font-mono text-pebble-text-dim max-w-lg truncate h-4">{{ progress?.currentPath }}</div>
    </div>

    <!-- Results -->
    <template v-if="report && !busy">
      <!-- Toolbar -->
      <div class="px-4 py-2 bg-pebble-surface border-b border-pebble-border flex items-center gap-x-4 gap-y-2 flex-wrap">
        <div class="w-56"><AppSlider label="Minimum similarity" :min="30" :max="100" v-model="threshold" unit="%" :reset-to="70" /></div>
        <div class="w-52"><AppSegmented v-model="scopeFilter" :options="SCOPE_SEG" /></div>
        <span class="relative">
          <AppIcon name="search" :size="14" class="absolute left-2.5 top-1/2 -translate-y-1/2 text-pebble-text-dim pointer-events-none" />
          <input v-model="search" placeholder="Search path / file…" aria-label="Search path or file" class="pa-input text-xs h-8 !py-0 pl-8 w-48" />
        </span>
        <label class="pa-label flex items-center gap-1.5 whitespace-nowrap">Min files
          <input type="number" min="0" v-model.number="minFiles" class="pa-input w-16 h-8 !py-0 text-xs tabular-nums" /></label>
        <span class="relative">
          <select :value="matchBy" @change="changeMatchBy(($event.target as HTMLSelectElement).value as DupMatchBy)"
                  class="pa-input text-xs h-8 !py-0 pr-8 appearance-none cursor-pointer" aria-label="Match files by" title="Re-match from the existing scan (no rescan)">
            <option v-for="o in MATCH_OPTS" :key="o.v" :value="o.v">{{ o.label }}</option>
          </select>
          <AppIcon name="chevron-down" :size="14" class="absolute right-2.5 top-1/2 -translate-y-1/2 text-pebble-text-dim pointer-events-none" />
        </span>
        <div class="flex-1" />
        <div class="text-xs text-pebble-text-dim tabular-nums whitespace-nowrap">
          {{ stats?.dirs.toLocaleString() }} folders · {{ stats?.files.toLocaleString() }} files · scan {{ stats?.scanMs }}ms
          <span v-if="stats?.cacheHit"> · reused {{ reusePct }}%</span>
        </div>
      </div>

      <!-- Tabs -->
      <div class="bg-pebble-surface px-2">
        <AppTabs v-model="tab" :tabs="RESULT_TABS" />
      </div>

      <!-- Duplicate folders -->
      <div v-show="tab === 'folders'" class="flex-1 min-h-0">
        <VirtualList :items="shownPairs" :item-height="88" class="px-4 py-2">
          <template #default="{ item }">
            <div class="mx-0 my-1 rounded-lg border border-pebble-border bg-pebble-surface px-3 flex items-center gap-4 h-[80px]">
              <div class="shrink-0 w-16 text-center">
                <div class="text-xl font-semibold tabular-nums" :class="item.sim >= 0.99 ? 'text-pebble-success' : item.sim >= 0.85 ? 'text-pebble-text' : 'text-pebble-warning'">{{ Math.round(item.sim * 100) }}%</div>
                <div class="text-2xs text-pebble-text-dim tabular-nums">{{ item.recShared }} shared</div>
              </div>
              <span class="shrink-0 w-[92px] text-center text-2xs px-1.5 py-0.5 rounded font-medium"
                    :class="item.scope === 'across' ? 'bg-pebble-accent/15 text-pebble-accent-soft' : 'bg-pebble-warning/15 text-pebble-warning'">
                {{ item.scope === 'across' ? 'Across drives' : 'Within drive' }}
              </span>
              <div class="min-w-0 flex-1 space-y-1">
                <button type="button" class="flex items-center gap-2 w-full text-left group rounded" @click="openFolder(item.a.path)" :title="`Open ${item.a.path} in your file manager`">
                  <span class="shrink-0 w-32 text-2xs text-pebble-text-dim">Duplicate · {{ item.a.recFiles }} files</span>
                  <span class="h-2 w-2 rounded-full shrink-0" :style="{ background: ROOT_HUES[item.a.root % ROOT_HUES.length] }" />
                  <span class="text-sm font-mono truncate group-hover:text-pebble-accent-soft">{{ item.a.path }}</span>
                  <AppIcon name="external" :size="13" class="text-pebble-text-dim opacity-0 group-hover:opacity-100" />
                </button>
                <button type="button" class="flex items-center gap-2 w-full text-left group rounded" @click="openFolder(item.b.path)" :title="`Open ${item.b.path} in your file manager`">
                  <span class="shrink-0 w-32 text-2xs text-pebble-text-dim">Also in · {{ item.b.recFiles }} files</span>
                  <span class="h-2 w-2 rounded-full shrink-0" :style="{ background: ROOT_HUES[item.b.root % ROOT_HUES.length] }" />
                  <span class="text-xs font-mono truncate text-pebble-text-dim group-hover:text-pebble-accent-soft">{{ item.b.path }}</span>
                  <AppIcon name="external" :size="13" class="text-pebble-text-dim opacity-0 group-hover:opacity-100" />
                </button>
              </div>
            </div>
          </template>
          <template #empty>No duplicate folders at ≥ {{ threshold }}% similarity. Lower the slider to see more.</template>
        </VirtualList>
      </div>

      <!-- Duplicate files -->
      <div v-show="tab === 'files'" class="flex-1 min-h-0">
        <VirtualList :items="shownFiles" :item-height="64" class="px-4 py-2">
          <template #default="{ item }">
            <div class="mx-0 my-1 rounded-lg border border-pebble-border bg-pebble-surface px-3 flex items-center gap-4 h-[56px]">
              <span class="shrink-0 w-[92px] text-center text-2xs px-1.5 py-0.5 rounded font-medium tabular-nums"
                    :class="item.scope === 'across' ? 'bg-pebble-accent/15 text-pebble-accent-soft' : 'bg-pebble-warning/15 text-pebble-warning'">
                {{ item.total }}× {{ item.scope === 'across' ? 'across' : 'within' }}
              </span>
              <div class="min-w-0 flex-1">
                <div class="text-sm truncate">{{ item.name }} <span class="text-xs text-pebble-text-dim">· {{ fmtSize(item.size) }}</span></div>
                <div class="text-2xs font-mono text-pebble-text-dim truncate">
                  <button v-for="(l, i) in item.locs.slice(0, 4)" :key="l.id" type="button" class="hover:text-pebble-accent-soft rounded" @click="revealFile(l.path, item.name)" :title="`Reveal ${item.name} in your file manager`">
                    <span class="inline-block h-1.5 w-1.5 rounded-full mr-1 align-middle" :style="{ background: ROOT_HUES[l.root % ROOT_HUES.length] }" />{{ l.path }}{{ i < Math.min(item.locs.length, 4) - 1 ? '  ·  ' : '' }}
                  </button>
                  <span v-if="item.locs.length > 4"> +{{ item.locs.length - 4 }} more</span>
                </div>
              </div>
            </div>
          </template>
          <template #empty>No stray duplicate files at this filter (files inside duplicate folders are grouped under “Duplicate folders”).</template>
        </VirtualList>
      </div>
    </template>
  </div>
</template>
