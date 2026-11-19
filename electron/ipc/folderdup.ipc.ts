/**
 * folderdup.ipc.ts
 * -----------------------------------------------------------------------------
 * Duplicate FOLDER + FILE finder across one or many roots (even whole disks).
 * Metadata-only (name / date / size — never content hashing), built to scale to
 * ~1–2M files with the techniques backup/dedupe tools use:
 *
 *   • Scan (I/O)      — one concurrent directory walk → an in-memory snapshot
 *                       of {dir → mtime, direct files}. Persisted to disk
 *                       (v8.serialize) keyed by the chosen roots, so reopening
 *                       resumes from cache + an incremental sync.
 *   • Analyze (CPU)   — inverted index (fileKey → folders) + candidate-pair
 *                       counting with a HOT-KEY CAP (never O(n²) over folders),
 *                       then a bottom-up ROLL-UP so a duplicated whole *tree*
 *                       surfaces as one top-level pair. Pure/in-memory → the
 *                       similarity slider and match-mode re-filter instantly
 *                       (no rescan). All pairs ≥30% are emitted once.
 *   • Sync (I/O-lite) — re-walk reusing every directory whose mtime is
 *                       unchanged (skip per-file stat), re-analyze in memory.
 *
 * The engine keeps ONE session snapshot in module state; the renderer does the
 * threshold filtering + parent-suppression (see FolderDupView).
 */
import { ipcMain, app } from 'electron';
import type { WebContents } from 'electron';
import { promises as fs } from 'node:fs';
import fss from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import v8 from 'node:v8';
import type {
  DupScanOptions, DupMatchBy, DupProgress, DupReport, DupFolderInfo, DupFolderPair, DupFileGroup,
} from '../../src/types/ipc.types';

// ── Ignore lists ────────────────────────────────────────────────────────────
const JUNK_FILES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.localized', 'Icon\r', 'Icon']);
const SYSTEM_DIRS = new Set([
  '.git', 'node_modules', '.Trash', '.Trashes', '.Spotlight-V100', '.fseventsd',
  '$RECYCLE.BIN', 'System Volume Information', '.TemporaryItems', '.DocumentRevisions-V100',
  '.PKInstallSandboxManager', '.hotfiles.btree', '.vol', '.cache', '.npm', '.git-crypt',
]);

// ── Snapshot model (module session state) ────────────────────────────────────
interface FileEntry { name: string; size: number; mtimeMs: number }
interface DirRec {
  id: number;
  path: string;
  parent: number;   // −1 for a selected root
  root: number;     // index into roots[]
  depth: number;
  mtimeMs: number;
  files: FileEntry[]; // direct, non-junk files only
}
interface Snapshot { roots: string[]; opts: DupScanOptions; dirs: DirRec[] }

let session: Snapshot | null = null;

// ── Pair id packing (two folder ids in one JS-safe integer) ──────────────────
const PACK = 4194304; // 2^22 → supports up to ~4M folders, product stays < 2^53
const packPair = (a: number, b: number) => (a < b ? a * PACK + b : b * PACK + a);
const unpackA = (p: number) => Math.floor(p / PACK);
const unpackB = (p: number) => p % PACK;

function rootsCacheKey(roots: string[]): string {
  const norm = roots.map((r) => path.resolve(r)).sort();
  return crypto.createHash('sha1').update(norm.join('\n')).digest('hex').slice(0, 16);
}
function cacheDir(): string { return path.join(app.getPath('home'), 'PebbleAlbum', 'cache'); }
function cachePath(roots: string[]): string { return path.join(cacheDir(), `folderdup-${rootsCacheKey(roots)}.bin`); }

async function loadCache(roots: string[]): Promise<Snapshot | null> {
  try {
    const buf = await fs.readFile(cachePath(roots));
    const snap = v8.deserialize(buf) as Snapshot;
    if (snap && Array.isArray(snap.dirs) && snap.dirs.length) return snap;
  } catch { /* no/invalid cache */ }
  return null;
}
async function saveCache(snap: Snapshot): Promise<void> {
  try {
    await fs.mkdir(cacheDir(), { recursive: true });
    const p = cachePath(snap.roots);
    const tmp = `${p}.tmp`;
    await fs.writeFile(tmp, v8.serialize(snap));
    await fs.rename(tmp, p);
  } catch { /* best-effort cache */ }
}

// ── Walk ─────────────────────────────────────────────────────────────────────
type Progress = (p: Partial<DupProgress>) => void;

/**
 * Concurrent directory walk building the dir list. When `prev` (a path→DirRec
 * map from a previous snapshot) is supplied, a directory whose mtime is
 * unchanged reuses its cached file entries and we DON'T stat its files — the
 * incremental-sync fast path.
 */
async function walk(
  roots: string[], opts: DupScanOptions, emit: Progress, prev?: Map<string, DirRec>,
): Promise<{ dirs: DirRec[]; reusedDirs: number }> {
  const dirs: DirRec[] = [];
  const push = (rec: Omit<DirRec, 'id'>): number => { const id = dirs.length; dirs.push({ id, ...rec }); return id; };
  let reusedDirs = 0;
  let scanned = 0; let fileCount = 0;
  const CONCURRENCY = 48;

  interface Job { dirId: number; abs: string; root: number; depth: number }

  // Seed the frontier with the selected roots.
  let frontier: Job[] = [];
  for (let r = 0; r < roots.length; r += 1) {
    const abs = path.resolve(roots[r]);
    let mtimeMs = 0;
    try { mtimeMs = (await fs.stat(abs)).mtimeMs; } catch { continue; } // eslint-disable-line no-await-in-loop
    const id = push({ path: abs, parent: -1, root: r, depth: 0, mtimeMs, files: [] });
    frontier.push({ dirId: id, abs, root: r, depth: 0 });
  }

  /** Expand one directory: record its files, return its child jobs. */
  async function expand(job: Job): Promise<Job[]> {
    const rec = dirs[job.dirId];
    const cached = prev?.get(job.abs);
    let entries: fss.Dirent[];
    try { entries = await fs.readdir(job.abs, { withFileTypes: true }); } catch { return []; }

    const reuseFiles = !!cached && cached.mtimeMs === rec.mtimeMs;
    if (reuseFiles) { rec.files = cached!.files; reusedDirs += 1; fileCount += rec.files.length; }

    const children: Job[] = [];
    for (const ent of entries) {
      const name = ent.name;
      const childAbs = path.join(job.abs, name);
      if (ent.isDirectory()) {
        if (opts.skipSystemDirs && SYSTEM_DIRS.has(name)) continue;
        let cm = 0;
        try { cm = (await fs.stat(childAbs)).mtimeMs; } catch { continue; } // eslint-disable-line no-await-in-loop
        const cid = push({ path: childAbs, parent: job.dirId, root: job.root, depth: job.depth + 1, mtimeMs: cm, files: [] });
        children.push({ dirId: cid, abs: childAbs, root: job.root, depth: job.depth + 1 });
      } else if (ent.isFile() && !reuseFiles) {
        if (JUNK_FILES.has(name)) continue;
        try {
          const st = await fs.stat(childAbs); // eslint-disable-line no-await-in-loop
          rec.files.push({ name, size: st.size, mtimeMs: st.mtimeMs });
          fileCount += 1;
        } catch { /* vanished */ }
      }
    }
    scanned += 1;
    if (scanned % 200 === 0) emit({ phase: 'scan', dirs: scanned, files: fileCount, reusedDirs, currentPath: job.abs });
    return children;
  }

  // Breadth-first, expanding each level with bounded concurrency. `expand`
  // pushes child records synchronously, so `dirs` ids stay stable/ordered.
  while (frontier.length) {
    const next: Job[] = [];
    for (let i = 0; i < frontier.length; i += CONCURRENCY) {
      const batch = frontier.slice(i, i + CONCURRENCY);
      // eslint-disable-next-line no-await-in-loop
      const results = await Promise.all(batch.map(expand));
      for (const kids of results) next.push(...kids);
    }
    frontier = next;
  }

  emit({ phase: 'scan', dirs: scanned, files: fileCount, reusedDirs, currentPath: '' });
  return { dirs, reusedDirs };
}

// ── Analyze (pure, in-memory) ────────────────────────────────────────────────
const HOT_KEY_CAP = 256; // keys present in > this many folders are skipped for pairing
const PAIRS_EMIT_CAP = 20000;
const FILEGROUPS_EMIT_CAP = 20000;
const LOCS_CAP = 60;

function keyOf(f: FileEntry, by: DupMatchBy): string {
  const n = f.name.toLowerCase();
  const d = Math.round(f.mtimeMs / 2000); // 2s bucket (FAT/exFAT granularity tolerant)
  switch (by) {
    case 'name': return n;
    case 'name_size': return `${n} ${f.size}`;
    case 'name_date_size': return `${n} ${d} ${f.size}`;
    case 'name_date':
    default: return `${n} ${d}`;
  }
}

function analyze(snap: Snapshot, emit: Progress): DupReport {
  const t0 = Date.now();
  const dirs = snap.dirs;
  const n = dirs.length;

  // Recursive file counts (subtree), computed deepest-first.
  const order = dirs.map((d) => d.id).sort((a, b) => dirs[b].depth - dirs[a].depth);
  const recFiles = new Float64Array(n);
  for (const id of order) recFiles[id] += dirs[id].files.length;
  for (const id of order) { const p = dirs[id].parent; if (p >= 0) recFiles[p] += recFiles[id]; }

  // Inverted index: fileKey → set of folder ids that directly contain it.
  const index = new Map<string, number[]>();
  for (const d of dirs) {
    for (const f of d.files) {
      const k = keyOf(f, snap.opts.matchBy);
      const arr = index.get(k);
      if (arr) { if (arr[arr.length - 1] !== d.id) arr.push(d.id); } else index.set(k, [d.id]);
    }
  }

  // Direct-pair shared-key counts via posting lists (hot keys skipped).
  const direct = new Map<number, number>();
  let processed = 0;
  for (const folderIds of index.values()) {
    processed += 1;
    if (processed % 5000 === 0) emit({ phase: 'analyze', dirs: n, files: 0, reusedDirs: 0 });
    const list = folderIds.length > 1 ? [...new Set(folderIds)] : folderIds;
    const L = list.length;
    if (L < 2 || L > HOT_KEY_CAP) continue;
    for (let i = 0; i < L; i += 1) {
      for (let j = i + 1; j < L; j += 1) {
        const key = packPair(list[i], list[j]);
        direct.set(key, (direct.get(key) ?? 0) + 1);
      }
    }
  }

  // Roll-up: bubble each pair's shared count into its parent pair, processing
  // strictly deepest depth → shallowest, so a duplicated whole tree becomes one
  // aggregated top-level pair. Pairs CREATED during roll-up (two mid-level
  // folders with no direct shared files, only shared descendants) are added to
  // their own depth bucket so they keep bubbling up — the key to correct
  // folder-of-folder aggregation.
  const rec = new Map<number, number>(direct); // recShared, seeded from direct
  const pairDepth = (p: number) => Math.max(dirs[unpackA(p)].depth, dirs[unpackB(p)].depth);
  const buckets = new Map<number, Set<number>>();
  let maxDepth = 0;
  const bucketAdd = (p: number) => {
    const d = pairDepth(p); if (d > maxDepth) maxDepth = d;
    let s = buckets.get(d); if (!s) { s = new Set(); buckets.set(d, s); }
    s.add(p);
  };
  for (const p of rec.keys()) bucketAdd(p);
  for (let d = maxDepth; d >= 1; d -= 1) {
    const s = buckets.get(d); if (!s) continue;
    for (const p of s) {
      const pa = dirs[unpackA(p)].parent; const pb = dirs[unpackB(p)].parent;
      if (pa < 0 || pb < 0 || pa === pb) continue;
      const parentPair = packPair(pa, pb);
      const had = rec.has(parentPair);
      rec.set(parentPair, (rec.get(parentPair) ?? 0) + (rec.get(p) ?? 0));
      if (!had) bucketAdd(parentPair); // pairDepth(parentPair) < d → processed later this loop
    }
  }

  // Ancestor test (walk the short parent chain).
  const isAncestor = (anc: number, node: number): boolean => {
    let cur = dirs[node].parent;
    while (cur >= 0) { if (cur === anc) return true; cur = dirs[cur].parent; }
    return false;
  };

  // Build emitted pairs (sim ≥ 0.30), excluding ancestor/descendant pairs.
  const pairsAll: DupFolderPair[] = [];
  for (const [p, recShared] of rec) {
    const a = unpackA(p); const b = unpackB(p);
    if (isAncestor(a, b) || isAncestor(b, a)) continue;
    const minRec = Math.min(recFiles[a], recFiles[b]);
    if (minRec <= 0) continue;
    const shared = Math.min(recShared, minRec); // clamp roll-up over-count to ≤100%
    const sim = shared / minRec;
    if (sim < 0.30) continue;
    pairsAll.push({
      a, b, shared: direct.get(p) ?? 0, recShared: shared, sim,
      scope: dirs[a].root === dirs[b].root ? 'within' : 'across',
    });
  }
  pairsAll.sort((x, y) => y.sim - x.sim || y.recShared - x.recShared);
  const pairs = pairsAll.slice(0, PAIRS_EMIT_CAP);

  // Duplicate files: keys present in ≥2 folders (capped list, unbounded total).
  const fgAll: DupFileGroup[] = [];
  for (const [k, folderIds] of index) {
    const list = [...new Set(folderIds)];
    if (list.length < 2) continue;
    // Recover display name/size/mtime from the first folder's matching file.
    let sample: FileEntry | undefined;
    for (const f of dirs[list[0]].files) { if (keyOf(f, snap.opts.matchBy) === k) { sample = f; break; } }
    if (!sample) continue;
    const roots = new Set(list.map((id) => dirs[id].root));
    fgAll.push({
      name: sample.name, size: sample.size, mtime: sample.mtimeMs,
      locs: list.slice(0, LOCS_CAP), total: list.length,
      scope: roots.size > 1 ? 'across' : 'within',
    });
  }
  fgAll.sort((x, y) => y.total - x.total);
  const fileGroups = fgAll.slice(0, FILEGROUPS_EMIT_CAP);

  // Folders table: only folders referenced by emitted pairs/groups + their
  // ancestor chains (needed for the renderer's suppression id-walks).
  const need = new Set<number>();
  const addWithAncestors = (id: number) => { let c = id; while (c >= 0 && !need.has(c)) { need.add(c); c = dirs[c].parent; } };
  for (const pr of pairs) { addWithAncestors(pr.a); addWithAncestors(pr.b); }
  for (const g of fileGroups) for (const id of g.locs) addWithAncestors(id);
  const folders: DupFolderInfo[] = [...need].sort((a, b) => a - b).map((id) => ({
    id, parent: dirs[id].parent, root: dirs[id].root, path: dirs[id].path,
    files: dirs[id].files.length, recFiles: recFiles[id],
  }));

  const totalFiles = dirs.reduce((s, d) => s + d.files.length, 0);
  emit({ phase: 'done', dirs: n, files: totalFiles, reusedDirs: 0 });
  return {
    roots: snap.roots, folders, pairs, fileGroups,
    stats: {
      dirs: n, files: totalFiles, scanMs: 0, analyzeMs: Date.now() - t0,
      reusedDirs: 0, cacheHit: false,
      pairsTotal: pairsAll.length, fileGroupsTotal: fgAll.length,
    },
  };
}

// ── Orchestration ────────────────────────────────────────────────────────────
async function scan(roots: string[], opts: DupScanOptions, sender: WebContents | undefined): Promise<DupReport> {
  const emit: Progress = (p) => { try { sender?.send('folderdup:progress', { phase: 'scan', dirs: 0, files: 0, reusedDirs: 0, ...p }); } catch { /* gone */ } };
  const tScan = Date.now();
  const cached = await loadCache(roots);
  let reusedDirs = 0; let cacheHit = false;
  let dirs: DirRec[];
  if (cached && sameRoots(cached.roots, roots)) {
    // Resume from cache: incremental sync against what's on disk now.
    cacheHit = true;
    const prev = new Map(cached.dirs.map((d) => [d.path, d]));
    ({ dirs, reusedDirs } = await walk(roots, opts, emit, prev));
  } else {
    ({ dirs } = await walk(roots, opts, emit));
  }
  const scanMs = Date.now() - tScan;
  session = { roots: roots.map((r) => path.resolve(r)), opts, dirs };
  void saveCache(session);
  const report = analyze(session, emit);
  report.stats.scanMs = scanMs;
  report.stats.reusedDirs = reusedDirs;
  report.stats.cacheHit = cacheHit;
  return report;
}

function sameRoots(a: string[], b: string[]): boolean {
  const na = a.map((r) => path.resolve(r)).sort();
  const nb = b.map((r) => path.resolve(r)).sort();
  return na.length === nb.length && na.every((r, i) => r === nb[i]);
}

async function sync(sender: WebContents | undefined): Promise<DupReport> {
  if (!session) throw new Error('Nothing to sync — run a scan first.');
  const emit: Progress = (p) => { try { sender?.send('folderdup:progress', { phase: 'scan', dirs: 0, files: 0, reusedDirs: 0, ...p }); } catch { /* gone */ } };
  const tScan = Date.now();
  const prev = new Map(session.dirs.map((d) => [d.path, d]));
  const { dirs, reusedDirs } = await walk(session.roots, session.opts, emit, prev);
  const scanMs = Date.now() - tScan;
  session = { ...session, dirs };
  void saveCache(session);
  const report = analyze(session, emit);
  report.stats.scanMs = scanMs;
  report.stats.reusedDirs = reusedDirs;
  report.stats.cacheHit = true;
  return report;
}

async function setMatchBy(matchBy: DupMatchBy, sender: WebContents | undefined): Promise<DupReport> {
  if (!session) throw new Error('Nothing to re-analyze — run a scan first.');
  const emit: Progress = (p) => { try { sender?.send('folderdup:progress', { phase: 'analyze', dirs: 0, files: 0, reusedDirs: 0, ...p }); } catch { /* gone */ } };
  session = { ...session, opts: { ...session.opts, matchBy } };
  return analyze(session, emit); // pure — no disk I/O
}

export function registerFolderDupIpc(): void {
  ipcMain.handle('folderdup:scan', (e, roots: string[], opts: DupScanOptions) => scan(roots, opts, e.sender));
  ipcMain.handle('folderdup:sync', (e) => sync(e.sender));
  ipcMain.handle('folderdup:setMatchBy', (e, matchBy: DupMatchBy) => setMatchBy(matchBy, e.sender));
}
