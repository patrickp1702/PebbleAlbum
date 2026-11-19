<script setup lang="ts">
/**
 * PhotoSelectionView.vue — full-screen photo culling / selection (Google-Photos-style).
 *
 * Robustness notes (learned the hard way):
 *  • The overlay is **teleported to <body>** so `position: fixed` is never clipped
 *    or mis-placed by a transformed/overflow ancestor (wizard + editor layouts).
 *  • It renders the photos IMMEDIATELY from the `records` prop; duplicate analysis
 *    (`analyzeFolder`) is a NON-BLOCKING enhancement that overlays grouping +
 *    quality when ready. If analysis is slow, unavailable, or errors, the grid
 *    still works — so the view can never "completely break".
 *
 * Only SELECTED photos are used in the album; the rest are reported as skipped.
 */
import { ref, reactive, computed, watch } from 'vue';
import type { ImageRecord, DuplicateGroup } from '@shared/pebble.types';

const props = defineProps<{ open: boolean; folder: string; records: ImageRecord[]; preselectSkipped?: string[] }>();
const emit = defineEmits<{ (e: 'update:open', v: boolean): void; (e: 'apply', skipped: string[]): void }>();

const analyzing = ref(false);
const notice = ref('');
const groups = ref<DuplicateGroup[]>([]);
const displayRecords = ref<ImageRecord[]>([]);
const selected = reactive<Record<string, boolean>>({});
const thumbs = reactive<Record<string, string>>({});
let touched = false;

const recByPath = computed(() => { const m = new Map<string, ImageRecord>(); for (const r of displayRecords.value) m.set(r.relativePath, r); return m; });
const groupedPaths = computed(() => new Set(groups.value.flatMap((g) => g.members)));
const ungrouped = computed(() => displayRecords.value.filter((r) => !groupedPaths.value.has(r.relativePath)));
const total = computed(() => displayRecords.value.length);
const kept = computed(() => displayRecords.value.reduce((n, r) => n + (selected[r.relativePath] ? 1 : 0), 0));
const removing = computed(() => total.value - kept.value);
const dupTotal = computed(() => groups.value.reduce((n, g) => n + g.members.length, 0));

watch(() => props.open, (o) => { if (o) start(); });

function start() {
  touched = false; notice.value = ''; groups.value = [];
  displayRecords.value = (props.records ?? []).slice();
  for (const k of Object.keys(selected)) delete selected[k];
  initSelection(false);
  displayRecords.value.forEach(ensureThumb);
  void runAnalysis();
}

async function runAnalysis() {
  if (!props.folder) return;
  if (!window.pebble?.analyzeFolder) { notice.value = 'Restart the app to enable duplicate detection — showing all photos.'; return; }
  analyzing.value = true;
  try {
    const res = await window.pebble.analyzeFolder(props.folder);
    if (!props.open) return;
    if (res.records?.length) { displayRecords.value = res.records; res.records.forEach(ensureThumb); }
    groups.value = res.groups ?? [];
    if (!touched) initSelection(true); // apply best-of-group suggestions if user hasn't started
  } catch (e) {
    notice.value = `Couldn't analyze duplicates (${(e as Error).message}) — showing all photos.`;
  } finally { analyzing.value = false; }
}

/** Initialise keep/skip: keep all minus pre-skipped; in each group keep only the best. */
function initSelection(applyGroups: boolean) {
  const skip = new Set(props.preselectSkipped ?? []);
  for (const r of displayRecords.value) selected[r.relativePath] = !skip.has(r.relativePath) && !r.skipped;
  if (applyGroups && !props.preselectSkipped) {
    for (const g of groups.value) { for (const m of g.members) selected[m] = false; selected[g.suggested] = true; }
  }
}

function ensureThumb(r: ImageRecord) {
  const key = r.relativePath;
  if (!r.thumbnailPath || thumbs[key]) return;
  window.pebble.readImageBase64(r.thumbnailPath).then((d) => { thumbs[key] = d; }).catch(() => {});
}
const src = (rel: string) => thumbs[rel] ?? '';

function toggle(rel: string) { touched = true; selected[rel] = !selected[rel]; }
function keepBestOnly(g: DuplicateGroup) { touched = true; for (const m of g.members) selected[m] = m === g.suggested; }
function keepAll(g: DuplicateGroup) { touched = true; for (const m of g.members) selected[m] = true; }
function keepBestEverywhere() { touched = true; for (const g of groups.value) { for (const m of g.members) selected[m] = false; selected[g.suggested] = true; } }
function selectAll() { touched = true; for (const r of displayRecords.value) selected[r.relativePath] = true; }

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

function apply() {
  emit('apply', displayRecords.value.filter((r) => !selected[r.relativePath]).map((r) => r.relativePath));
  emit('update:open', false);
}
function cancel() { emit('update:open', false); }
</script>

<template>
  <Teleport to="body">
    <div v-if="open" class="fixed inset-0 z-[60] bg-pebble-bg flex flex-col text-pebble-text" @keydown.esc="cancel" tabindex="-1">
      <!-- Header -->
      <header class="shrink-0 h-16 px-6 flex items-center gap-4 border-b border-pebble-border bg-pebble-surface/80 backdrop-blur">
        <div class="min-w-0">
          <div class="text-base font-semibold leading-tight">Select photos</div>
          <div class="text-xs text-pebble-text-dim">
            Keeping <b class="text-pebble-text">{{ kept }}</b> of {{ total }}
            <template v-if="removing > 0">· removing {{ removing }}</template>
            <template v-if="groups.length">· {{ groups.length }} similar group{{ groups.length === 1 ? '' : 's' }}</template>
          </div>
        </div>
        <span v-if="analyzing" class="text-[11px] text-pebble-accent-soft flex items-center gap-1.5">
          <span class="w-2 h-2 rounded-full bg-pebble-accent animate-ping"></span> Finding duplicates…
        </span>
        <div class="flex-1"></div>
        <button class="h-9 px-4 rounded-lg text-sm text-pebble-text-dim hover:text-pebble-text hover:bg-white/5 transition" @click="cancel">Cancel</button>
        <button class="h-9 px-5 rounded-lg text-sm font-medium bg-pebble-accent text-white hover:brightness-110 transition" @click="apply">Done · keep {{ kept }}</button>
      </header>

      <!-- Toolbar -->
      <div v-if="groups.length || notice" class="shrink-0 px-6 py-2 flex items-center gap-3 border-b border-pebble-border/60 text-xs">
        <template v-if="groups.length">
          <button class="px-2.5 py-1 rounded-md bg-pebble-surface-2 hover:bg-white/10 transition" @click="keepBestEverywhere">✨ Keep best of every group</button>
          <button class="px-2.5 py-1 rounded-md bg-pebble-surface-2 hover:bg-white/10 transition" @click="selectAll">Keep all</button>
          <span class="text-pebble-text-dim">Best shot is pre-selected — click any photo to change.</span>
        </template>
        <span v-if="notice" class="text-amber-300/90">{{ notice }}</span>
      </div>

      <!-- Body -->
      <div class="flex-1 overflow-auto px-6 py-5 space-y-7">
        <div v-if="!total" class="text-pebble-text-dim">No photos found in this folder.</div>

        <!-- Duplicate groups -->
        <section v-if="groups.length">
          <div class="text-[11px] font-semibold uppercase tracking-wider text-pebble-text-dim mb-3">Similar shots ({{ groups.length }} groups · {{ dupTotal }} photos)</div>
          <div class="space-y-4">
            <div v-for="g in groups" :key="g.id" class="rounded-xl border border-pebble-border bg-pebble-surface/60 p-4">
              <div class="flex items-center justify-between mb-3">
                <span class="text-xs text-pebble-text-dim">{{ g.members.length }} similar photos</span>
                <div class="flex gap-3 text-[11px]">
                  <button class="text-pebble-accent-soft hover:text-pebble-accent" @click="keepBestOnly(g)">Keep best only</button>
                  <button class="text-pebble-text-dim hover:text-pebble-text" @click="keepAll(g)">Keep all</button>
                </div>
              </div>
              <div class="flex flex-wrap gap-3">
                <button v-for="m in g.members" :key="m" @click="toggle(m)"
                        class="relative w-44 rounded-xl overflow-hidden bg-pebble-surface-2 ring-2 transition-all duration-150 text-left hover:-translate-y-0.5"
                        :class="selected[m] ? 'ring-pebble-accent shadow-lg shadow-black/30' : 'ring-transparent opacity-55 hover:opacity-90'">
                  <div class="relative">
                    <img v-if="src(m)" :src="src(m)" class="w-44 h-32 object-cover" :alt="fileOf(m)" />
                    <div v-else class="w-44 h-32 bg-pebble-surface-2 animate-pulse" />
                    <span class="absolute top-2 right-2 w-6 h-6 rounded-full grid place-items-center text-[12px] border-2 transition"
                          :class="selected[m] ? 'bg-pebble-accent border-pebble-accent text-white' : 'bg-black/40 border-white/70 text-transparent'">✓</span>
                    <span v-if="m === g.suggested" class="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-pebble-accent/90 text-white text-[10px] font-semibold shadow">★ Best</span>
                  </div>
                  <div class="px-2 py-1.5">
                    <div class="truncate text-[10px] text-pebble-text-dim" :title="m">{{ fileOf(m) }}</div>
                    <div v-if="flags(m, g).length" class="flex flex-wrap gap-1 mt-1">
                      <span v-for="f in flags(m, g)" :key="f" class="px-1.5 rounded-full text-[9px] bg-amber-500/20 text-amber-300 capitalize">{{ f }}</span>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </section>

        <!-- Other photos -->
        <section v-if="ungrouped.length">
          <div class="text-[11px] font-semibold uppercase tracking-wider text-pebble-text-dim mb-3">
            {{ groups.length ? 'All other photos' : 'All photos' }} ({{ ungrouped.length }})
          </div>
          <div class="grid gap-2.5 grid-cols-4 sm:grid-cols-6 lg:grid-cols-8 xl:grid-cols-10">
            <button v-for="r in ungrouped" :key="r.relativePath" @click="toggle(r.relativePath)"
                    class="relative aspect-square rounded-lg overflow-hidden bg-pebble-surface-2 ring-2 transition-all duration-150 hover:-translate-y-0.5"
                    :class="selected[r.relativePath] ? 'ring-pebble-accent' : 'ring-transparent opacity-50 hover:opacity-90'">
              <img v-if="src(r.relativePath)" :src="src(r.relativePath)" class="w-full h-full object-cover" :alt="fileOf(r.relativePath)" />
              <div v-else class="w-full h-full animate-pulse" />
              <span class="absolute top-1.5 right-1.5 w-5 h-5 rounded-full grid place-items-center text-[10px] border-2 transition"
                    :class="selected[r.relativePath] ? 'bg-pebble-accent border-pebble-accent text-white' : 'bg-black/40 border-white/70 text-transparent'">✓</span>
            </button>
          </div>
        </section>
      </div>
    </div>
  </Teleport>
</template>
