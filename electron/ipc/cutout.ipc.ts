/**
 * cutout.ipc.ts
 * -----------------------------------------------------------------------------
 * Cutout Studio + custom-sticker persistence:
 *  • cutout:save   — write a transparent PNG cutout into `<sourceFolder>/cutouts/`
 *    so it lives with the album's photos (relative path ⇒ works with the normal
 *    image/thumbnail pipeline and the .pebble registry).
 *  • stickers:save/list/delete — the user's global "My Stickers" library at
 *    `~/PebbleAlbum/stickers/` (PicsArt-style: any cutout can become a reusable
 *    sticker available in every project).
 */
import { ipcMain, app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

function dataUrlToBuffer(dataUrl: string): Buffer {
  const m = /^data:image\/\w+;base64,(.+)$/s.exec(dataUrl);
  if (!m) throw new Error('Invalid image data URL.');
  return Buffer.from(m[1], 'base64');
}

function sanitize(name: string): string {
  return name.replace(/[^a-z0-9_\- ]/gi, '').trim().replace(/\s+/g, '_') || 'cutout';
}

/** Pick a non-clobbering `<dir>/<stem>.png` path. */
async function freePath(dir: string, stem: string): Promise<string> {
  let p = path.join(dir, `${stem}.png`);
  let i = 1;
  // eslint-disable-next-line no-await-in-loop
  while (await fs.access(p).then(() => true, () => false)) { p = path.join(dir, `${stem}_${i}.png`); i += 1; }
  return p;
}

export interface CutoutSaveResult { absolutePath: string; relativePath: string; width: number; height: number }

/** Save a cutout PNG under `<sourceFolder>/cutouts/` and return its paths+dims. */
export async function saveCutout(sourceFolder: string, baseName: string, dataUrl: string): Promise<CutoutSaveResult> {
  const dir = path.join(path.resolve(sourceFolder), 'cutouts');
  await fs.mkdir(dir, { recursive: true });
  const out = await freePath(dir, `${sanitize(baseName)}_cutout`);
  await fs.writeFile(out, dataUrlToBuffer(dataUrl));
  const meta = await sharp(out).metadata();
  return {
    absolutePath: out,
    relativePath: path.relative(path.resolve(sourceFolder), out).split(path.sep).join('/'),
    width: meta.width ?? 0,
    height: meta.height ?? 0,
  };
}

/**
 * Save a mask PNG under `<sourceFolder>/.pebble_masks/`: an erase mask (alpha =
 * keep, `<imageId>_<timestamp>.png`) or, with `kind = 'filter'`, a Filter-brush
 * mask (alpha = how much of the effects apply, `<imageId>_fx_<timestamp>.png`).
 * Every save is a NEW file so undo/redo can swap between mask paths and no
 * loader ever serves a stale cached mask.
 */
export async function saveEraseMask(sourceFolder: string, imageId: string, dataUrl: string, kind?: string): Promise<{ relativePath: string }> {
  const root = path.resolve(sourceFolder);
  const dir = path.join(root, '.pebble_masks');
  await fs.mkdir(dir, { recursive: true });
  const stem = imageId.replace(/[^a-z0-9_-]/gi, '') || 'mask';
  const out = path.join(dir, `${stem}${kind === 'filter' ? '_fx' : ''}_${Date.now()}.png`);
  await fs.writeFile(out, dataUrlToBuffer(dataUrl));
  return { relativePath: path.relative(root, out).split(path.sep).join('/') };
}

function stickersDir(): string {
  return path.join(app.getPath('home'), 'PebbleAlbum', 'stickers');
}

export interface CustomSticker { path: string; name: string; width: number; height: number }

export async function saveSticker(dataUrl: string, name?: string): Promise<CustomSticker> {
  const dir = stickersDir();
  await fs.mkdir(dir, { recursive: true });
  const out = await freePath(dir, sanitize(name || 'sticker'));
  await fs.writeFile(out, dataUrlToBuffer(dataUrl));
  const meta = await sharp(out).metadata();
  return { path: out, name: path.basename(out, '.png'), width: meta.width ?? 0, height: meta.height ?? 0 };
}

export async function listStickers(): Promise<CustomSticker[]> {
  const dir = stickersDir();
  let files: string[] = [];
  try { files = (await fs.readdir(dir)).filter((f) => f.toLowerCase().endsWith('.png')); } catch { return []; }
  const out: CustomSticker[] = [];
  for (const f of files.sort()) {
    const full = path.join(dir, f);
    try {
      // eslint-disable-next-line no-await-in-loop
      const meta = await sharp(full).metadata();
      out.push({ path: full, name: path.basename(f, '.png'), width: meta.width ?? 0, height: meta.height ?? 0 });
    } catch { /* skip unreadable */ }
  }
  return out;
}

export async function deleteSticker(p: string): Promise<void> {
  const dir = path.resolve(stickersDir());
  const full = path.resolve(p);
  if (!full.startsWith(dir + path.sep)) throw new Error('Not a sticker file.');
  await fs.rm(full, { force: true });
}

export function registerCutoutIpc(): void {
  ipcMain.handle('cutout:save', (_e, sourceFolder: string, baseName: string, dataUrl: string) => saveCutout(sourceFolder, baseName, dataUrl));
  ipcMain.handle('cutout:saveMask', (_e, sourceFolder: string, imageId: string, dataUrl: string, kind?: string) => saveEraseMask(sourceFolder, imageId, dataUrl, kind));
  ipcMain.handle('stickers:save',(_e, dataUrl: string, name?: string) => saveSticker(dataUrl, name));
  ipcMain.handle('stickers:list', () => listStickers());
  ipcMain.handle('stickers:delete', (_e, p: string) => deleteSticker(p));
}
