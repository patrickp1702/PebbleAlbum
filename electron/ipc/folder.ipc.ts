/**
 * folder.ipc.ts
 * -----------------------------------------------------------------------------
 * Native folder picker, recursive image listing (with thumbnails + parsed
 * labels), and lightweight folder watching for newly-added images.
 */
import { ipcMain, dialog, BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { ImageRecord } from '../../src/types/pebble.types';
import { parseFilename } from '../../src/engine/filenameParser';
import { generateThumbnail } from './thumbnail.ipc';
import { mimeFor } from './image.ipc';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.tiff', '.bmp']);
let watcher: fsSync.FSWatcher | null = null;

export async function openFolderDialog(): Promise<string | null> {
  const res = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return res.canceled || res.filePaths.length === 0 ? null : res.filePaths[0];
}

/** Recursively collect image files (skips the cache dir). */
async function collectImages(folder: string, root = folder): Promise<string[]> {
  const entries = await fs.readdir(folder, { withFileTypes: true });
  const out: string[] = [];
  for (const e of entries) {
    // Skip the thumbnail cache and the cull bin (so moved duplicates never re-appear).
    // (.pebble_masks holds erase masks — never album photos.)
    if (e.name.startsWith('.pebble_cache') || e.name === '.pebble_masks' || e.name === 'duplicate') continue;
    const full = path.join(folder, e.name);
    if (e.isDirectory()) out.push(...await collectImages(full, root));
    else if (IMAGE_EXT.has(path.extname(e.name).toLowerCase())) out.push(full);
  }
  return out;
}

/** Build one ImageRecord (dimensions, thumbnail, labels) for a file in the album folder. */
async function buildImageRecord(folderPath: string, abs: string): Promise<ImageRecord> {
  const [stat, meta] = await Promise.all([fs.stat(abs), sharp(abs).metadata()]);
  const thumb = await generateThumbnail(abs, 320).catch(() => '');
  const rel = path.relative(folderPath, abs);
  // ⚠ Use ORIENTATION-CORRECTED dimensions. Sharp reports the raw sensor
  // width/height; EXIF orientation 5-8 means the photo is displayed rotated
  // 90°, so the true (displayed) width/height are swapped. The thumbnail is
  // auto-rotated, so the registry must match it or the photo would stretch.
  let w = meta.width ?? 0; let h = meta.height ?? 0;
  if (meta.orientation && meta.orientation >= 5) { const t = w; w = h; h = t; }
  return {
    filename: path.basename(abs),
    relativePath: rel,
    absolutePath: abs,
    width: w,
    height: h,
    fileSize: stat.size,
    mimeType: mimeFor(abs),
    exif: { orientation: meta.orientation },
    thumbnailPath: thumb,
    parsedLabels: parseFilename(path.basename(abs)),
    usedOnPages: [],
    skipped: parseFilename(path.basename(abs)).flags?.includes('skip') ?? false,
  };
}

/** Build full ImageRecord list including dimensions, thumbnail and labels.
 *  `onProgress(done, total)` (optional) fires after each file for UI progress. */
export async function listImages(
  folderPath: string,
  onProgress?: (done: number, total: number) => void,
): Promise<ImageRecord[]> {
  const files = await collectImages(folderPath);
  const records: ImageRecord[] = [];
  let done = 0;
  for (const abs of files) {
    try {
      // eslint-disable-next-line no-await-in-loop
      records.push(await buildImageRecord(folderPath, abs));
    } catch { /* skip unreadable file */ }
    done += 1;
    onProgress?.(done, files.length);
  }
  return records;
}

/**
 * "Add photo" (PicsArt-style): pick one or more images anywhere on disk. A file
 * already inside the album folder is used in place; anything else is COPIED
 * into `<sourceFolder>/added/` (never clobbering) so the project's
 * relative-path model and the MCP sandbox keep working.
 */
export async function addPhotos(sourceFolder: string): Promise<ImageRecord[]> {
  const res = await dialog.showOpenDialog({
    title: 'Add photo',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Images', extensions: [...IMAGE_EXT].map((e) => e.slice(1)) }],
  });
  if (res.canceled) return [];
  const root = path.resolve(sourceFolder);
  const out: ImageRecord[] = [];
  for (const picked of res.filePaths) {
    try {
      let abs = path.resolve(picked);
      if (!abs.startsWith(root + path.sep)) {
        const dir = path.join(root, 'added');
        // eslint-disable-next-line no-await-in-loop
        await fs.mkdir(dir, { recursive: true });
        const ext = path.extname(abs); const stem = path.basename(abs, ext);
        let dest = path.join(dir, `${stem}${ext}`); let i = 1;
        // eslint-disable-next-line no-await-in-loop
        while (await fs.access(dest).then(() => true, () => false)) { dest = path.join(dir, `${stem}_${i}${ext}`); i += 1; }
        // eslint-disable-next-line no-await-in-loop
        await fs.copyFile(abs, dest);
        abs = dest;
      }
      // eslint-disable-next-line no-await-in-loop
      const rec = await buildImageRecord(root, abs);
      rec.relativePath = rec.relativePath.split(path.sep).join('/');
      out.push(rec);
    } catch { /* skip unreadable file */ }
  }
  return out;
}

export function registerFolderIpc(): void {
  ipcMain.handle('folder:open', () => openFolderDialog());
  ipcMain.handle('folder:list', (_e, folder: string) => listImages(folder));
  ipcMain.handle('folder:addPhotos', (_e, folder: string) => addPhotos(folder));

  ipcMain.on('folder:watch', (e, folder: string) => {
    try { watcher?.close(); } catch { /* ignore */ }
    watcher = fsSync.watch(folder, { persistent: false }, () => {
      const win = BrowserWindow.fromWebContents(e.sender);
      win?.webContents.send('folder:changed', [folder]);
    });
  });
  ipcMain.on('folder:stopWatch', () => { try { watcher?.close(); } catch { /* ignore */ } watcher = null; });
}
