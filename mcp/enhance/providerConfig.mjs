/**
 * providerConfig.mjs — the ONE place the AI image-provider settings live.
 * -----------------------------------------------------------------------------
 * Written by the desktop app (Enhance studio → electron/ipc/enhance.ipc.ts) and
 * read by the MCP server (mcp/enhance/tools.mjs). The file sits NEXT to the
 * projects: `<PEBBLE_HOME>/ai-provider.json`, created with mode 0600. The key is
 * never written into a .pebble, never returned by an MCP tool, and never put in
 * the agent's MCP config JSON — the agent only learns that a provider IS set.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';

export const PROVIDER_FILE = 'ai-provider.json';

/** Per-provider defaults. `supportsMask` = accepts an inpainting mask (keep-face). */
export const PROVIDER_DEFAULTS = {
  openai: { label: 'OpenAI Images', model: 'gpt-image-2.5-sunburst', baseUrl: 'https://api.openai.com/v1', supportsMask: true, size: 'auto', quality: 'high' },
  gemini: { label: 'Google Gemini (image)', model: 'gemini-3.1-flash-image', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', supportsMask: false, size: '', quality: '' },
  openai_compatible: { label: 'OpenAI-compatible endpoint', model: '', baseUrl: '', supportsMask: true, size: 'auto', quality: '' },
  mock: { label: 'Mock (offline test)', model: 'mock', baseUrl: '', supportsMask: true, size: '', quality: '' },
};
export const PROVIDER_KINDS = Object.keys(PROVIDER_DEFAULTS);

export function providerConfigPath(home) { return path.join(path.resolve(home), PROVIDER_FILE); }

/** Fill defaults + trim; throws on an unknown provider or a missing key/model/baseUrl. */
export function normalizeProviderConfig(cfg) {
  if (!cfg || typeof cfg !== 'object') throw new Error('Provider config must be an object.');
  const provider = String(cfg.provider || '').trim();
  const d = PROVIDER_DEFAULTS[provider];
  if (!d) throw new Error(`Unknown provider "${provider}". Valid: ${PROVIDER_KINDS.join(', ')}.`);
  // The offline mock never needs (or keeps) a key — switching to it must not carry a real key along.
  const apiKey = provider === 'mock' ? '' : String(cfg.apiKey || '').trim();
  const model = String(cfg.model || d.model || '').trim();
  const baseUrl = String(cfg.baseUrl || d.baseUrl || '').trim().replace(/\/+$/, '');
  if (provider !== 'mock') {
    if (!apiKey) throw new Error('An API key is required.');
    if (!model) throw new Error('A model id is required.');
    if (!baseUrl) throw new Error('A base URL is required for this provider.');
    if (!/^https?:\/\//i.test(baseUrl)) throw new Error('Base URL must start with http:// or https://.');
  }
  return {
    provider, apiKey, model, baseUrl,
    size: String(cfg.size ?? d.size ?? '').trim(),
    quality: String(cfg.quality ?? d.quality ?? '').trim(),
    updatedAt: new Date().toISOString(),
  };
}

export async function readProviderConfig(home) {
  try {
    const raw = await fs.readFile(providerConfigPath(home), 'utf-8');
    const cfg = JSON.parse(raw);
    return normalizeProviderConfig(cfg);
  } catch (e) {
    if (e && e.code === 'ENOENT') return null;
    // A JSON SyntaxError can quote a snippet of the file (i.e. of the key) — never echo it.
    if (e instanceof SyntaxError) throw new Error(`Could not read ${PROVIDER_FILE}: the file is not valid JSON — save the settings again in the Enhance studio.`);
    throw new Error(`Could not read ${PROVIDER_FILE}: ${e.message}`);
  }
}

export async function writeProviderConfig(home, cfg) {
  const norm = normalizeProviderConfig(cfg);
  const file = providerConfigPath(home);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify(norm, null, 2), { encoding: 'utf-8', mode: 0o600 });
  try { await fs.chmod(file, 0o600); } catch { /* best effort (Windows) */ }
  return norm;
}

export async function clearProviderConfig(home) {
  try { await fs.unlink(providerConfigPath(home)); } catch (e) { if (e.code !== 'ENOENT') throw e; }
}

export function keyHint(apiKey) {
  const k = String(apiKey || '');
  if (!k) return null;
  if (k.length <= 8) return '••••';
  return `${k.slice(0, 3)}…${k.slice(-4)}`;
}

/** The safe, key-free summary (what the UI shows and the MCP tool returns). */
export function providerStatus(cfg, home) {
  const file = providerConfigPath(home);
  if (!cfg) return { configured: false, provider: null, model: null, baseUrl: null, keyHint: null, supportsMask: false, file };
  const d = PROVIDER_DEFAULTS[cfg.provider] || {};
  return { configured: true, provider: cfg.provider, model: cfg.model || null, baseUrl: cfg.baseUrl || null, keyHint: keyHint(cfg.apiKey), supportsMask: !!d.supportsMask, file };
}
