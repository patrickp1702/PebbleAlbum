/**
 * project.ipc.ts
 * -----------------------------------------------------------------------------
 * Load/save/autosave `.pebble` JSON files, the recent-projects list, and the
 * `.pebble.bak` crash-recovery backup. The `.pebble` file is the ground truth
 * for an entire album.
 */
import { ipcMain, dialog, app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { PebbleProject } from '../../src/types/pebble.types';
import type { RecentProject } from '../../src/types/editor.types';

/**
 * Projects live in the user's Documents folder: ~/Documents/Pebble.
 * `.pebble` files sit directly here; exports/ and the recents index are kept
 * alongside. This is a visible, predictable location (not a hidden home dir).
 */
export function pebbleRoot(): string {
  return path.join(app.getPath('documents'), 'Pebble');
}
function recentsFile(): string { return path.join(pebbleRoot(), '.recent-projects.json'); }

async function ensureRoot(): Promise<void> {
  await fs.mkdir(pebbleRoot(), { recursive: true });
  await fs.mkdir(path.join(pebbleRoot(), 'exports'), { recursive: true });
}

export async function saveProject(project: PebbleProject, savePath?: string): Promise<string> {
  await ensureRoot();
  const target = savePath
    ?? path.join(pebbleRoot(), `${sanitize(project.meta.name)}.pebble`);
  const json = JSON.stringify(project, null, 2);
  await fs.writeFile(target, json, 'utf-8');
  await fs.writeFile(`${target}.bak`, json, 'utf-8'); // crash-recovery copy
  return target;
}

export async function loadProject(filePath: string): Promise<PebbleProject> {
  const raw = await fs.readFile(filePath, 'utf-8');
  return JSON.parse(raw) as PebbleProject;
}

function sanitize(name: string): string {
  return name.replace(/[^a-z0-9_\- ]/gi, '').trim() || 'album';
}

async function readRecents(): Promise<RecentProject[]> {
  try { return JSON.parse(await fs.readFile(recentsFile(), 'utf-8')); } catch { return []; }
}
async function writeRecents(list: RecentProject[]): Promise<void> {
  await ensureRoot();
  await fs.writeFile(recentsFile(), JSON.stringify(list, null, 2), 'utf-8');
}

export function registerProjectIpc(): void {
  ipcMain.handle('project:save', (_e, project: PebbleProject, savePath?: string) => saveProject(project, savePath));
  ipcMain.handle('project:load', (_e, filePath: string) => loadProject(filePath));
  ipcMain.handle('project:autosave', (_e, project: PebbleProject) => saveProject(project));

  ipcMain.handle('project:openDialog', async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile'], filters: [{ name: 'PebbleAlbum', extensions: ['pebble'] }],
    });
    return res.canceled || !res.filePaths[0] ? null : res.filePaths[0];
  });

  ipcMain.handle('project:saveDialog', async (_e, project: PebbleProject) => {
    const res = await dialog.showSaveDialog({
      defaultPath: path.join(pebbleRoot(), `${sanitize(project.meta.name)}.pebble`),
      filters: [{ name: 'PebbleAlbum', extensions: ['pebble'] }],
    });
    if (res.canceled || !res.filePath) return null;
    await saveProject(project, res.filePath);
    return res.filePath;
  });

  ipcMain.handle('project:recents:get', () => readRecents());
  ipcMain.handle('project:recents:add', async (_e, p: string, name: string) => {
    const list = (await readRecents()).filter((r) => r.path !== p);
    list.unshift({ path: p, name, lastOpened: new Date().toISOString(), imageCount: 0, pageCount: 0 });
    await writeRecents(list.slice(0, 50));
  });
  ipcMain.handle('project:recents:delete', async (_e, p: string) => {
    await writeRecents((await readRecents()).filter((r) => r.path !== p));
  });

  // List every saved .pebble project in ~/Documents/Pebble with metadata.
  ipcMain.handle('project:list', async () => {
    await ensureRoot();
    const dir = pebbleRoot();
    let files: string[] = [];
    try { files = (await fs.readdir(dir)).filter((f) => f.endsWith('.pebble')); } catch { files = []; }
    const out = [];
    for (const f of files) {
      const full = path.join(dir, f);
      try {
        // eslint-disable-next-line no-await-in-loop
        const [stat, raw] = await Promise.all([fs.stat(full), fs.readFile(full, 'utf-8')]);
        const proj = JSON.parse(raw) as PebbleProject;
        out.push({
          path: full,
          name: proj.meta?.name ?? f.replace(/\.pebble$/, ''),
          lastOpened: stat.mtime.toISOString(),
          imageCount: proj.imageRegistry?.length ?? 0,
          pageCount: proj.pages?.length ?? 0,
        });
      } catch { /* skip unreadable/corrupt file */ }
    }
    out.sort((a, b) => b.lastOpened.localeCompare(a.lastOpened));
    return out;
  });

  // Delete a saved project file (+ its .bak) and drop it from recents.
  ipcMain.handle('project:delete', async (_e, p: string) => {
    await fs.rm(p, { force: true });
    await fs.rm(`${p}.bak`, { force: true });
    await writeRecents((await readRecents()).filter((r) => r.path !== p));
  });
}
