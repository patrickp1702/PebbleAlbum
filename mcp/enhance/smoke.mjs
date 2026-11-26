#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * smoke.mjs — end-to-end offline test of the AI Enhance MCP tools (no API key).
 *
 *   node mcp/enhance/smoke.mjs [photo.jpg] [--out <dir>] [--keep]
 *
 *   photo  a photo with ONE clear face (or env PEBBLE_SMOKE_PHOTO)
 *   --out  parent folder for the throwaway run (or env PEBBLE_SMOKE_DIR; default os.tmpdir())
 *   --keep keep the run folder (final.jpg, previews) for inspection; otherwise it is removed
 *
 * Creates a fresh temp PEBBLE_HOME + album folder with a copy of the photo, a minimal
 * .pebble and an ai-provider.json using the offline `mock` provider, spawns the MCP
 * server over stdio and drives the full loop: initialize → tools/list → enhance_set_queue
 * → enhance_set_settings → enhance_generate → enhance_compare_faces → enhance_composite
 * → enhance_get_queue → enhance_view final. Exits 1 on any failed assertion.
 */
import { spawn } from 'node:child_process';
import { promises as fs } from 'node:fs';
import fss from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, '..', 'pebble-mcp-server.mjs');
const args = process.argv.slice(2);
const flag = (n) => { const i = args.indexOf(n); if (i < 0) return undefined; const v = args[i + 1]; args.splice(i, 2); return v; };
const keep = args.includes('--keep'); if (keep) args.splice(args.indexOf('--keep'), 1);
const outParent = flag('--out') || process.env.PEBBLE_SMOKE_DIR || os.tmpdir();
const photo = args[0] || process.env.PEBBLE_SMOKE_PHOTO;
if (!photo || !fss.existsSync(photo)) {
  console.error('Usage: node mcp/enhance/smoke.mjs <photo-with-one-face.jpg> [--out dir] [--keep]  (or set PEBBLE_SMOKE_PHOTO)');
  process.exit(2);
}

const EXPECTED = ['enhance_provider_status', 'enhance_get_queue', 'enhance_set_settings', 'enhance_set_queue', 'enhance_set_status', 'enhance_generate', 'enhance_compare_faces', 'enhance_composite', 'enhance_view'];
const results = []; let failed = 0;
function check(name, cond, detail = '') { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`); if (!cond) failed += 1; }

await fs.mkdir(outParent, { recursive: true });
const run = await fs.mkdtemp(path.join(outParent, 'enhance-smoke-'));
const home = path.join(run, 'home'); const album = path.join(run, 'album');
await fs.mkdir(home, { recursive: true }); await fs.mkdir(album, { recursive: true });
const fname = path.basename(photo);
await fs.copyFile(photo, path.join(album, fname));
const stem = fname.replace(/\.[^.]+$/, '');
const project = 'EnhanceSmoke';
const pebble = path.join(home, `${project}.pebble`);
const st = await fs.stat(path.join(album, fname));
await fs.writeFile(pebble, JSON.stringify({
  version: '1.0',
  meta: { name: project, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sourceFolder: album, albumWidth: 3600, albumHeight: 2400, dpi: 300, unit: 'px', theme: 'modern_minimal', coverTitle: project, pageCount: 0, autoSave: false },
  pages: [],
  imageRegistry: [{ filename: fname, relativePath: fname, absolutePath: path.join(album, fname), width: 0, height: 0, fileSize: st.size, mimeType: 'image/jpeg', thumbnailPath: '', parsedLabels: {}, usedOnPages: [], skipped: false }],
}, null, 2));
await fs.writeFile(path.join(home, 'ai-provider.json'), JSON.stringify({ provider: 'mock', apiKey: '', model: 'mock' }), { mode: 0o600 });

// ---- MCP client over stdio -------------------------------------------------
const child = spawn(process.execPath, [SERVER], { env: { ...process.env, PEBBLE_HOME: home }, stdio: ['pipe', 'pipe', 'pipe'] });
let stderr = ''; child.stderr.on('data', (d) => { stderr += d; });
const pending = new Map(); let buf = ''; const nonJson = [];
child.stdout.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let msg; try { msg = JSON.parse(line); } catch { nonJson.push(line.slice(0, 200)); continue; }
    const p = pending.get(msg.id); if (p) { pending.delete(msg.id); p(msg); }
  }
});
let nextId = 1;
function rpc(method, params, timeoutMs = 300000) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, timeoutMs);
    pending.set(id, (m) => { clearTimeout(t); resolve(m); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}
const timings = [];
async function call(name, a) {
  const t0 = Date.now();
  const m = await rpc('tools/call', { name, arguments: a });
  const ms = Date.now() - t0; timings.push(`${name.padEnd(24)} ${String(ms).padStart(6)} ms`);
  const res = m.result || {};
  const text = (res.content || []).filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  const images = (res.content || []).filter((c) => c.type === 'image');
  check(`${name} isError=false`, res.isError === false, res.isError ? text.slice(0, 300) : `${ms} ms`);
  let json = null; try { json = JSON.parse(text); } catch { /* not json */ }
  return { json, text, images };
}

let exitCode = 0;
try {
  const t0 = Date.now();
  const init = await rpc('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'enhance-smoke', version: '1' } });
  timings.push(`${'initialize'.padEnd(24)} ${String(Date.now() - t0).padStart(6)} ms`);
  check('initialize', !!init.result?.serverInfo);
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
  const list = await rpc('tools/list', {});
  const names = (list.result?.tools || []).map((t) => t.name);
  const missing = EXPECTED.filter((n) => !names.includes(n));
  check('tools/list has all 9 enhance_* tools', missing.length === 0, missing.length ? `missing ${missing.join(', ')}` : `${names.length} tools total`);

  const ps = await call('enhance_provider_status', {});
  check('provider is mock + configured', ps.json?.configured === true && ps.json?.provider === 'mock');
  check('provider status has no apiKey field', ps.json && !('apiKey' in ps.json));

  await call('enhance_set_queue', { project, add: [fname] });
  await call('enhance_set_settings', { project, scenePrompt: 'a studio portrait, soft window light', maxAttempts: '3', keepFace: 'true' });
  const gen = await call('enhance_generate', { project, filename: fname, prompt: 'A studio portrait with soft window light and a plain warm backdrop.' });
  const g = gen.json || {};
  console.error(`[smoke] generate metrics: ${JSON.stringify(g.metrics)}`);
  check('generate returns a preview image', gen.images.length === 1);
  check('attempt-1.png exists', fss.existsSync(path.join(album, 'enhanced', stem, 'attempt-1.png')), g.path);
  check('source + variant faces detected', !!(g.metrics?.source?.detected && g.metrics?.generated?.detected));
  check('similarity > 0.8 (mock variant)', (g.metrics?.similarity ?? 0) > 0.8, `similarity=${g.metrics?.similarity}`);
  check('mock pose diffs within thresholds', g.metrics && g.metrics.yawDiff <= 8 && g.metrics.pitchDiff <= 8 && g.metrics.rollDiff <= 6, `yaw ${g.metrics?.yawDiff} pitch ${g.metrics?.pitchDiff} roll ${g.metrics?.rollDiff}`);
  check('keep-face mask was sent (mock supports masks)', g.maskUsed === true);

  const cmp = await call('enhance_compare_faces', { project, filename: fname });
  check('compare returns one image', cmp.images.length === 1);

  const comp = await call('enhance_composite', { project, filename: fname, variant: 1 });
  const cm = comp.json?.metrics || {};
  check('final.jpg exists', fss.existsSync(path.join(album, 'enhanced', stem, 'final.jpg')));
  check('alignment residual < 3 px', cm.alignmentResidualPx < 3, `residual=${cm.alignmentResidualPx}px scale=${cm.scale} rot=${cm.rotationDeg}° maskPx=${cm.maskPx}`);
  check('composite returns preview + blend crop', comp.images.length === 2);
  if (comp.images[0]) await fs.writeFile(path.join(run, 'composite-preview.jpg'), Buffer.from(comp.images[0].data, 'base64'));
  if (comp.images[1]) await fs.writeFile(path.join(run, 'blend-crop.jpg'), Buffer.from(comp.images[1].data, 'base64'));
  if (cmp.images[0]) await fs.writeFile(path.join(run, 'compare.jpg'), Buffer.from(cmp.images[0].data, 'base64'));

  const q = await call('enhance_get_queue', { project });
  const item = q.json?.items?.[0];
  check('item done with resultPath', item?.status === 'done' && item?.resultPath === `enhanced/${stem}/final.jpg`, `${item?.status} ${item?.resultPath}`);
  check('attempt 1 accepted', item?.attempts?.[0]?.verdict === 'accepted');

  const proj = JSON.parse(await fs.readFile(pebble, 'utf-8'));
  check('registry gained enhanced/<stem>/final.jpg', proj.imageRegistry.some((r) => r.relativePath === `enhanced/${stem}/final.jpg` && r.mimeType === 'image/jpeg'));
  check('attempts are NOT registered', !proj.imageRegistry.some((r) => /attempt-\d+\.png$/.test(r.relativePath)));

  const view = await call('enhance_view', { project, filename: fname, which: 'final' });
  check('view final ≤ 640 px', view.json && view.json.previewWidth <= 640 && view.json.previewHeight <= 640, `${view.json?.previewWidth}×${view.json?.previewHeight}`);

  // Guard rails.
  const over = await rpc('tools/call', { name: 'enhance_view', arguments: { project, filename: '../etc/passwd', which: 'source' } });
  check('unqueued / traversal filename refused', over.result?.isError === true);

  check('server stdout had only JSON lines', nonJson.length === 0, nonJson.length ? nonJson[0] : '');
  const writes = [];
  (function walk(d) { for (const e of fss.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else writes.push(path.relative(album, p)); } })(album);
  check('album writes confined to enhanced/', writes.every((w) => w === fname || w.startsWith(`enhanced${path.sep}`)), writes.join(', '));
} catch (e) {
  check('smoke run', false, e.message);
} finally {
  child.stdin.end();
  child.kill();
  console.log('\nAI Enhance smoke test');
  console.log(`run folder: ${run}${keep ? ' (kept)' : ' (removed)'}`);
  console.log('\nTimings:'); for (const t of timings) console.log(`  ${t}`);
  console.log('\nChecks:'); for (const r of results) console.log(`  ${r}`);
  console.log(`\n${failed ? `${failed} FAILED` : 'ALL PASSED'} (${results.length} checks)`);
  if (failed && stderr) console.log(`\nserver stderr (tail):\n${stderr.split('\n').slice(-15).join('\n')}`);
  exitCode = failed ? 1 : 0;
  if (!keep) await fs.rm(run, { recursive: true, force: true });
  process.exit(exitCode);
}
