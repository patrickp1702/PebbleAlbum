<script setup lang="ts">
/**
 * WelcomeView.vue — Launch screen. New Project + a grid of all SAVED projects
 * (read from ~/PebbleAlbum/projects). Each card opens its project or can be
 * deleted with the × button. A secondary "Open from file…" still allows opening
 * a .pebble from anywhere via the OS dialog.
 */
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore } from '@/stores/projectStore';
import type { RecentProject } from '@shared/editor.types';
import AppButton from '@/components/ui/AppButton.vue';
import AppModal from '@/components/ui/AppModal.vue';

const router = useRouter();
const app = useAppStore();
const project = useProjectStore();

const saved = ref<RecentProject[]>([]);
const loading = ref(true);
const confirmDelete = ref<RecentProject | null>(null);
const collageResume = ref<{ photos: number; editing: boolean } | null>(null);

const folder = ref('');

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
  <div class="h-full w-full flex flex-col items-center bg-gradient-to-br from-pebble-bg to-[#10162e] p-8 overflow-auto">
    <div class="text-center mb-8 mt-6">
      <div class="mx-auto mb-4 h-16 w-16 rounded-2xl bg-pebble-accent flex items-center justify-center text-3xl shadow-xl shadow-pebble-accent/30">📷</div>
      <h1 class="text-4xl font-bold tracking-tight">PebbleAlbum</h1>
      <p class="text-pebble-text-dim mt-1">Professional photo album creation studio</p>
    </div>

    <div class="flex gap-3 mb-8">
      <AppButton size="lg" @click="router.push('/setup')">＋ New Album Project</AppButton>
    </div>

    <!-- Standalone tools (no project) -->
    <div class="w-full max-w-4xl mb-10">
      <h2 class="text-sm uppercase tracking-wider text-pebble-text-dim mb-3">Quick tools</h2>

      <!-- Resume collage (only when an unfinished session exists) -->
      <div v-if="collageResume" class="pa-panel p-4 mb-4 border-pebble-accent/50 bg-pebble-accent/10 flex items-center gap-4">
        <div class="h-11 w-11 shrink-0 rounded-xl bg-pebble-accent/25 text-pebble-accent grid place-items-center text-2xl">↩</div>
        <div class="flex-1 min-w-0">
          <div class="font-medium">Resume collage</div>
          <div class="text-xs text-pebble-text-dim">
            {{ collageResume.editing ? 'Continue editing your collage' : 'Pick up where you left off' }}<span v-if="collageResume.photos"> · {{ collageResume.photos }} photo{{ collageResume.photos === 1 ? '' : 's' }}</span>
          </div>
        </div>
        <AppButton size="sm" @click="router.push('/collage')">Resume</AppButton>
        <button class="text-xs text-pebble-text-dim hover:text-red-400 px-1" title="Discard the saved collage" @click="discardCollage">Discard</button>
      </div>

      <div class="grid grid-cols-3 gap-4">
        <button class="pa-panel p-5 text-left hover:border-pebble-accent/60 transition flex items-start gap-4" @click="router.push('/collage')">
          <div class="h-11 w-11 shrink-0 rounded-xl bg-pebble-accent/20 text-pebble-accent grid place-items-center text-2xl">🖼️</div>
          <div>
            <div class="font-medium">Collage Creator</div>
            <div class="text-xs text-pebble-text-dim">Pick a folder, choose a few photos, make a collage and download it. No project needed.</div>
          </div>
        </button>
        <button class="pa-panel p-5 text-left hover:border-pebble-accent/60 transition flex items-start gap-4" @click="router.push('/duplicates')">
          <div class="h-11 w-11 shrink-0 rounded-xl bg-pebble-accent/20 text-pebble-accent grid place-items-center text-2xl">🔍</div>
          <div>
            <div class="font-medium">Duplicate Finder</div>
            <div class="text-xs text-pebble-text-dim">Group similar/burst photos in a folder and move the unwanted ones into a <code>duplicate</code> subfolder.</div>
          </div>
        </button>
        <button class="pa-panel p-5 text-left hover:border-pebble-accent/60 transition flex items-start gap-4" @click="router.push('/folder-duplicates')">
          <div class="h-11 w-11 shrink-0 rounded-xl bg-pebble-accent/20 text-pebble-accent grid place-items-center text-2xl">🗂️</div>
          <div>
            <div class="font-medium">Duplicate Folders</div>
            <div class="text-xs text-pebble-text-dim">Find whole folders (and files) duplicated within or across drives, by name + date. Handles huge trees.</div>
          </div>
        </button>
        <button class="pa-panel p-5 text-left hover:border-pebble-accent/60 transition flex items-start gap-4" @click="router.push('/pixart')">
          <div class="h-11 w-11 shrink-0 rounded-xl bg-pebble-accent/20 text-pebble-accent grid place-items-center text-2xl">🎨</div>
          <div>
            <div class="font-medium">Pixart — Photo Editor</div>
            <div class="text-xs text-pebble-text-dim">Open a photo, add photos on top, move/resize/rotate, erase and restore with a brush, adjust and filter, then save.</div>
          </div>
        </button>
      </div>
    </div>

    <div class="w-full max-w-4xl">
      <div class="flex items-center justify-between mb-1">
        <h2 class="text-sm uppercase tracking-wider text-pebble-text-dim">Open a Project</h2>
        <button class="text-xs text-pebble-text-dim hover:text-pebble-text" @click="refresh">↻ Refresh</button>
      </div>
      <p class="text-xs text-pebble-text-dim mb-3">
        Saved in <span class="font-mono">{{ folder || 'Documents/Pebble' }}</span>
        <button v-if="folder" class="ml-2 text-pebble-accent-soft hover:underline" @click="revealFolder">Reveal folder</button>
      </p>

      <div v-if="loading" class="pa-panel p-10 text-center text-pebble-text-dim">Loading…</div>

      <div v-else-if="saved.length" class="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div v-for="r in saved" :key="r.path"
             class="pa-panel group relative p-4 cursor-pointer hover:border-pebble-accent/60 transition"
             @click="open(r.path)">
          <div class="aspect-video rounded bg-pebble-bg mb-3 flex items-center justify-center text-pebble-text-dim overflow-hidden">
            <img v-if="r.coverThumbnail" :src="r.coverThumbnail" class="object-cover w-full h-full" />
            <span v-else class="text-3xl">🖼️</span>
          </div>
          <div class="font-medium truncate">{{ r.name }}</div>
          <div class="text-xs text-pebble-text-dim">{{ new Date(r.lastOpened).toLocaleString() }} · {{ r.imageCount }} images · {{ r.pageCount }} pages</div>
          <button class="absolute top-2 right-2 h-6 w-6 rounded-full bg-black/40 opacity-0 group-hover:opacity-100 text-pebble-text-dim hover:text-red-400 hover:bg-black/70"
                  title="Delete project" @click.stop="confirmDelete = r">✕</button>
        </div>
      </div>

      <div v-else class="pa-panel p-10 text-center text-pebble-text-dim">
        <div class="text-4xl mb-2">✨</div>
        <p>No saved projects yet. Create your first album — it'll be saved here automatically.</p>
      </div>
    </div>

    <footer class="mt-8 text-xs text-pebble-text-dim">PebbleAlbum v{{ app.appVersion }}</footer>

    <AppModal :open="!!confirmDelete" title="Delete project?" width="420px" @update:open="(v) => { if (!v) confirmDelete = null; }">
      <p class="text-sm">Delete <b>{{ confirmDelete?.name }}</b> permanently? This removes the .pebble file. Your source photos are not affected.</p>
      <template #footer>
        <AppButton variant="ghost" @click="confirmDelete = null">Cancel</AppButton>
        <AppButton variant="danger" @click="doDelete">Delete</AppButton>
      </template>
    </AppModal>
  </div>
</template>
