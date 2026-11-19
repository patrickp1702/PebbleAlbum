/**
 * thumbnail.ipc.ts — Sharp-based thumbnail generation with an mtime-keyed cache.
 * Thumbnails live next to the source folder under `.pebble_cache/thumbs/`.
 */
import { ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

/** Resolve the cache directory for a given source folder or project path. */
export function cacheDirFor(folderOrProject: string): string {
  const base = path.extname(folderOrProject) ? path.dirname(folderOrProject) : folderOrProject;
  return path.join(base, '.pebble_cache', 'thumbs');
}

/**
 * Generate (or reuse) a thumbnail. Cache key encodes filename, mtime and size so
 * the thumbnail is regenerated whenever the source changes.
 *
 * Format: JPEG for ordinary photos (small + fast), but PNG when the source has
 * an ALPHA channel (logo overlays, cutouts, transparent WebP). JPEG has no alpha,
 * so those used to come back with their transparent areas filled solid BLACK in
 * the editor canvas. The PNG variant uses a different extension → a different
 * cache key, so any stale (alpha-less) JPEG cache entry is simply ignored.
 */
export async function generateThumbnail(imagePath: string, size: number): Promise<string> {
  const stat = await fs.stat(imagePath);
  const dir = cacheDirFor(path.dirname(imagePath));
  await fs.mkdir(dir, { recursive: true });
  let hasAlpha = false;
  try { hasAlpha = !!(await sharp(imagePath).metadata()).hasAlpha; } catch { /* unreadable → let the resize below throw */ }
  const key = `${path.basename(imagePath)}_${Math.round(stat.mtimeMs)}_${size}.${hasAlpha ? 'png' : 'jpg'}`;
  const out = path.join(dir, key);
  try {
    await fs.access(out);
    return out; // cache hit
  } catch {
    const pipeline = sharp(imagePath)
      .rotate() // respect EXIF orientation
      .resize(size, size, { fit: 'inside', withoutEnlargement: true });
    await (hasAlpha ? pipeline.png({ compressionLevel: 6 }) : pipeline.jpeg({ quality: 80 })).toFile(out);
    return out;
  }
}

export function registerThumbnailIpc(): void {
  ipcMain.handle('thumb:generate', (_e, imagePath: string, size: number) => generateThumbnail(imagePath, size));
  ipcMain.handle('thumb:cachePath', (_e, projectPath: string) => cacheDirFor(projectPath));
  ipcMain.handle('thumb:clear', async (_e, projectPath: string) => {
    const dir = cacheDirFor(projectPath);
    await fs.rm(dir, { recursive: true, force: true });
  });
}
