/**
 * providers.mjs — image-generation adapters (OpenAI Images edits, Gemini image
 * models, any OpenAI-compatible host, and an offline `mock`).
 * -----------------------------------------------------------------------------
 * CONTRACT (both the MCP server and electron/ipc/enhance.ipc.ts import this):
 *
 *   generateImage(cfg, { image, mime, mask?, prompt, size?, quality? })
 *     → { buffer, mime, width?, height?, model, note? }
 *   testProvider(cfg) → { ok, message, latencyMs? }
 *
 * `image` is a Buffer (PNG/JPEG, already downscaled by the caller, long side ≤
 * 2048). `mask` (optional, PNG, SAME dimensions as image): transparent = REGENERATE,
 * opaque = KEEP. Providers that cannot take a mask ignore it (the caller already
 * appended the identity text to the prompt). Throws Error with a readable message
 * on HTTP / API failures (include status + the API's error text, never the key).
 *
 * Uses only Node 22 globals (fetch, FormData, Blob, AbortController) + sharp.
 */
import sharp from 'sharp';
import { PROVIDER_DEFAULTS } from './providerConfig.mjs';

export function providerSupportsMask(cfg) { return !!(PROVIDER_DEFAULTS[cfg?.provider] || {}).supportsMask; }

const GEN_TIMEOUT_MS = 180_000;
const TEST_TIMEOUT_MS = 20_000;

/** Remove the key (and any bearer token) from a message, whatever the API echoed. */
function scrub(msg, cfg) {
  let s = String(msg || '');
  const k = cfg?.apiKey;
  if (k && k.length >= 4) s = s.split(k).join('[key]');
  return s.replace(/(Bearer\s+)[A-Za-z0-9._\-]+/gi, '$1[key]').replace(/\b(sk-|AIza)[A-Za-z0-9*._\-]{4,}/g, '$1[key]').slice(0, 600);
}

async function timedFetch(url, init, ms, cfg, what) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    return await fetch(url, { ...init, signal: ac.signal });
  } catch (e) {
    if (e?.name === 'AbortError') throw new Error(`${what}: no response after ${Math.round(ms / 1000)} s (timed out).`);
    throw new Error(`${what}: network error — ${scrub(e?.cause?.message || e?.message, cfg)}`);
  } finally { clearTimeout(timer); }
}

/** Read an error body into "HTTP 401 — Incorrect API key provided". */
async function httpError(res, cfg, what) {
  let detail = '';
  try {
    const text = await res.text();
    try {
      const j = JSON.parse(text);
      detail = j?.error?.message || j?.error?.status || j?.message || (typeof j?.error === 'string' ? j.error : '') || text;
    } catch { detail = text; }
  } catch { /* no body */ }
  return new Error(`${what}: HTTP ${res.status}${res.statusText ? ` ${res.statusText}` : ''}${detail ? ` — ${scrub(detail, cfg)}` : ''}`);
}

async function dims(buffer) {
  try { const m = await sharp(buffer).metadata(); return { width: m.width, height: m.height }; } catch { return {}; }
}

// ---- OpenAI / OpenAI-compatible -------------------------------------------
async function openaiGenerate(cfg, req) {
  const what = cfg.provider === 'openai' ? 'OpenAI' : 'OpenAI-compatible endpoint';
  const ext = req.mime === 'image/jpeg' ? 'jpg' : req.mime === 'image/webp' ? 'webp' : 'png';
  const fd = new FormData();
  fd.append('model', cfg.model);
  fd.append('prompt', req.prompt);
  fd.append('image', new Blob([req.image], { type: req.mime || 'image/png' }), `image.${ext}`);
  if (req.mask) fd.append('mask', new Blob([req.mask], { type: 'image/png' }), 'mask.png');
  fd.append('n', '1');
  const size = String(req.size ?? '').trim();
  fd.append('size', size && size.toLowerCase() !== 'auto' ? size : 'auto');
  const quality = String(req.quality ?? '').trim();
  if (quality) fd.append('quality', quality);
  const res = await timedFetch(`${cfg.baseUrl}/images/edits`, {
    method: 'POST', headers: { Authorization: `Bearer ${cfg.apiKey}` }, body: fd,
  }, GEN_TIMEOUT_MS, cfg, what);
  if (!res.ok) throw await httpError(res, cfg, what);
  const j = await res.json();
  const d = j?.data?.[0];
  let buffer;
  if (d?.b64_json) buffer = Buffer.from(d.b64_json, 'base64');
  else if (d?.url) {
    const r2 = await timedFetch(d.url, {}, GEN_TIMEOUT_MS, cfg, `${what} (download)`);
    if (!r2.ok) throw await httpError(r2, cfg, `${what} (download)`);
    buffer = Buffer.from(await r2.arrayBuffer());
  } else throw new Error(`${what}: the response contained no image.`);
  const m = await sharp(buffer).metadata().catch(() => ({}));
  return { buffer, mime: m.format ? `image/${m.format === 'jpeg' ? 'jpeg' : m.format}` : 'image/png', width: m.width, height: m.height, model: cfg.model, note: req.mask ? 'mask sent (face kept)' : undefined };
}

// ---- Gemini ----------------------------------------------------------------
async function geminiGenerate(cfg, req) {
  const what = 'Gemini';
  const body = {
    contents: [{ role: 'user', parts: [{ text: req.prompt }, { inline_data: { mime_type: req.mime || 'image/png', data: req.image.toString('base64') } }] }],
    generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
  };
  const res = await timedFetch(`${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}:generateContent`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': cfg.apiKey }, body: JSON.stringify(body),
  }, GEN_TIMEOUT_MS, cfg, what);
  if (!res.ok) throw await httpError(res, cfg, what);
  const j = await res.json();
  const cand = j?.candidates?.[0];
  const parts = cand?.content?.parts || [];
  const img = parts.find((p) => (p.inlineData || p.inline_data)?.data);
  if (!img) {
    const text = parts.map((p) => p.text).filter(Boolean).join(' ').trim();
    const reason = cand?.finishReason || j?.promptFeedback?.blockReason;
    throw new Error(`${what}: no image returned${reason ? ` (${reason})` : ''}${text ? ` — model said: ${scrub(text, cfg).slice(0, 300)}` : ''}.`);
  }
  const inl = img.inlineData || img.inline_data;
  const buffer = Buffer.from(inl.data, 'base64');
  return { buffer, mime: inl.mimeType || inl.mime_type || 'image/png', ...(await dims(buffer)), model: cfg.model, note: req.mask ? 'mask ignored (Gemini has no mask input)' : undefined };
}

// ---- Mock (offline) ----------------------------------------------------------
/** Re-tinted (+warmth, −8% brightness) and 1.5% zoomed copy of the input, as PNG. */
async function mockGenerate(cfg, req) {
  const m = await sharp(req.image).metadata();
  const W = m.width; const H = m.height;
  const cw = Math.max(1, Math.round(W / 1.015)); const ch = Math.max(1, Math.round(H / 1.015));
  const buffer = await sharp(req.image)
    .extract({ left: Math.floor((W - cw) / 2), top: Math.floor((H - ch) / 2), width: cw, height: ch })
    .resize(W, H, { fit: 'fill' })
    .modulate({ brightness: 0.92 })
    .linear([1.06, 1.0, 0.9], [10, 2, -8])
    .removeAlpha()
    .png()
    .toBuffer();
  return { buffer, mime: 'image/png', width: W, height: H, model: cfg?.model || 'mock', note: `mock provider: re-tinted, 1.5% zoomed copy${req.mask ? ' (mask received)' : ''}` };
}

export async function generateImage(cfg, req) {
  if (!cfg || !cfg.provider) throw new Error('No image provider configured.');
  if (!req || !Buffer.isBuffer(req.image)) throw new Error('generateImage: `image` must be a Buffer.');
  if (!String(req.prompt || '').trim()) throw new Error('generateImage: a prompt is required.');
  switch (cfg.provider) {
    case 'openai':
    case 'openai_compatible': return openaiGenerate(cfg, req);
    case 'gemini': return geminiGenerate(cfg, req);
    case 'mock': return mockGenerate(cfg, req);
    default: throw new Error(`Unknown provider "${cfg.provider}".`);
  }
}

export async function testProvider(cfg) {
  if (!cfg || !cfg.provider) return { ok: false, message: 'No provider configured.' };
  const t0 = Date.now();
  try {
    if (cfg.provider === 'mock') return { ok: true, message: 'Mock provider (offline): returns a re-tinted copy of the photo. Nothing is uploaded.', latencyMs: 0 };
    if (cfg.provider === 'openai' || cfg.provider === 'openai_compatible') {
      const what = cfg.provider === 'openai' ? 'OpenAI' : 'OpenAI-compatible endpoint';
      const res = await timedFetch(`${cfg.baseUrl}/models`, { headers: { Authorization: `Bearer ${cfg.apiKey}` } }, TEST_TIMEOUT_MS, cfg, what);
      if (!res.ok) throw await httpError(res, cfg, what);
      let ids = [];
      try { const j = await res.json(); ids = (j?.data || []).map((d) => d.id); } catch { /* not a list */ }
      const has = ids.includes(cfg.model);
      return { ok: true, message: `Connected to ${what}. ${ids.length ? (has ? `Model "${cfg.model}" is available.` : `Model "${cfg.model}" was not in the model list (${ids.length} models) — check the id.`) : 'Key accepted.'}`, latencyMs: Date.now() - t0 };
    }
    if (cfg.provider === 'gemini') {
      const res = await timedFetch(`${cfg.baseUrl}/models/${encodeURIComponent(cfg.model)}`, { headers: { 'x-goog-api-key': cfg.apiKey } }, TEST_TIMEOUT_MS, cfg, 'Gemini');
      if (!res.ok) throw await httpError(res, cfg, 'Gemini');
      let name = cfg.model;
      try { const j = await res.json(); name = j?.displayName || j?.name || name; } catch { /* ignore */ }
      return { ok: true, message: `Connected to Gemini. Model "${name}" is available.`, latencyMs: Date.now() - t0 };
    }
    return { ok: false, message: `Unknown provider "${cfg.provider}".` };
  } catch (e) {
    return { ok: false, message: scrub(e?.message || String(e), cfg), latencyMs: Date.now() - t0 };
  }
}
