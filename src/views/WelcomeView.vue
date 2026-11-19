<script setup lang="ts">
/**
 * WelcomeView.vue — Launch screen, ordered by what the user came to do:
 *   1. Start    — the ONE primary action, "New album" (+ the Resume-collage row
 *                 when an unfinished collage session exists).
 *   2. Continue — "Your albums": every SAVED project (read from the Pebble
 *                 projects folder). A card opens its project; its trash button
 *                 deletes it (after a confirm dialog). Empty state says what to do.
 *   3. Tools    — the standalone tools (no project needed): Collage Creator,
 *                 Duplicate Finder, Duplicate Folders, Pixart.
 */
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import type { RecentProject } from '@shared/editor.types';
import AppButton from '@/components/ui/AppButton.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import AppIconButton from '@/components/ui/AppIconButton.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import type { IconName } from '@/components/ui/icons';

const router = useRouter();
const app = useAppStore();
const project = useProjectStore();

const saved = ref<RecentProject[]>([]);
const loading = ref(true);
const confirmDelete = ref<RecentProject | null>(null);
const collageResume = ref<{ photos: number; editing: boolean } | null>(null);

const folder = ref('');

/** Standalone tools: icon, name and ONE line of purpose each. */
const TOOLS: { to: string; icon: IconName; title: string; text: string }[] = [
  { to: '/collage', icon: 'collage', title: 'Collage Creator', text: 'Arrange a few photos into one image and download it.' },
  { to: '/pixart', icon: 'brush', title: 'Pixart — Photo Editor', text: 'Edit one photo: layer, erase, adjust, filter, save.' },
  { to: '/duplicates', icon: 'search', title: 'Duplicate Finder', text: 'Group similar and burst photos, then move the extras aside.' },
  { to: '/folder-duplicates', icon: 'folders', title: 'Duplicate Folders', text: 'Find folders and files duplicated across drives.' },
];

async function refresh() {
  loading.value = true;
  try {
    saved.value = await window.pebble.listSavedProjects();
    folder.value = await window.pebble.getPebbleFolderPath();
  } catch { saved.value = []; }
  await refreshCollage();
  loading.value = false;
}

/** Detect a resumable collage session (the single hidden temp file). */
async function refreshCollage() {
  try {
    const s = await window.pebble.collageLoadTemp?.();
    if (s && s.v) {
      const editing = s.collage.phase === 'edit' && !!s.project;
      const photos = editing
        ? (s.project?.pages?.[0]?.images?.filter((i) => i.visible !== false).length ?? 0)
        : (s.collage.selected?.length ?? 0);
      collageResume.value = { photos, editing };
    } else collageResume.value = null;
  } catch { collageResume.value = null; }
}

async function discardCollage() {
  try { await window.pebble.collageClearTemp?.(); } catch { /* ignore */ }
  collageResume.value = null;
  app.toast('Collage session discarded.', 'info', 1500);
}
onMounted(refresh);

async function open(path: string) {
  try {
    const p = await window.pebble.loadProject(path);
    project.setProject(p, path);
    await window.pebble.addRecentProject(path, p.meta.name);
    router.push('/editor');
  } catch {
    app.toast('Could not open project. The file may be corrupt — try its .bak backup.', 'error', 5000);
  }
}

function revealFolder() { if (folder.value) void window.pebble.revealInExplorer(folder.value); }

async function doDelete() {
  if (!confirmDelete.value) return;
  const p = confirmDelete.value.path;
  confirmDelete.value = null;
  try { await window.pebble.deleteProject(p); app.toast('Project deleted.', 'info', 1500); } catch { app.toast('Could not delete project.', 'error'); }
  await refresh();
}
</script>

<template>
  <div class="h-full w-full overflow-auto bg-pebble-bg">
    <div class="mx-auto w-full max-w-5xl px-8 py-8">
      <!-- Header: identity, quiet -->
      <header class="flex items-center gap-3 mb-8">
        <div class="h-9 w-9 shrink-0 rounded-lg bg-pebble-accent text-pebble-on-accent grid place-items-center">
          <AppIcon name="book" :size="19" />
        </div>
        <div class="min-w-0">
          <h1 class="text-lg font-semibold leading-tight">PebbleAlbum</h1>
          <p class="text-xs text-pebble-text-dim">Photo album studio</p>
        </div>
        <span class="ml-auto text-xs text-pebble-text-dim tabular-nums">v{{ app.appVersion }}</span>
      </header>

      <!-- 1. START -->
      <section class="mb-8">
        <div class="flex items-center gap-4 flex-wrap">
          <AppButton size="lg" icon="plus" @click="router.push('/setup')">New album</AppButton>
          <p class="text-sm text-pebble-text-dim">Pick a folder of photos — pages are laid out for you, then you fine-tune.</p>
        </div>

        <!-- Resume collage (only when an unfinished session exists) -->
        <div v-if="collageResume" class="mt-4 flex items-center gap-3 rounded-lg bg-pebble-surface border border-pebble-border border-l-2 border-l-pebble-accent pl-3.5 pr-2 py-2.5">
          <AppIcon name="collage" :size="18" class="text-pebble-accent-soft" />
          <div class="flex-1 min-w-0">
            <div class="text-sm font-medium">Unfinished collage</div>
            <div class="text-xs text-pebble-text-dim">
              {{ collageResume.editing ? 'Continue editing your collage' : 'Pick up where you left off' }}<span v-if="collageResume.photos"> · {{ collageResume.photos }} photo{{ collageResume.photos === 1 ? '' : 's' }}</span>
            </div>
          </div>
          <AppButton size="sm" variant="secondary" @click="router.push('/collage')">Resume</AppButton>
          <AppButton size="sm" variant="ghost" title="Discard the saved collage" @click="discardCollage">Discard</AppButton>
        </div>
      </section>

      <!-- 2. CONTINUE: saved albums -->
      <section class="mb-8">
        <div class="flex items-center gap-2 mb-3">
          <h2 class="text-base font-semibold">Your albums</h2>
          <span v-if="saved.length" class="text-xs text-pebble-text-dim tabular-nums">{{ saved.length }}</span>
          <span class="ml-auto text-xs text-pebble-text-dim truncate max-w-[22rem] font-mono" :title="folder">{{ folder || 'Documents/Pebble' }}</span>
          <AppIconButton v-if="folder" icon="folder" label="Reveal the albums folder" size="sm" @click="revealFolder" />
          <AppIconButton icon="rotate-cw" label="Refresh the list" size="sm" @click="refresh" />
        </div>

        <div v-if="loading" class="rounded-lg border border-pebble-border bg-pebble-surface py-10 text-center text-sm text-pebble-text-dim">Loading albums…</div>

        <div v-else-if="saved.length" class="grid grid-cols-4 gap-4">
          <div v-for="r in saved" :key="r.path" role="button" tabindex="0"
               class="group relative rounded-lg bg-pebble-surface border border-pebble-border cursor-pointer overflow-hidden transition-colors hover:bg-pebble-hover hover:border-pebble-border-strong"
               :title="`Open ${r.name}`"
               @click="open(r.path)" @keydown.enter.self="open(r.path)">
            <div class="aspect-video bg-pebble-surface-2 flex items-center justify-center text-pebble-text-off overflow-hidden">
              <img v-if="r.coverThumbnail" :src="r.coverThumbnail" class="object-cover w-full h-full" alt="" />
              <AppIcon v-else name="image" :size="28" :stroke="1.5" />
            </div>
            <div class="px-3 py-2.5">
              <div class="text-sm font-medium truncate">{{ r.name }}</div>
              <div class="text-xs text-pebble-text-dim truncate mt-0.5">{{ r.pageCount }} pages · {{ r.imageCount }} photos · {{ new Date(r.lastOpened).toLocaleDateString() }}</div>
            </div>
            <button type="button"
                    class="absolute top-2 right-2 h-7 w-7 rounded-md grid place-items-center bg-black/60 text-white/85 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 hover:bg-pebble-danger-fill hover:text-white"
                    title="Delete album…" aria-label="Delete album" @click.stop="confirmDelete = r">
              <AppIcon name="trash" :size="14" />
            </button>
          </div>
        </div>

        <div v-else class="rounded-lg border border-dashed border-pebble-border-strong/60">
          <AppEmptyState icon="book" title="No albums yet"
                         text="Create your first album — it is saved here automatically and you can pick it up any time."
                         class="!py-7">
            <AppButton variant="secondary" icon="plus" @click="router.push('/setup')">New album</AppButton>
          </AppEmptyState>
        </div>
      </section>

      <!-- 3. TOOLS (standalone, no project) -->
      <section>
        <h2 class="text-base font-semibold mb-3">Tools</h2>
        <div class="grid grid-cols-2 xl:grid-cols-4 gap-3">
          <button v-for="t in TOOLS" :key="t.to" type="button"
                  class="group flex items-start gap-3 text-left rounded-lg bg-pebble-surface border border-pebble-border p-3.5 transition-colors hover:bg-pebble-hover hover:border-pebble-border-strong"
                  @click="router.push(t.to)">
            <div class="h-9 w-9 shrink-0 rounded-md bg-pebble-surface-2 border border-pebble-border text-pebble-text grid place-items-center group-hover:text-pebble-accent-soft">
              <AppIcon :name="t.icon" :size="18" />
            </div>
            <div class="flex-1 min-w-0">
              <div class="text-sm font-medium flex items-center gap-1">
                <span class="truncate">{{ t.title }}</span>
                <AppIcon name="chevron-right" :size="14" class="text-pebble-text-off group-hover:text-pebble-text" />
              </div>
              <div class="text-xs text-pebble-text-dim mt-0.5">{{ t.text }}</div>
            </div>
          </button>
        </div>
      </section>
    </div>

    <AppModal :open="!!confirmDelete" title="Delete album?" width="420px" @update:open="(v) => { if (!v) confirmDelete = null; }">
      <p class="text-sm">Delete <b>{{ confirmDelete?.name }}</b> permanently? This removes the .pebble file. Your source photos are not affected.</p>
      <template #footer>
        <AppButton variant="ghost" @click="confirmDelete = null">Cancel</AppButton>
        <AppButton variant="danger" icon="trash" @click="doDelete">Delete</AppButton>
      </template>
    </AppModal>
  </div>
</template>
