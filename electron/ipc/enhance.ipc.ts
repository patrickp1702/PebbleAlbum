/**
 * enhance.ipc.ts
 * -----------------------------------------------------------------------------
 * Main-process side of the AI Enhance studio (src/views/EnhanceView.vue):
 *  • enhance:provider*  — the image-generation provider settings. They live in
 *    ONE file, `<Pebble>/ai-provider.json` (mode 0600), read and written ONLY
 *    through mcp/enhance/providerConfig.mjs so the app and the MCP server can
 *    never disagree about its shape. The key never goes into a .pebble, the MCP
 *    config JSON, or an MCP tool result; `providerStatus` is the key-free view.
 *  • enhance:providerTest — a cheap live check via mcp/enhance/providers.mjs
 *    (e.g. list models). No photo is ever sent from here: photos are uploaded
 *    only when the AGENT calls the MCP tool `enhance_generate`.
 *  • enhance:findProjectForFolder — which saved .pebble (if any) belongs to a
 *    folder, so opening a folder in the studio reuses its project.
 *
 * The two .mjs modules are imported by relative path WITHOUT the extension on
 * purpose: TypeScript maps an explicit `.mjs` specifier only to a `.d.mts`, so
 * the extensionless form lets it pick up the `.d.ts` siblings, while Vite's
 * resolver (extensions list starts with `.mjs`) bundles the real modules into
 * out/main.
 */
import { ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pebbleRoot } from './project.ipc';
import {
  readProviderConfig, writeProviderConfig, clearProviderConfig, providerStatus, normalizeProviderConfig,
} from '../../mcp/enhance/providerConfig';
import { testProvider } from '../../mcp/enhance/providers';
import type { AiProviderConfig, AiProviderStatus, AiProviderTestResult } from '../../src/types/ipc.types';
import type { PebbleProject } from '../../src/types/pebble.types';

/** Case-insensitive on macOS/Windows file systems; exact elsewhere. */
function samePath(a: string, b: string): boolean {
  const ra = path.resolve(a).replace(/[\\/]+$/, '');
  const rb = path.resolve(b).replace(/[\\/]+$/, '');
  return process.platform === 'linux' ? ra === rb : ra.toLowerCase() === rb.toLowerCase();
}

/** The saved .pebble in the Pebble folder whose meta.sourceFolder is `folder`, else null.
 *  Most recently modified wins when several projects share a folder. */
export async function findProjectForFolder(folder: string): Promise<string | null> {
  if (!folder) return null;
  const dir = pebbleRoot();
  let files: string[] = [];
  try { files = (await fs.readdir(dir)).filter((f) => f.endsWith('.pebble')); } catch { return null; }
  let best: { path: string; mtime: number } | null = null;
  for (const f of files) {
    const full = path.join(dir, f);
    try {
      // eslint-disable-next-line no-await-in-loop
      const [stat, raw] = await Promise.all([fs.stat(full), fs.readFile(full, 'utf-8')]);
      const proj = JSON.parse(raw) as PebbleProject;
      const src = proj.meta?.sourceFolder;
      if (src && samePath(src, folder) && (!best || stat.mtimeMs > best.mtime)) best = { path: full, mtime: stat.mtimeMs };
    } catch { /* skip unreadable/corrupt file */ }
  }
  return best?.path ?? null;
}

export function registerEnhanceIpc(): void {
  ipcMain.handle('enhance:providerStatus', async (): Promise<AiProviderStatus> => {
    const home = pebbleRoot();
    let cfg: AiProviderConfig | null = null;
    try { cfg = await readProviderConfig(home); } catch { cfg = null; } // unreadable ⇒ "not configured"
    return providerStatus(cfg, home);
  });

  // Full config (incl. key) for the local settings form only — never leaves the app.
  ipcMain.handle('enhance:providerGet', (): Promise<AiProviderConfig | null> => readProviderConfig(pebbleRoot()));

  // Validation errors (missing key/model/baseUrl, unknown provider) are thrown
  // with a readable message; the renderer toasts it.
  ipcMain.handle('enhance:providerSave', async (_e, cfg: AiProviderConfig): Promise<AiProviderStatus> => {
    const home = pebbleRoot();
    const saved = await writeProviderConfig(home, cfg);
    return providerStatus(saved, home);
  });

  // Test the form's (unsaved) config when given, else the saved one.
  ipcMain.handle('enhance:providerTest', async (_e, cfg?: AiProviderConfig): Promise<AiProviderTestResult> => {
    try {
      const use = cfg ? normalizeProviderConfig(cfg) : await readProviderConfig(pebbleRoot());
      if (!use) return { ok: false, message: 'No provider configured yet — fill in the form and save it.' };
      return await testProvider(use);
    } catch (e) {
      return { ok: false, message: (e as Error).message || String(e) };
    }
  });

  ipcMain.handle('enhance:providerClear', (): Promise<void> => clearProviderConfig(pebbleRoot()));

  ipcMain.handle('enhance:findProjectForFolder', (_e, folder: string) => findProjectForFolder(folder));
}
