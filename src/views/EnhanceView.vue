<script setup lang="ts">
/**
 * EnhanceView.vue — "AI Enhance": identity-safe re-imagining of a project's photos.
 *
 * The user picks photos, describes the new scene / wardrobe / lighting, keeps the
 * identity paragraph, configures an image API, then copies ONE prompt into their
 * AI agent (connected to the pebble-album MCP server). The AGENT does the work out
 * of process — generate a variant → judge pose from a low-res preview + face
 * metrics → retry → composite the ORIGINAL face back with skin-tone matching —
 * through the `enhance_*` MCP tools (see mcp/enhance/, mcp/skills/pebble-enhance.md).
 * This view only edits the queue/settings and shows the results. Two phases:
 *   1. start  — no usable project: "Open a folder…" (reuses the folder's saved
 *               .pebble, or creates + SAVES a real one so the MCP server can find
 *               it) or pick one of the saved projects.
 *   2. studio — left: the photo grid (checkbox = queued, status badge, the final's
 *               thumbnail + Show in folder once done); right: Scene, Identity and
 *               Image API cards, then the 1-2-3 steps with the live prompt preview.
 *
 * Entry: from Welcome (Tools → AI Enhance) the view starts in phase 1; from the
 * editor's top-bar "Enhance" button (`/enhance?from=editor`) it goes straight to
 * phase 2 with the album already open. Unlike Pixart/Collage this is a REAL saved
 * project — never stashed or swapped for an in-memory one. An in-memory Pixart/
 * Collage project (autoSave:false / no save path) counts as "no project".
 *
 * Model: the queue lives at `project.enhance` (EnhanceConfig, created with the
 * contract defaults when missing). ⚠ The agent edits the SAME .pebble while this
 * view is open, so this view does NOT use the store's whole-project autosave
 * (that would overwrite the agent's attempts, statuses and registered finals with
 * a stale copy). Instead every edit is tracked (`local`) and persisted by a
 * debounced MERGE-SAVE: re-read the file, re-apply only the fields/queue entries
 * the user changed here, take everything else from disk, write. "Reload results"
 * does the same merge without forcing a write.
 *
 * Privacy: photos leave the machine only when the agent calls `enhance_generate`,
 * and only to the provider configured here; the agent itself sees ≤ 640 px
 * previews. The API key is stored by the main process in <Pebble>/ai-provider.json
 * (mode 0600) and is never put in the .pebble or the MCP config.
 */
import { ref, reactive, computed, watch, onMounted, onBeforeUnmount, type ComponentPublicInstance } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAppStore } from '@/stores/appStore';
import { useProjectStore, createDefaultMeta } from '@/stores/projectStore';
import { useEditorStore } from '@/stores/editorStore';
import { useHistoryStore } from '@/stores/historyStore';
import { generateAlbum, DEFAULT_GENERATOR_CONFIG } from '@/engine/albumGenerator';
import type { EnhanceConfig, EnhanceItem, EnhanceStatus, ImageRecord, PebbleProject } from '@shared/pebble.types';
import type { AiProviderConfig, AiProviderKind, AiProviderStatus, AiProviderTestResult, McpConnectInfo } from '@shared/ipc.types';
import type { RecentProject } from '@shared/editor.types';
import AppButton from '@/components/ui/AppButton.vue';
import AppIconButton from '@/components/ui/AppIconButton.vue';
import AppIcon from '@/components/ui/AppIcon.vue';
import AppEmptyState from '@/components/ui/AppEmptyState.vue';
import AppModal from '@/components/ui/AppModal.vue';
import AppSegmented from '@/components/ui/AppSegmented.vue';

const route = useRoute();
const router = useRouter();
const app = useAppStore();
const project = useProjectStore();
const editor = useEditorStore();
const history = useHistoryStore();

// ── Contract constants (must match mcp/enhance/* and the MCP skill doc) ──────
/** Verbatim identity paragraph — the default of `enhance.identityText`. */
const DEFAULT_IDENTITY_TEXT = 'Use the exact person/people from the attached photo as the identity reference. Preserve their face with full accuracy — facial features, face shape, jawline, nose, eyes, eyebrows, lips, and their natural expression exactly as in the reference. Keep the original skin tone, complexion, and any distinguishing marks unchanged. Maintain the original hairstyle\'s length, color, and texture realistically. Keep body proportions true to the reference. Keep the same head direction, gaze and camera angle. Do not beautify, slim, smooth, age, de-age, reshape, or otherwise reinterpret the identity in any way. The person must remain instantly recognizable as the same individual. Only the scene, wardrobe, lighting, and setting described may change — the identity must not.';
const MAX_ATTEMPTS_LIMIT = 6;
/** Where the agent writes results; these files are never offered for queueing. */
const ENHANCED_DIR = 'enhanced/';

/**
 * Form defaults per provider (placeholders / prefill only). A renderer-side copy of
 * PROVIDER_DEFAULTS in mcp/enhance/providerConfig.mjs — that module imports node:fs
 * and cannot load in the renderer. The main process re-normalises on save, so the
 * .mjs table stays authoritative; keep the two in step.
 */
const PROVIDERS: Record<AiProviderKind, { label: string; model: string; baseUrl: string; size: string; quality: string; mask: boolean }> = {
  openai: { label: 'OpenAI Images', model: 'gpt-image-2.5-sunburst', baseUrl: 'https://api.openai.com/v1', size: 'auto', quality: 'high', mask: true },
  gemini: { label: 'Google Gemini (image)', model: 'gemini-3.1-flash-image', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', size: '', quality: '', mask: false },
  openai_compatible: { label: 'OpenAI-compatible endpoint', model: '', baseUrl: '', size: 'auto', quality: '', mask: true },
  mock: { label: 'Mock (offline test)', model: 'mock', baseUrl: '', size: '', quality: '', mask: true },
};
const PROVIDER_KINDS = Object.keys(PROVIDERS) as AiProviderKind[];

const STATUS_STYLE: Record<EnhanceStatus, { label: string; cls: string }> = {
  pending: { label: 'Pending', cls: 'bg-pebble-surface-2 text-pebble-text-dim border border-pebble-border' },
  generating: { label: 'Generating', cls: 'bg-pebble-accent/15 text-pebble-accent-soft' },
  review: { label: 'Review', cls: 'bg-pebble-warning/15 text-pebble-warning' },
  compositing: { label: 'Compositing', cls: 'bg-pebble-accent/15 text-pebble-accent-soft' },
  done: { label: 'Done', cls: 'bg-pebble-success/15 text-pebble-success' },
  failed: { label: 'Failed', cls: 'bg-pebble-danger/15 text-pebble-danger' },
  skipped: { label: 'Skipped', cls: 'bg-pebble-surface-2 text-pebble-text-off border border-pebble-border' },
};

function defaultEnhance(): EnhanceConfig {
  return { scenePrompt: '', identityText: DEFAULT_IDENTITY_TEXT, keepFace: true, maxAttempts: 3, items: [] };
}
/** ipcRenderer.invoke wraps main-process errors — show only the real message. */
function errText(e: unknown): string {
  return String((e as Error)?.message ?? e).replace(/^Error invoking remote method '[^']+':\s*(Error:\s*)?/, '');
}
function basename(p: string): string { return p.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || p; }

// ═════════════════════════════ PHASE 1 — start ═════════════════════════════
const phase = ref<'start' | 'studio'>('start');
const opening = ref(false);
const saved = ref<RecentProject[]>([]);
const loadingSaved = ref(false);

/** A project the studio can use: saved (or savable) to a .pebble the MCP server reads. */
const hasRealProject = computed(() => !!project.project && project.project.meta.autoSave !== false);

async function refreshSaved() {
  loadingSaved.value = true;
  try { saved.value = await window.pebble.listSavedProjects(); } catch { saved.value = []; }
  finally { loadingSaved.value = false; }
}

/** Before replacing the store's project: persist unsaved edits of a REAL album. */
async function releaseCurrent() {
  if (project.project && project.dirty && project.savePath && project.project.meta.autoSave !== false) {
    try { await project.save(); } catch { /* the album keeps its .bak; don't block the switch */ }
  }
}

function adopt(p: PebbleProject, path: string) {
  project.setProject(p, path);
  history.clear(); // the previous album's undo stack must not apply to this one
  editor.selectObject(null);
  editor.setPage(0);
}

/** Open a saved project (from the list, or found for a folder). */
async function openSaved(path: string) {
  if (opening.value) return;
  opening.value = true;
  try {
    await releaseCurrent();
    const p = await window.pebble.loadProject(path);
    adopt(p, path);
    await window.pebble.addRecentProject(path, p.meta.name).catch(() => {});
    enterStudio();
  } catch (e) {
    app.toast(`Could not open project: ${errText(e)}`, 'error', 5000);
  } finally { opening.value = false; }
}

/** A project name whose `<name>.pebble` doesn't clobber another folder's album. */
function freeName(base: string): string {
  const taken = new Set(saved.value.map((r) => basename(r.path).replace(/\.pebble$/i, '').toLowerCase()));
  const clean = (s: string) => s.replace(/[^a-z0-9_\- ]/gi, '').trim() || 'album'; // = project.ipc sanitize
  let name = base; let i = 2;
  while (taken.has(clean(name).toLowerCase())) { name = `${base} ${i}`; i += 1; }
  return name;
}

/**
 * Open a folder… — reuse the folder's saved project, else create a REAL one
 * (same pipeline as the New album wizard with default settings) and save it
 * right away so the .pebble exists for the MCP server.
 */
async function openFolder() {
  if (opening.value) return;
  const folder = await window.pebble.openFolderDialog();
  if (!folder) return;
  const existing = await window.pebble.findProjectForFolder(folder).catch(() => null);
  if (existing) { await openSaved(existing); return; }
  opening.value = true;
  try {
    const records = await window.pebble.listImages(folder);
    if (!records.length) { app.toast('No photos found in that folder.', 'info', 3500); return; }
    await releaseCurrent();
    await refreshSaved();
    const meta = createDefaultMeta({ name: freeName(basename(folder)), sourceFolder: folder });
    const pages = generateAlbum(meta, records, DEFAULT_GENERATOR_CONFIG);
    project.initProject(meta, records, pages);
    history.clear();
    editor.selectObject(null);
    editor.setPage(0);
    const path = await project.save();
    if (path) app.toast(`New project saved to ${path}`, 'success', 5000);
    enterStudio();
  } catch (e) {
    app.toast(`Could not create a project for that folder: ${errText(e)}`, 'error', 5000);
  } finally { opening.value = false; }
}

// ═════════════════════════════ PHASE 2 — studio ════════════════════════════
const enh = computed<EnhanceConfig | null>(() => project.project?.enhance ?? null);
const itemsByName = computed(() => new Map((enh.value?.items ?? []).map((i) => [i.filename, i])));
/** Queue candidates: every registry photo except the agent's own outputs. */
const photos = computed<ImageRecord[]>(() => project.images.filter((r) => !r.relativePath.startsWith(ENHANCED_DIR)));
const show = ref<'all' | 'queued'>('all');
const shown = computed(() => (show.value === 'queued' ? photos.value.filter((r) => itemsByName.value.has(r.relativePath)) : photos.value));
const queuedCount = computed(() => enh.value?.items.length ?? 0);
const counts = computed(() => {
  const c: Partial<Record<EnhanceStatus, number>> = {};
  for (const i of enh.value?.items ?? []) c[i.status] = (c[i.status] ?? 0) + 1;
  return c;
});

function ensureEnhance(): EnhanceConfig {
  const p = project.project!;
  if (!p.enhance) p.enhance = defaultEnhance(); // created lazily; persisted on the first edit
  return p.enhance;
}

async function enterStudio() {
  if (!project.project) return;
  // A brand-new album from the wizard may not have hit its first autosave yet.
  if (!project.savePath) {
    try { const path = await project.save(); if (path) app.toast(`Project saved to ${path}`, 'success', 4000); }
    catch (e) { app.toast(`Could not save the project: ${errText(e)}`, 'error', 5000); return; }
  } else if (project.dirty) {
    try { await project.save(); } catch { /* merge-save below retries */ }
  }
  ensureEnhance();
  resetLocal();
  phase.value = 'studio';
  void persist(false); // show what the agent already did (merge only — writes nothing without local edits)
  void loadProviderForm();
  void loadMcpInfo();
}

// ── Local edit tracking + merge-save (see header) ───────────────────────────
type SettingKey = 'scenePrompt' | 'identityText' | 'keepFace' | 'maxAttempts';
const local = { settings: new Set<SettingKey>(), adds: new Set<string>(), removes: new Set<string>() };
function resetLocal() { local.settings.clear(); local.adds.clear(); local.removes.clear(); }
const hasLocalEdits = () => local.settings.size > 0 || local.adds.size > 0 || local.removes.size > 0;

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let persisting = false;
let persistAgain = false;
const syncing = ref(false);

/** Mark the project edited and schedule the merge-save (debounced like autosave). */
function edited() {
  project.dirty = true;
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => { saveTimer = null; void persist(false); }, 1500);
}

/** Merge the file on disk into memory, keeping the user's local edits. */
function applyDisk(disk: PebbleProject) {
  const p = project.project!;
  const mem = ensureEnhance();
  const d = disk.enhance ?? defaultEnhance();
  if (!local.settings.has('scenePrompt')) mem.scenePrompt = d.scenePrompt;
  if (!local.settings.has('identityText')) mem.identityText = d.identityText;
  if (!local.settings.has('keepFace')) mem.keepFace = d.keepFace;
  if (!local.settings.has('maxAttempts')) mem.maxAttempts = d.maxAttempts;
  // Queue: the agent's item records win; membership = disk ± what the user changed here.
  const diskBy = new Map(d.items.map((i) => [i.filename, i]));
  const memBy = new Map(mem.items.map((i) => [i.filename, i]));
  const names = d.items.map((i) => i.filename).filter((n) => !local.removes.has(n));
  for (const n of local.adds) if (!diskBy.has(n)) names.push(n);
  mem.items = names.map((n) => diskBy.get(n) ?? memBy.get(n)).filter((i): i is EnhanceItem => !!i);
  // Finals are registered by the agent; pages only change if someone else edited them.
  p.imageRegistry = disk.imageRegistry ?? p.imageRegistry;
  if (JSON.stringify(disk.pages ?? []) !== JSON.stringify(p.pages)) { p.pages = disk.pages ?? []; history.clear(); editor.requestRender(); }
  project.syncUsage(p);
}

/**
 * Re-read the .pebble, merge, and (when there were local edits, or `force`) write
 * the result back. Used by the debounced save, Save, Reload results and on leave.
 */
async function persist(force: boolean): Promise<boolean> {
  if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
  if (persisting) { persistAgain = true; return false; }
  const path = project.savePath;
  if (!project.project || !path) return false;
  persisting = true; syncing.value = true;
  const write = force || hasLocalEdits() || project.dirty;
  try {
    let disk: PebbleProject | null = null;
    try { disk = await window.pebble.loadProject(path); } catch { disk = null; } // missing/corrupt ⇒ write memory as-is
    if (disk) applyDisk(disk);
    resetLocal();
    if (write) {
      project.saveState = 'saving';
      const payload = JSON.parse(JSON.stringify(project.project)) as PebbleProject; // proxy-free copy for IPC
      payload.meta.updatedAt = new Date().toISOString();
      await window.pebble.saveProject(payload, path);
      project.saveState = 'saved';
      setTimeout(() => { if (project.saveState === 'saved') project.saveState = 'idle'; }, 1500);
    }
    project.dirty = false;
    finalNonce.value += 1;
    return true;
  } catch (e) {
    project.saveState = 'error';
    app.toast(`Could not save the Enhance queue: ${errText(e)}`, 'error', 5000);
    return false;
  } finally {
    persisting = false; syncing.value = false;
    if (persistAgain) { persistAgain = false; void persist(false); }
  }
}

async function saveNow() { if (await persist(true)) app.toast('Saved.', 'success', 1500); }
async function reloadResults() {
  if (!(await persist(false))) return;
  const c = counts.value;
  app.toast(`Reloaded — ${c.done ?? 0} done, ${c.failed ?? 0} failed, ${(c.pending ?? 0) + (c.review ?? 0)} to go.`, 'info', 3000);
}

// ── Settings (Scene + Identity cards) ───────────────────────────────────────
function setSetting<K extends SettingKey>(k: K, v: EnhanceConfig[K]) {
  ensureEnhance()[k] = v;
  local.settings.add(k);
  edited();
}
function onMaxAttempts(e: Event) {
  const n = Math.round(Number((e.target as HTMLInputElement).value));
  const v = Number.isFinite(n) ? Math.min(MAX_ATTEMPTS_LIMIT, Math.max(1, n)) : 3;
  (e.target as HTMLInputElement).value = String(v);
  setSetting('maxAttempts', v);
}
const identityIsDefault = computed(() => (enh.value?.identityText ?? '') === DEFAULT_IDENTITY_TEXT);

// ── Queue (photo grid) ──────────────────────────────────────────────────────
function newItem(filename: string): EnhanceItem {
  return { filename, status: 'pending', attempts: [], updatedAt: new Date().toISOString() };
}
function addToQueue(names: string[]) {
  const e = ensureEnhance();
  for (const n of names) {
    if (itemsByName.value.has(n)) continue;
    e.items.push(newItem(n));
    local.removes.delete(n); local.adds.add(n);
  }
  edited();
}
function removeFromQueue(names: string[]) {
  const e = ensureEnhance();
  const drop = new Set(names);
  e.items = e.items.filter((i) => !drop.has(i.filename));
  for (const n of names) { local.adds.delete(n); local.removes.add(n); }
  edited();
}
/** Unqueueing forgets the item's attempts in the queue (files on disk stay) — ask first. */
function confirmDrop(items: EnhanceItem[]): boolean {
  const withWork = items.filter((i) => i.attempts.length || i.resultPath).length;
  // eslint-disable-next-line no-alert
  return !withWork || window.confirm(`Remove ${withWork} photo${withWork === 1 ? '' : 's'} with generated results from the queue? Their files in "enhanced/" stay on disk.`);
}
function toggle(rec: ImageRecord) {
  const it = itemsByName.value.get(rec.relativePath);
  if (!it) addToQueue([rec.relativePath]);
  else if (confirmDrop([it])) removeFromQueue([rec.relativePath]);
}
function selectAll() { addToQueue(photos.value.map((r) => r.relativePath)); }
function selectNone() {
  const items = enh.value?.items ?? [];
  if (items.length && confirmDrop(items)) removeFromQueue(items.map((i) => i.filename));
}

// ── Thumbnails (lazy: loaded when a tile scrolls into view) ─────────────────
const thumbs = reactive<Record<string, string>>({});
const finals = reactive<Record<string, string>>({});
/** Bumped after every reload/merge so a re-composited final.jpg is re-read. */
const finalNonce = ref(0);
const absOf = (rel: string) => `${project.meta?.sourceFolder ?? ''}/${rel}`;
async function thumbUrl(abs: string, size = 240): Promise<string> {
  return window.pebble.readImageBase64(await window.pebble.generateThumbnail(abs, size));
}

const thumbQueue: string[] = [];
let thumbWorkers = 0;
function pumpThumbs() {
  while (thumbWorkers < 4 && thumbQueue.length) {
    const rel = thumbQueue.shift()!;
    if (thumbs[rel]) continue;
    const rec = project.images.find((r) => r.relativePath === rel);
    thumbWorkers += 1;
    void thumbUrl(rec?.absolutePath || absOf(rel))
      .then((u) => { thumbs[rel] = u; }, () => { thumbs[rel] = ''; })
      .finally(() => { thumbWorkers -= 1; pumpThumbs(); });
  }
}
let io: IntersectionObserver | null = null;
function tileRef(el: Element | ComponentPublicInstance | null, rel: string) {
  if (!(el instanceof HTMLElement) || !io || el.dataset.rel) return;
  el.dataset.rel = rel;
  io.observe(el);
}
function onIntersect(entries: IntersectionObserverEntry[]) {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    const el = en.target as HTMLElement;
    io?.unobserve(el);
    const rel = el.dataset.rel;
    if (rel && !(rel in thumbs)) thumbQueue.push(rel);
  }
  pumpThumbs();
}

/** Final thumbnails for `done` items (few — loaded eagerly, re-read after reloads). */
watch([() => (enh.value?.items ?? []).map((i) => `${i.status}|${i.resultPath ?? ''}`).join(','), finalNonce], async () => {
  const nonce = finalNonce.value;
  for (const it of enh.value?.items ?? []) {
    if (it.status !== 'done' || !it.resultPath) continue;
    const key = `${it.filename}#${nonce}`;
    if (finals[key] !== undefined) continue;
    finals[key] = '';
    // eslint-disable-next-line no-await-in-loop
    try { finals[key] = await thumbUrl(absOf(it.resultPath), 160); } catch { /* missing file → no thumb */ }
  }
}, { immediate: true });
const finalThumb = (it: EnhanceItem) => finals[`${it.filename}#${finalNonce.value}`] || '';
function revealFinal(it: EnhanceItem) { if (it.resultPath) void window.pebble.revealInExplorer(absOf(it.resultPath)); }

// ── Image API (provider card) ───────────────────────────────────────────────
const form = reactive<{ provider: AiProviderKind; apiKey: string; model: string; baseUrl: string; size: string; quality: string }>({
  provider: 'openai', apiKey: '', model: PROVIDERS.openai.model, baseUrl: PROVIDERS.openai.baseUrl, size: PROVIDERS.openai.size, quality: PROVIDERS.openai.quality,
});
const providerStatus = ref<AiProviderStatus | null>(null);
const testResult = ref<AiProviderTestResult | null>(null);
const showKey = ref(false);
const showAdvanced = ref(false);
const savingProvider = ref(false);
const testingProvider = ref(false);
const confirmClear = ref(false);
const def = computed(() => PROVIDERS[form.provider]);
const providerOptions = PROVIDER_KINDS.map((k) => ({ value: k, label: PROVIDERS[k].label }));

/** Switching provider: replace values that were still the old provider's defaults. */
watch(() => form.provider, (now, before) => {
  if (!before || now === before) return;
  const a = PROVIDERS[before]; const b = PROVIDERS[now];
  if (!form.model || form.model === a.model) form.model = b.model;
  if (!form.baseUrl || form.baseUrl === a.baseUrl) form.baseUrl = b.baseUrl;
  if (form.size === a.size) form.size = b.size;
  if (form.quality === a.quality) form.quality = b.quality;
  testResult.value = null;
});

async function loadProviderForm() {
  try {
    providerStatus.value = await window.pebble.getAiProviderStatus();
    const cfg = await window.pebble.getAiProviderConfig();
    if (cfg) {
      form.provider = cfg.provider;
      // (the provider watcher runs after this tick — assign the rest after it)
      await Promise.resolve();
      Object.assign(form, { apiKey: cfg.apiKey ?? '', model: cfg.model ?? '', baseUrl: cfg.baseUrl ?? '', size: cfg.size ?? '', quality: cfg.quality ?? '' });
    }
  } catch (e) { app.toast(`Could not read the image API settings: ${errText(e)}`, 'error', 5000); }
}
function formConfig(): AiProviderConfig {
  return {
    provider: form.provider, apiKey: form.apiKey.trim(), model: form.model.trim(),
    baseUrl: form.baseUrl.trim() || undefined, size: form.size.trim(), quality: form.quality.trim(),
  };
}
async function saveProvider() {
  savingProvider.value = true;
  try {
    providerStatus.value = await window.pebble.saveAiProviderConfig(formConfig());
    app.toast('Image API settings saved.', 'success', 2000);
  } catch (e) { app.toast(errText(e), 'error', 5000); }
  finally { savingProvider.value = false; }
}
async function testProviderNow() {
  testingProvider.value = true; testResult.value = null;
  try { testResult.value = await window.pebble.testAiProvider(formConfig()); }
  catch (e) { testResult.value = { ok: false, message: errText(e) }; }
  finally { testingProvider.value = false; }
}
async function clearProvider() {
  confirmClear.value = false;
  try {
    await window.pebble.clearAiProviderConfig();
    providerStatus.value = await window.pebble.getAiProviderStatus();
    form.apiKey = ''; testResult.value = null;
    app.toast('Image API settings removed.', 'info', 2000);
  } catch (e) { app.toast(errText(e), 'error', 5000); }
}

// ── Agent hand-off (MCP config + the Enhance prompt) ────────────────────────
const mcp = ref<McpConnectInfo | null>(null);
async function loadMcpInfo() {
  if (mcp.value) return;
  try { mcp.value = await window.pebble.getMcpConnectInfo(); }
  catch (e) { app.toast(`Could not load the MCP config: ${errText(e)}`, 'error'); }
}
const sceneText = computed(() => (enh.value?.scenePrompt ?? '').trim());
const prompt = computed(() => {
  const t = mcp.value?.promptEnhance ?? '';
  const e = enh.value;
  const fill: Record<string, string> = {
    // The .pebble file name is what the server matches directly (meta.name can
    // collide across projects); fall back to meta.name for an unsaved project.
    '{{PROJECT}}': (project.savePath ? project.savePath.split(/[\\/]/).pop()?.replace(/\.pebble$/i, '') : null) || project.meta?.name || 'my project',
    '{{SCENE}}': sceneText.value || '(describe it in the Scene box first)',
    '{{IDENTITY}}': (e?.identityText ?? DEFAULT_IDENTITY_TEXT).trim(),
    '{{COUNT}}': String(queuedCount.value),
    '{{MAX_ATTEMPTS}}': String(e?.maxAttempts ?? 3),
  };
  // Function replacers: user text may contain `$&`-style sequences.
  return Object.entries(fill).reduce((s, [k, v]) => s.replaceAll(k, () => v), t);
});
const promptBlocker = computed(() => {
  if (!queuedCount.value) return 'Tick at least one photo to queue it first.';
  if (!sceneText.value) return 'Describe the scene you want first.';
  return '';
});

async function copy(text: string, label: string) {
  try {
    if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      document.execCommand('copy'); document.body.removeChild(ta);
    }
    app.toast(`${label} copied to clipboard`, 'success', 1800);
  } catch { app.toast('Copy failed — select and copy manually', 'error'); }
}
async function copyPrompt() {
  if (promptBlocker.value) return;
  if (project.dirty) await persist(false); // the agent must read the queue the user sees
  await copy(prompt.value, 'Enhance prompt');
}

// ── Navigation ──────────────────────────────────────────────────────────────
// Always merge from disk before leaving: the agent may have registered finals since the
// last reload, and the editor's whole-project autosave would otherwise overwrite them.
async function goHome() { await persist(false); void router.push('/'); }
async function openInEditor() { await persist(false); void router.push('/editor'); }
function backToStart() { void refreshSaved(); phase.value = 'start'; }

onMounted(async () => {
  io = new IntersectionObserver(onIntersect, { rootMargin: '300px' });
  if (route.query.from === 'editor' && hasRealProject.value) { await enterStudio(); return; }
  await refreshSaved();
});
onBeforeUnmount(() => {
  io?.disconnect(); io = null;
  if (phase.value === 'studio' && project.dirty) void persist(false);
});
</script>

<template>
  <div class="h-full w-full flex flex-col bg-pebble-bg">
    <!-- ─────────────────────────── START PHASE ─────────────────────────── -->
    <template v-if="phase === 'start'">
      <header class="pa-topbar">
        <AppIconButton icon="home" label="Back to home" @click="router.push('/')" />
        <span class="font-semibold">AI Enhance</span>
        <span class="text-xs text-pebble-text-dim">Identity-safe re-imagining</span>
      </header>

      <section class="flex-1 overflow-auto">
        <div class="mx-auto w-full max-w-[1100px] px-10 py-8">
          <AppEmptyState icon="sparkles" title="Pick the photos to enhance"
                         text="Your AI agent re-imagines the scene, wardrobe and lighting through your own image API — then the app puts each person's real face back, skin tone matched.">
            <AppButton size="lg" icon="folder" :disabled="opening" @click="openFolder">{{ opening ? 'Opening…' : 'Open a folder…' }}</AppButton>
            <template #hint>
              A folder that already has an album reuses it; otherwise a project is created and saved for it.
              Results are written to an <code>enhanced/</code> folder next to your photos.
            </template>
          </AppEmptyState>

          <div class="flex items-center gap-2 mt-4 mb-3">
            <h2 class="text-base font-semibold">Or use a saved project</h2>
            <span v-if="saved.length" class="text-xs text-pebble-text-dim tabular-nums">{{ saved.length }}</span>
            <AppIconButton class="ml-auto" icon="rotate-cw" label="Refresh the list" size="sm" @click="refreshSaved" />
          </div>
          <div v-if="loadingSaved" class="rounded-lg border border-pebble-border bg-pebble-surface py-8 text-center text-sm text-pebble-text-dim">Loading projects…</div>
          <div v-else-if="saved.length" class="grid grid-cols-2 xl:grid-cols-3 gap-3">
            <button v-for="r in saved" :key="r.path" type="button" :disabled="opening"
                    class="group flex items-center gap-3 text-left rounded-lg bg-pebble-surface border border-pebble-border p-3 transition-colors hover:bg-pebble-hover hover:border-pebble-border-strong disabled:opacity-50"
                    :title="r.path" @click="openSaved(r.path)">
              <div class="h-9 w-9 shrink-0 rounded-md bg-pebble-surface-2 border border-pebble-border grid place-items-center group-hover:text-pebble-accent-soft">
                <AppIcon name="book" :size="17" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="text-sm font-medium truncate">{{ r.name }}</div>
                <div class="text-xs text-pebble-text-dim truncate">{{ r.imageCount }} photos · {{ new Date(r.lastOpened).toLocaleDateString() }}</div>
              </div>
              <AppIcon name="chevron-right" :size="14" class="text-pebble-text-off group-hover:text-pebble-text" />
            </button>
          </div>
          <p v-else class="pa-hint">No saved projects yet — open a folder above.</p>
        </div>
      </section>
    </template>

    <!-- ─────────────────────────── STUDIO PHASE ────────────────────────── -->
    <template v-else-if="enh">
      <header class="pa-topbar">
        <AppIconButton icon="home" label="Back to home" @click="goHome" />
        <div class="flex items-baseline gap-2 min-w-0 ml-1">
          <span class="font-semibold truncate max-w-[22rem]" :title="project.savePath ?? ''">AI Enhance — {{ project.meta?.name }}</span>
          <span class="text-xs shrink-0" :class="project.saveState === 'saved' ? 'text-pebble-success' : project.saveState === 'error' ? 'text-pebble-danger' : project.dirty ? 'text-pebble-warning' : 'text-pebble-text-dim'">
            {{ project.saveState === 'saving' ? 'Saving…' : project.saveState === 'saved' ? 'Saved' : project.saveState === 'error' ? 'Save failed' : project.dirty ? 'Unsaved' : '' }}
          </span>
        </div>
        <div class="flex-1" />
        <AppButton size="md" variant="ghost" icon="folder" title="Work on a different folder or project" @click="backToStart"><span class="hidden xl:inline">Other project…</span></AppButton>
        <AppButton size="md" variant="ghost" icon="rotate-cw" :disabled="syncing" title="Re-read the project file to show what your agent has done" @click="reloadResults">Reload results</AppButton>
        <AppButton size="md" variant="secondary" icon="book" title="Open this project in the album editor" @click="openInEditor">Open in editor</AppButton>
        <AppButton size="md" variant="secondary" icon="save" :disabled="syncing" title="Save the queue and settings now" @click="saveNow">Save</AppButton>
      </header>

      <div class="flex-1 flex min-h-0">
        <!-- Left: photo grid (checkbox = queued) -->
        <section class="flex-1 flex flex-col min-w-0">
          <div class="h-10 shrink-0 flex items-center gap-2 px-3 bg-pebble-surface border-b border-pebble-border">
            <span class="pa-section mr-1">Photos</span>
            <div class="w-44"><AppSegmented v-model="show" :options="[{ value: 'all', label: `All ${photos.length}` }, { value: 'queued', label: `Queued ${queuedCount}` }]" /></div>
            <button type="button" class="pa-btn !h-7" @click="selectAll">Select all</button>
            <button type="button" class="pa-btn !h-7" :disabled="!queuedCount" @click="selectNone">None</button>
            <span class="flex-1 min-w-0 text-right pa-hint truncate">
              <template v-if="queuedCount">{{ counts.done ?? 0 }} done · {{ counts.review ?? 0 }} in review · {{ counts.failed ?? 0 }} failed · {{ counts.pending ?? 0 }} pending</template>
              <template v-else>Tick the photos you want the agent to enhance</template>
            </span>
          </div>

          <div class="flex-1 overflow-auto p-3">
            <AppEmptyState v-if="!shown.length" :icon="show === 'queued' ? 'check-circle' : 'images'"
                           :title="show === 'queued' ? 'Nothing queued yet' : 'No photos in this project'"
                           :text="show === 'queued' ? 'Switch to All and tick the photos to enhance.' : 'Add photos to the folder, then reopen it here.'" />
            <div v-else class="grid gap-3" style="grid-template-columns: repeat(auto-fill, minmax(150px, 1fr))">
              <div v-for="rec in shown" :key="rec.relativePath" :ref="(el) => tileRef(el, rec.relativePath)"
                   class="rounded-lg bg-pebble-surface border overflow-hidden transition-colors"
                   :class="itemsByName.has(rec.relativePath) ? 'border-pebble-accent ring-1 ring-pebble-accent' : 'border-pebble-border hover:border-pebble-border-strong'">
                <button type="button" class="relative block w-full aspect-square bg-pebble-hover"
                        :title="`${rec.relativePath} — click to ${itemsByName.has(rec.relativePath) ? 'remove from' : 'add to'} the queue`"
                        @click="toggle(rec)">
                  <img v-if="thumbs[rec.relativePath]" :src="thumbs[rec.relativePath]" class="w-full h-full object-cover" alt="" draggable="false" />
                  <AppIcon v-else name="image" :size="24" :stroke="1.5" class="absolute inset-0 m-auto text-pebble-text-off" />
                  <span class="absolute top-1.5 left-1.5 h-5 w-5 rounded grid place-items-center bg-black/55">
                    <input type="checkbox" :checked="itemsByName.has(rec.relativePath)" tabindex="-1" class="pointer-events-none" aria-hidden="true" />
                  </span>
                  <span v-if="itemsByName.get(rec.relativePath)" class="absolute bottom-1.5 left-1.5 px-1.5 py-0.5 rounded text-2xs font-medium backdrop-blur-sm"
                        :class="STATUS_STYLE[itemsByName.get(rec.relativePath)!.status].cls">
                    {{ STATUS_STYLE[itemsByName.get(rec.relativePath)!.status].label }}<template v-if="itemsByName.get(rec.relativePath)!.attempts.length"> · {{ itemsByName.get(rec.relativePath)!.attempts.length }}</template>
                  </span>
                </button>
                <div class="px-2 py-1.5">
                  <div class="text-2xs truncate text-pebble-text-dim" :title="rec.relativePath">{{ rec.filename }}</div>
                  <div v-if="itemsByName.get(rec.relativePath)?.note" class="pa-hint truncate" :title="itemsByName.get(rec.relativePath)!.note">{{ itemsByName.get(rec.relativePath)!.note }}</div>
                  <!-- Done: the composited final + Show in folder -->
                  <div v-if="itemsByName.get(rec.relativePath)?.status === 'done' && itemsByName.get(rec.relativePath)!.resultPath" class="mt-1.5 flex items-center gap-1.5">
                    <div class="h-10 w-10 shrink-0 rounded overflow-hidden bg-pebble-hover border border-pebble-border">
                      <img v-if="finalThumb(itemsByName.get(rec.relativePath)!)" :src="finalThumb(itemsByName.get(rec.relativePath)!)" class="w-full h-full object-cover" alt="Final" />
                    </div>
                    <span class="flex-1 min-w-0 text-2xs text-pebble-success truncate" :title="itemsByName.get(rec.relativePath)!.resultPath">final</span>
                    <AppIconButton icon="folder" size="sm" label="Show in folder" placement="top" @click="revealFinal(itemsByName.get(rec.relativePath)!)" />
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- Right: Scene · Identity · Image API · steps -->
        <aside class="w-[400px] shrink-0 bg-pebble-surface border-l border-pebble-border overflow-y-auto">
          <div class="p-4 space-y-5">
            <!-- (1) Scene -->
            <section class="space-y-2">
              <div class="pa-section">Scene</div>
              <textarea class="pa-input w-full min-h-[84px] resize-y" :value="enh.scenePrompt"
                        placeholder="e.g. a studio portrait in a navy suit, soft window light, warm grey backdrop"
                        @input="setSetting('scenePrompt', ($event.target as HTMLTextAreaElement).value)" />
              <p class="pa-hint">What should change: setting, wardrobe, lighting, mood. The agent adapts it to each photo.</p>
            </section>

            <!-- (2) Identity -->
            <section class="space-y-2">
              <div class="flex items-center">
                <span class="pa-section">Identity</span>
                <button type="button" class="ml-auto text-2xs text-pebble-accent-soft hover:underline disabled:opacity-40 disabled:no-underline"
                        :disabled="identityIsDefault" @click="setSetting('identityText', DEFAULT_IDENTITY_TEXT)">Reset to default</button>
              </div>
              <textarea class="pa-input w-full min-h-[120px] resize-y text-xs leading-relaxed" :value="enh.identityText"
                        @input="setSetting('identityText', ($event.target as HTMLTextAreaElement).value)" />
              <label class="flex items-start gap-2 text-xs cursor-pointer">
                <input type="checkbox" class="mt-0.5" :checked="enh.keepFace" @change="setSetting('keepFace', ($event.target as HTMLInputElement).checked)" />
                <span>Keep the face pixels during generation (inpainting) when the provider supports it</span>
              </label>
              <label class="flex items-center gap-2 text-xs">
                <span class="pa-label">Max attempts per photo</span>
                <input type="number" min="1" :max="MAX_ATTEMPTS_LIMIT" step="1" class="pa-input w-16 !py-1 tabular-nums" :value="enh.maxAttempts" @change="onMaxAttempts" />
              </label>
            </section>

            <!-- (3) Image API -->
            <section class="space-y-2">
              <div class="pa-section">Image API</div>
              <label class="block space-y-1">
                <span class="pa-label">Provider</span>
                <select v-model="form.provider" class="pa-input w-full">
                  <option v-for="o in providerOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
                </select>
              </label>
              <label class="block space-y-1">
                <span class="pa-label">Model</span>
                <input v-model="form.model" class="pa-input w-full" :placeholder="def.model || 'model id'" spellcheck="false" />
              </label>
              <label v-if="form.provider === 'openai_compatible'" class="block space-y-1">
                <span class="pa-label">Base URL</span>
                <input v-model="form.baseUrl" class="pa-input w-full font-mono text-xs" placeholder="https://your-host/v1" spellcheck="false" />
              </label>
              <label v-if="form.provider !== 'mock'" class="block space-y-1">
                <span class="pa-label">API key</span>
                <span class="flex items-center gap-1">
                  <input v-model="form.apiKey" :type="showKey ? 'text' : 'password'" class="pa-input flex-1 min-w-0 font-mono text-xs" autocomplete="off" spellcheck="false" placeholder="Paste your key" />
                  <AppIconButton :icon="showKey ? 'eye-off' : 'eye'" :label="showKey ? 'Hide key' : 'Show key'" size="sm" @click="showKey = !showKey" />
                </span>
              </label>
              <p v-else class="pa-hint">The mock provider runs offline and needs no key — for testing the loop.</p>

              <button type="button" class="flex items-center gap-1 text-2xs text-pebble-text-dim hover:text-pebble-text" @click="showAdvanced = !showAdvanced">
                <AppIcon :name="showAdvanced ? 'chevron-down' : 'chevron-right'" :size="13" />Advanced
              </button>
              <div v-if="showAdvanced" class="space-y-2 pl-4">
                <label v-if="form.provider !== 'openai_compatible'" class="block space-y-1">
                  <span class="pa-label">Base URL</span>
                  <input v-model="form.baseUrl" class="pa-input w-full font-mono text-xs" :placeholder="def.baseUrl || '(not used)'" spellcheck="false" />
                </label>
                <div class="flex gap-2">
                  <label class="flex-1 space-y-1"><span class="pa-label">Size</span><input v-model="form.size" class="pa-input w-full" :placeholder="def.size || 'auto'" spellcheck="false" /></label>
                  <label class="flex-1 space-y-1"><span class="pa-label">Quality</span><input v-model="form.quality" class="pa-input w-full" :placeholder="def.quality || 'default'" spellcheck="false" /></label>
                </div>
              </div>

              <div class="flex items-center gap-1.5 pt-1">
                <AppButton size="sm" icon="save" :disabled="savingProvider" @click="saveProvider">{{ savingProvider ? 'Saving…' : 'Save' }}</AppButton>
                <AppButton size="sm" variant="secondary" :disabled="testingProvider" @click="testProviderNow">{{ testingProvider ? 'Testing…' : 'Test connection' }}</AppButton>
                <AppButton size="sm" variant="ghost" icon="trash" :disabled="!providerStatus?.configured" @click="confirmClear = true">Clear</AppButton>
              </div>
              <p v-if="testResult" class="flex items-start gap-1.5 text-xs" :class="testResult.ok ? 'text-pebble-success' : 'text-pebble-danger'">
                <AppIcon :name="testResult.ok ? 'check-circle' : 'alert'" :size="14" class="mt-px shrink-0" />
                <span>{{ testResult.message }}<span v-if="testResult.latencyMs != null" class="text-pebble-text-dim"> · {{ testResult.latencyMs }} ms</span></span>
              </p>
              <p class="pa-hint">
                <template v-if="providerStatus?.configured">
                  Saved: <b class="text-pebble-text">{{ PROVIDERS[providerStatus.provider!]?.label ?? providerStatus.provider }}</b> · {{ providerStatus.model }}<template v-if="providerStatus.keyHint"> · key {{ providerStatus.keyHint }}</template>
                  · {{ providerStatus.supportsMask ? 'face mask supported' : 'no mask — identity text only' }}
                </template>
                <template v-else>No image API saved yet.</template>
                <br /><span class="font-mono break-all">{{ providerStatus?.file }}</span>
              </p>
              <p class="flex items-start gap-1.5 text-xs text-pebble-warning">
                <AppIcon name="info" :size="14" class="mt-px shrink-0" />
                <span>Queued photos are uploaded to this provider when the agent runs enhance_generate. Nothing is sent until then.</span>
              </p>
            </section>

            <!-- Hand-off: 1-2-3 -->
            <section class="space-y-3 border-t border-pebble-border pt-4">
              <div class="pa-section">Run it with your agent</div>
              <div class="flex items-start gap-2">
                <span class="pa-kbd shrink-0">1</span>
                <div class="flex-1 min-w-0 text-xs">
                  <div class="flex items-center gap-2">
                    <span class="flex-1">Copy MCP config <span class="text-pebble-text-dim">(if your agent isn't connected yet)</span></span>
                    <AppButton size="sm" variant="secondary" icon="copy" :disabled="!mcp" @click="mcp && copy(mcp.configJson, 'MCP config')">Copy</AppButton>
                  </div>
                  <p class="pa-hint mt-1">Paste it into your agent's MCP settings, then restart the agent so it picks up the server. Requires <b>Node.js</b>.</p>
                </div>
              </div>
              <div class="flex items-start gap-2">
                <span class="pa-kbd shrink-0">2</span>
                <div class="flex-1 min-w-0 text-xs">
                  <div class="flex items-center gap-2">
                    <span class="flex-1">Copy the Enhance prompt</span>
                    <AppButton size="sm" icon="copy" :disabled="!!promptBlocker || !mcp" :title="promptBlocker || 'Copy the prompt for your agent'" @click="copyPrompt">Copy prompt</AppButton>
                  </div>
                  <p v-if="promptBlocker" class="pa-hint mt-1 text-pebble-warning">{{ promptBlocker }}</p>
                </div>
              </div>
              <pre class="pa-code max-h-56 overflow-auto whitespace-pre-wrap text-2xs leading-relaxed select-text">{{ prompt || 'Loading…' }}</pre>
              <div class="flex items-start gap-2">
                <span class="pa-kbd shrink-0">3</span>
                <div class="flex-1 min-w-0 text-xs">
                  <div class="flex items-center gap-2">
                    <span class="flex-1">Paste it into your agent</span>
                    <AppButton size="sm" variant="ghost" icon="rotate-cw" :disabled="syncing" @click="reloadResults">Reload results</AppButton>
                  </div>
                  <p class="pa-hint mt-1">The agent works on the saved project file. Reload to see its results; finals land in <code>enhanced/</code> and are added to the album's photos.</p>
                </div>
              </div>
            </section>
          </div>
        </aside>
      </div>
    </template>

    <AppModal :open="confirmClear" title="Remove the image API settings?" width="420px" @update:open="(v) => { if (!v) confirmClear = false; }">
      <p class="text-sm">This deletes <span class="font-mono text-xs break-all">{{ providerStatus?.file }}</span>, including the API key. The agent can't generate images until you save new settings.</p>
      <template #footer>
        <AppButton variant="ghost" @click="confirmClear = false">Cancel</AppButton>
        <AppButton variant="danger" icon="trash" @click="clearProvider">Remove</AppButton>
      </template>
    </AppModal>
  </div>
</template>
