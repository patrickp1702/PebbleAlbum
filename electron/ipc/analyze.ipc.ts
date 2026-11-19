/**
 * analyze.ipc.ts
 * -----------------------------------------------------------------------------
 * Photo culling analysis: compute a perceptual hash + quality score for every
 * image in a folder (via Sharp), cluster near-duplicates, and return the groups
 * with a suggested best keeper. Results are cached per-file by mtime so re-opening
 * is instant. Emits `analyze:progress` (phases `scan` → `analyze`, with done/total)
 * to the calling renderer so the Duplicate Finder can show live progress.
 */
import { ipcMain } from 'electron';
import type { WebContents } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { ImageRecord, DuplicateGroup, PhotoQuality } from '../../src/types/pebble.types';
import { dHashFromGray, qualityFromGray, buildDuplicateGroups, type SimItem } from '../../src/engine/similarity';
import { listImages } from './folder.ipc';

interface CacheEntry { mtimeMs: number; phash: string; quality: PhotoQuality }
type Cache = Record<string, CacheEntry>;

function cacheFile(folder: string): string { return path.join(folder, '.pebble_cache', 'analysis.json'); }
async function readCache(folder: string): Promise<Cache> {
  try { return JSON.parse(await fs.readFile(cacheFile(folder), 'utf-8')) as Cache; } catch { return {}; }
}
async function writeCache(folder: string, cache: Cache): Promise<void> {
  try { await fs.mkdir(path.join(folder, '.pebble_cache'), { recursive: true }); await fs.writeFile(cacheFile(folder), JSON.stringify(cache), 'utf-8'); } catch { /* best effort */ }
}

/** Compute dHash + quality for one image. */
async function analyzeOne(absPath: string): Promise<{ phash: string; quality: PhotoQuality }> {
  // dHash from a 9×8 grayscale.
  const hashBuf = await sharp(absPath).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  const phash = dHashFromGray(hashBuf);
  // Quality from a ≤256px grayscale (gradient energy + exposure).
  const { data, info } = await sharp(absPath).rotate().greyscale().resize(256, 256, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  const quality = qualityFromGray(data, info.width, info.height);
  return { phash, quality };
}

export interface AnalyzeResult { records: ImageRecord[]; groups: DuplicateGroup[] }

/** Analyze a folder: enrich records with phash/quality and cluster duplicates.
 *  Emits `analyze:progress` events on `sender` so the UI can show a live count. */
export async function analyzeFolder(folderPath: string, sender?: WebContents): Promise<AnalyzeResult> {
  const emit = (phase: 'scan' | 'analyze' | 'done', d: number, t: number) => {
    try { sender?.send('analyze:progress', { phase, done: d, total: t }); } catch { /* sender gone */ }
  };
  emit('scan', 0, 0);
  const records = await listImages(folderPath, (d, t) => emit('scan', d, t));
  const cache = await readCache(folderPath);
  const next: Cache = {};
  const total = records.length;
  let i = 0;
  for (const rec of records) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const stat = await fs.stat(rec.absolutePath);
      const cached = cache[rec.relativePath];
      if (cached && cached.mtimeMs === stat.mtimeMs) {
        rec.phash = cached.phash; rec.quality = cached.quality;
      } else {
        // eslint-disable-next-line no-await-in-loop
        const a = await analyzeOne(rec.absolutePath);
        rec.phash = a.phash; rec.quality = a.quality;
      }
      next[rec.relativePath] = { mtimeMs: stat.mtimeMs, phash: rec.phash!, quality: rec.quality! };
    } catch { /* unreadable — leave without analysis */ }
    i += 1;
    emit('analyze', i, total);
  }
  await writeCache(folderPath, next);

  const items: SimItem[] = records.map((r) => ({ id: r.relativePath, phash: r.phash, aspect: r.height ? r.width / r.height : 1 }));
  const qById: Record<string, PhotoQuality | undefined> = {};
  for (const r of records) qById[r.relativePath] = r.quality;
  const groups = buildDuplicateGroups(items, qById, 10);
  emit('done', total, total);
  return { records, groups };
}

export function registerAnalyzeIpc(): void {
  ipcMain.handle('analyze:folder', (e, folderPath: string) => analyzeFolder(folderPath, e.sender));
}
