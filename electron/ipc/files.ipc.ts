/**
 * files.ipc.ts
 * -----------------------------------------------------------------------------
 * Standalone-tool file operations (not tied to a named project):
 *  • moveToDuplicates — move chosen photos into a reversible `<folder>/duplicate`
 *    subfolder (the Duplicate Finder tool). Strictly confined to the chosen folder.
 *  • saveDataUrl — save a generated image (the Collage tool) via a Save dialog.
 *  • collageSaveTemp / collageLoadTemp / collageClearTemp — the single hidden
 *    Collage-resume session file (`~/Documents/Pebble/.collage-session.json`):
 *    one only, no name, atomic write, never listed among `.pebble` projects.
 */
import { ipcMain, dialog, app } from 'electron';
import { promises as fs } from 'node:fs';
import fss from 'node:fs';
import path from 'node:path';

/** Resolve a relative path strictly inside `folder` (no absolute / no "../"). */
function insideFolder(folder: string, rel: string): string | null {
  if (typeof rel !== 'string' || rel.length === 0 || rel.includes('\0')) return null;
  if (path.isAbsolute(rel) || rel.split(/[\\/]+/).some((s) => s === '..')) return null;
  const base = path.resolve(folder);
  const full = path.resolve(base, rel);
  return (full === base || full.startsWith(base + path.sep)) ? full : null;
}

export interface MoveResult { movedCount: number; duplicateFolder: string; skipped: number }

/** Move the given (folder-relative) files into `<folder>/duplicate`. */
export async function moveToDuplicates(folder: string, files: string[]): Promise<MoveResult> {
  const base = path.resolve(folder);
  const dupDir = path.join(base, 'duplicate');
  await fs.mkdir(dupDir, { recursive: true });
  let moved = 0; let skipped = 0;
  for (const rel of (files || [])) {
    const full = insideFolder(folder, rel);
    if (!full || !fss.existsSync(full)) { skipped += 1; continue; }
    let dest = path.join(dupDir, path.basename(full));
    if (fss.existsSync(dest)) {
      const ext = path.extname(dest); const stem = path.basename(dest, ext); let i = 1;
      while (fss.existsSync(path.join(dupDir, `${stem}_${i}${ext}`))) i += 1;
      dest = path.join(dupDir, `${stem}_${i}${ext}`);
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      await fs.rename(full, dest);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EXDEV') {
        // eslint-disable-next-line no-await-in-loop
        await fs.copyFile(full, dest); await fs.rm(full, { force: true });
      } else { skipped += 1; continue; }
    }
    moved += 1;
  }
  return { movedCount: moved, duplicateFolder: dupDir, skipped };
}

/** Save a base64 data URL to a user-chosen file (Save dialog). */
export async function saveDataUrl(dataUrl: string, defaultName?: string): Promise<string | null> {
  const res = await dialog.showSaveDialog({
    defaultPath: defaultName || 'collage.png',
    filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg'] }],
  });
  if (res.canceled || !res.filePath) return null;
  const m = /^data:image\/\w+;base64,(.+)$/s.exec(dataUrl);
  if (!m) throw new Error('Invalid image data.');
  await fs.writeFile(res.filePath, Buffer.from(m[1], 'base64'));
  return res.filePath;
}

// ── Collage Creator: single hidden "session" file ──────────────────────────
// Resumes the collage tool after a crash/close. Lives in the Pebble folder as a
// dot-prefixed .json so it never shows up in the .pebble project list, and there
// is only ever ONE (no name, no history). "Clear" deletes it.
function collageTempPath(): string {
  return path.join(app.getPath('documents'), 'Pebble', '.collage-session.json');
}
export async function collageSaveTemp(blob: unknown): Promise<void> {
  const p = collageTempPath();
  await fs.mkdir(path.dirname(p), { recursive: true });
  // Atomic-ish write: temp file then rename, so a crash mid-write can't corrupt it.
  const tmp = `${p}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(blob), 'utf-8');
  await fs.rename(tmp, p);
}
export async function collageLoadTemp(): Promise<unknown | null> {
  try { return JSON.parse(await fs.readFile(collageTempPath(), 'utf-8')) as unknown; } catch { return null; }
}
export async function collageClearTemp(): Promise<void> {
  try { await fs.rm(collageTempPath(), { force: true }); } catch { /* already gone */ }
}

export function registerFilesIpc(): void {
  ipcMain.handle('files:moveToDuplicates', (_e, folder: string, files: string[]) => moveToDuplicates(folder, files));
  ipcMain.handle('image:saveDataUrl', (_e, dataUrl: string, defaultName?: string) => saveDataUrl(dataUrl, defaultName));
  ipcMain.handle('collage:saveTemp', (_e, blob: unknown) => collageSaveTemp(blob));
  ipcMain.handle('collage:loadTemp', () => collageLoadTemp());
  ipcMain.handle('collage:clearTemp', () => collageClearTemp());
}
