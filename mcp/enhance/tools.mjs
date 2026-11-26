/**
 * tools.mjs — the AI Enhance MCP tools (identity-safe re-imagining).
 * -----------------------------------------------------------------------------
 * Registered by pebble-mcp-server.mjs via registerEnhanceTools(ctx), which hands
 * over the server's helpers (tool/schema/S/projProp/txt/imageContent/loadProject/
 * saveProject/safeImagePath/imgRecord/clamp/toInt/PEBBLE_HOME/log).
 *
 * Loop the agent runs per queued photo: enhance_generate (full-res → the user's
 * provider; agent gets a ≤ 640 px preview + face metrics) → judge → retry
 * (≤ maxAttempts) → enhance_composite (ORIGINAL face aligned + tone-matched onto
 * the variant → enhanced/<stem>/final.jpg, registered in imageRegistry).
 *
 * SANDBOX: every write goes to <sourceFolder>/enhanced/<stem>/ and is validated
 * with safeImagePath (containment + symlink check). The API key is read from
 * <PEBBLE_HOME>/ai-provider.json and never returned or logged.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { readProviderConfig, providerStatus, PROVIDER_DEFAULTS } from './providerConfig.mjs';
import { generateImage, providerSupportsMask } from './providers.mjs';
import { detectFace, compareMetrics } from './face.mjs';
import { compositeFace, keepFaceMaskPng } from './composite.mjs';

export const DEFAULT_IDENTITY_TEXT = "Use the exact person/people from the attached photo as the identity reference. Preserve their face with full accuracy — facial features, face shape, jawline, nose, eyes, eyebrows, lips, and their natural expression exactly as in the reference. Keep the original skin tone, complexion, and any distinguishing marks unchanged. Maintain the original hairstyle's length, color, and texture realistically. Keep body proportions true to the reference. Keep the same head direction, gaze and camera angle. Do not beautify, slim, smooth, age, de-age, reshape, or otherwise reinterpret the identity in any way. The person must remain instantly recognizable as the same individual. Only the scene, wardrobe, lighting, and setting described may change — the identity must not.";
export const POSE_LOCK = 'Keep the same head direction, gaze and framing as the input photo.';
export const ENHANCE_STATUSES = ['pending', 'generating', 'review', 'compositing', 'done', 'failed', 'skipped'];
const ENHANCED_DIR = 'enhanced';
const SEND_MAX = 2048;
const PREVIEW_MAX = 640;
const CROP_MAX = 320;
const THRESH = { yaw: 8, pitch: 8, roll: 6 };

const MODELS_NOTE = 'openai: GPT Image models via /images/edits (mask supported → the face is kept pixel-exact during generation). '
  + 'gemini: Gemini image models via generateContent (no mask → identity text is appended; the face is restored by enhance_composite). '
  + 'openai_compatible: any host speaking the OpenAI images/edits format. mock: offline test provider (re-tinted copy). '
  + `Defaults: openai ${PROVIDER_DEFAULTS.openai.model}, gemini ${PROVIDER_DEFAULTS.gemini.model} — the user can change the model in the Enhance studio.`;

function toBool(v) {
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v === 'boolean') return v;
  const s = String(v).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(s)) return true;
  if (['false', '0', 'no', 'off'].includes(s)) return false;
  return undefined;
}
function toNum(v) { if (v === undefined || v === null || v === '') return undefined; const n = Number(v); return Number.isFinite(n) ? n : undefined; }
function toList(v) {
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) return v.map(String);
  const s = String(v).trim();
  if (s.startsWith('[')) { try { const a = JSON.parse(s); if (Array.isArray(a)) return a.map(String); } catch { /* fallthrough */ } }
  return [s];
}
const nowIso = () => new Date().toISOString();

/** proj.enhance with defaults filled (mutates proj). */
export function ensureEnhance(proj) {
  const e = proj.enhance && typeof proj.enhance === 'object' ? proj.enhance : {};
  if (typeof e.scenePrompt !== 'string') e.scenePrompt = '';
  if (typeof e.identityText !== 'string' || !e.identityText.trim()) e.identityText = DEFAULT_IDENTITY_TEXT;
  if (typeof e.keepFace !== 'boolean') e.keepFace = true;
  const m = Number(e.maxAttempts); e.maxAttempts = Number.isFinite(m) && m >= 1 ? Math.min(6, Math.round(m)) : 3;
  if (!Array.isArray(e.items)) e.items = [];
  for (const it of e.items) { if (!Array.isArray(it.attempts)) it.attempts = []; if (!it.status) it.status = 'pending'; }
  proj.enhance = e;
  return e;
}

function sanitizeStem(name) {
  const s = String(name).replace(/\.[^./\\]+$/, '').replace(/[^A-Za-z0-9._\- ]+/g, '_').replace(/^[.\s]+|[.\s]+$/g, '').slice(0, 80);
  return s || 'photo';
}

/** Relative dir (`enhanced/<stem>[-n]`) owned by this item; stable once it has outputs. */
async function itemDir(ctx, proj, item) {
  const known = item.attempts?.[0]?.path || item.resultPath;
  if (known) return path.posix.dirname(known);
  const stem = sanitizeStem(path.basename(item.filename));
  const used = new Set();
  for (const it of proj.enhance.items) {
    if (it === item) continue;
    const p = it.attempts?.[0]?.path || it.resultPath;
    if (p) used.add(path.posix.dirname(p));
  }
  for (let i = 1; i < 1000; i += 1) {
    const rel = `${ENHANCED_DIR}/${i === 1 ? stem : `${stem}-${i}`}`;
    if (used.has(rel)) continue;
    // Skip a folder left on disk by an earlier (removed) queue entry — never overwrite its files.
    // eslint-disable-next-line no-await-in-loop
    const exists = await fs.access(ctx.safeImagePath(proj, rel)).then(() => true, () => false);
    if (exists) continue;
    return rel;
  }
  throw new Error('Could not allocate an output folder under enhanced/.');
}

/** Resolve + create an output folder strictly inside <sourceFolder>/enhanced/. */
async function ensureOutDir(ctx, proj, rel) {
  if (!rel.startsWith(`${ENHANCED_DIR}/`)) throw new Error('Refused: enhance outputs must stay under enhanced/.');
  const encFull = ctx.safeImagePath(proj, ENHANCED_DIR);
  await fs.mkdir(encFull, { recursive: true });
  ctx.safeImagePath(proj, ENHANCED_DIR); // re-check after creation (symlink escape)
  const full = ctx.safeImagePath(proj, rel);
  await fs.mkdir(full, { recursive: true });
  return ctx.safeImagePath(proj, rel);
}
function outFile(ctx, proj, rel) {
  if (!rel.startsWith(`${ENHANCED_DIR}/`)) throw new Error('Refused: enhance outputs must stay under enhanced/.');
  return ctx.safeImagePath(proj, rel);
}

function findItem(proj, filename) {
  const f = String(filename || '');
  const it = proj.enhance.items.find((i) => i.filename === f);
  if (it) return it;
  const base = proj.enhance.items.filter((i) => path.basename(i.filename) === f);
  return base.length === 1 ? base[0] : null;
}
function requireItem(proj, filename) {
  if (!filename) throw new Error('Missing "filename" (the queued photo\'s relativePath).');
  const it = findItem(proj, filename);
  if (!it) throw new Error(`"${filename}" is not in the Enhance queue. Add it with enhance_set_queue { add: ["${filename}"] }, then retry.`);
  return it;
}
function sourcePathOf(ctx, proj, item) {
  const rec = ctx.imgRecord(proj, item.filename);
  return ctx.safeImagePath(proj, rec?.relativePath || item.filename);
}
function pickAttempt(item, variant, { preferAccepted = false } = {}) {
  if (!item.attempts.length) throw new Error(`"${item.filename}" has no generated attempts yet — call enhance_generate first.`);
  const n = toInt(variant);
  if (n !== undefined) {
    const a = item.attempts.find((x) => x.n === n);
    if (!a) throw new Error(`Attempt ${n} not found (have: ${item.attempts.map((x) => x.n).join(', ')}).`);
    return a;
  }
  if (preferAccepted) { const acc = [...item.attempts].reverse().find((x) => x.verdict === 'accepted'); if (acc) return acc; }
  return item.attempts[item.attempts.length - 1];
}
function toInt(v) { if (v === undefined || v === null || v === '') return undefined; const n = Number(v); return Number.isFinite(n) ? Math.round(n) : undefined; }

async function previewJpeg(input, maxW = PREVIEW_MAX, quality = 62) {
  const w = Math.max(160, Math.min(PREVIEW_MAX, Math.round(maxW)));
  return sharp(input).rotate().resize(w, w, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality }).toBuffer();
}

/** Face crop (box padded 60%) of an image, ≤ maxW wide; falls back to a centre crop. */
async function faceCrop(input, det, maxW = CROP_MAX) {
  const W = det.width; const H = det.height;
  let x; let y; let w; let h;
  if (det.face) {
    const b = det.face.box; const pad = 0.6;
    const side = Math.max(b.width, b.height) * (1 + 2 * pad);
    const cx = b.x + b.width / 2; const cy = b.y + b.height / 2;
    w = Math.min(W, side); h = Math.min(H, side * 1.15);
    x = Math.max(0, Math.min(W - w, cx - w / 2)); y = Math.max(0, Math.min(H - h, cy - h / 2));
  } else { w = Math.min(W, H); h = w; x = (W - w) / 2; y = (H - h) / 2; }
  const ext = { left: Math.round(x), top: Math.round(y), width: Math.max(1, Math.min(W - Math.round(x), Math.round(w))), height: Math.max(1, Math.min(H - Math.round(y), Math.round(h))) };
  return sharp(input).rotate().extract(ext).resize(maxW, Math.round(maxW * 1.25), { fit: 'inside' }).jpeg({ quality: 70 }).toBuffer();
}

async function sideBySide(a, b, labels) {
  const ma = await sharp(a).metadata(); const mb = await sharp(b).metadata();
  const gap = 8; const head = 22;
  const W = ma.width + mb.width + gap; const H = Math.max(ma.height, mb.height) + head;
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${head}"><style>text{font:600 13px sans-serif;fill:#333}</style><text x="4" y="16">${esc(labels[0])}</text><text x="${ma.width + gap + 4}" y="16">${esc(labels[1])}</text></svg>`);
  return sharp({ create: { width: W, height: H, channels: 3, background: '#ffffff' } })
    .composite([{ input: svg, left: 0, top: 0 }, { input: a, left: 0, top: head }, { input: b, left: ma.width + gap, top: head }])
    .jpeg({ quality: 70 }).toBuffer();
}

function verdictHint(m) {
  if (!m.source?.detected) return 'No face detected in the SOURCE photo — composite needs a face; judge the scene visually or set_status skipped.';
  if (!m.generated?.detected) return 'No face detected in the variant — regenerate (state that the face must stay visible, same framing).';
  const bad = [];
  if (m.yawDiff > THRESH.yaw) bad.push(`yaw off by ${m.yawDiff}°`);
  if (m.pitchDiff > THRESH.pitch) bad.push(`pitch off by ${m.pitchDiff}°`);
  if (m.rollDiff > THRESH.roll) bad.push(`roll off by ${m.rollDiff}°`);
  const faceNote = m.generated.faces !== m.source.faces ? ` Face count changed (${m.source.faces} → ${m.generated.faces}).` : '';
  if (bad.length) return `Pose mismatch: ${bad.join(', ')} — regenerate stating the exact head direction, gaze and crop.${faceNote}`;
  return `Pose OK (yaw ${m.yawDiff}°, pitch ${m.pitchDiff}°, roll ${m.rollDiff}°; limits ${THRESH.yaw}/${THRESH.pitch}/${THRESH.roll}). Check the scene in the preview, then enhance_composite.${faceNote}`;
}

async function readProvider(home) {
  try { return { cfg: await readProviderConfig(home), error: null }; } catch (e) { return { cfg: null, error: e.message }; }
}

function counts(items) {
  const c = { total: items.length };
  for (const s of ENHANCE_STATUSES) c[s] = 0;
  for (const it of items) c[it.status] = (c[it.status] || 0) + 1;
  return c;
}

export function registerEnhanceTools(ctx) {
  const { tool, schema, S, projProp, txt, imageContent, loadProject, saveProject, log, PEBBLE_HOME } = ctx;
  const fileProp = { filename: { ...S.str, description: 'Queued photo — its registry relativePath (from enhance_get_queue / list_images).' } };
  const variantProp = { variant: { type: ['integer', 'string'], description: 'Attempt number (default: latest / accepted).' } };

  async function edit(project, fn) {
    const { proj, filePath } = await loadProject(project);
    ensureEnhance(proj);
    const r = await fn(proj);
    await saveProject(filePath, proj);
    return r;
  }

  tool('enhance_provider_status', 'AI Enhance: is an image-generation provider configured (the user sets it in the app\'s Enhance studio)? Returns provider, model, a masked key hint (never the key), and whether it supports a keep-face mask. Stop and tell the user if configured:false.',
    schema({}), async () => {
      const { cfg, error } = await readProvider(PEBBLE_HOME);
      const st = providerStatus(cfg, PEBBLE_HOME);
      return [txt({ ...st, supportsMask: cfg ? providerSupportsMask(cfg) : false, ...(error ? { error } : {}), modelsNote: MODELS_NOTE })];
    });

  tool('enhance_get_queue', 'AI Enhance: the project\'s Enhance settings (scenePrompt, identityText, keepFace, maxAttempts), provider status, and the queue — each photo with status (pending/generating/review/compositing/done/failed/skipped), attempts (n, path, verdict, note, metrics) and resultPath — plus counts.',
    schema({ ...projProp }, ['project']), async ({ project }) => {
      const { proj } = await loadProject(project);
      const e = ensureEnhance(proj);
      const { cfg, error } = await readProvider(PEBBLE_HOME);
      return [txt({
        scenePrompt: e.scenePrompt, identityText: e.identityText, keepFace: e.keepFace, maxAttempts: e.maxAttempts,
        provider: { ...providerStatus(cfg, PEBBLE_HOME), ...(error ? { error } : {}) },
        items: e.items.map((it) => ({
          filename: it.filename, status: it.status,
          attempts: it.attempts.map((a) => ({ n: a.n, path: a.path, verdict: a.verdict, note: a.note, metrics: a.metrics })),
          resultPath: it.resultPath, note: it.note,
        })),
        counts: counts(e.items),
      })];
    });

  tool('enhance_set_settings', 'AI Enhance: change the Enhance settings (same as the studio form): scenePrompt (what changes), identityText (what must not), keepFace (inpaint around the face when the provider supports a mask), maxAttempts (1–6 generations per photo).',
    schema({ ...projProp, scenePrompt: S.str, identityText: { ...S.str, description: 'Empty string resets to the default identity paragraph.' }, keepFace: S.bool, maxAttempts: S.int }, ['project']),
    async ({ project, scenePrompt, identityText, keepFace, maxAttempts }) => edit(project, (proj) => {
      const e = proj.enhance;
      if (scenePrompt !== undefined) e.scenePrompt = String(scenePrompt);
      if (identityText !== undefined) e.identityText = String(identityText).trim() ? String(identityText) : DEFAULT_IDENTITY_TEXT;
      const kf = toBool(keepFace); if (kf !== undefined) e.keepFace = kf;
      const m = toInt(maxAttempts); if (m !== undefined) e.maxAttempts = Math.max(1, Math.min(6, m));
      return [txt({ ok: true, scenePrompt: e.scenePrompt, identityTextIsDefault: e.identityText === DEFAULT_IDENTITY_TEXT, keepFace: e.keepFace, maxAttempts: e.maxAttempts })];
    }));

  tool('enhance_set_queue', 'AI Enhance: add / remove photos from the Enhance queue (same as ticking photos in the studio). Filenames are registry relativePaths (list_images). Removing keeps files already written under enhanced/.',
    schema({ ...projProp, add: { type: 'array', items: S.str }, remove: { type: 'array', items: S.str } }, ['project']),
    async ({ project, add, remove }) => edit(project, (proj) => {
      const e = proj.enhance; const added = []; const already = []; const removed = []; const missing = [];
      for (const f of toList(add)) {
        const rec = ctx.imgRecord(proj, f);
        if (!rec) throw new Error(`"${f}" is not a photo of this album (use list_images).`);
        const rel = rec.relativePath || rec.filename;
        ctx.safeImagePath(proj, rel);
        if (e.items.some((i) => i.filename === rel)) { already.push(rel); continue; }
        e.items.push({ filename: rel, status: 'pending', attempts: [], updatedAt: nowIso() });
        added.push(rel);
      }
      for (const f of toList(remove)) {
        const it = findItem(proj, f);
        if (!it) { missing.push(f); continue; }
        e.items = e.items.filter((i) => i !== it); removed.push(it.filename);
      }
      return [txt({ added, alreadyQueued: already, removed, notQueued: missing, queued: e.items.length })];
    }));

  tool('enhance_set_status', `AI Enhance: set a queued photo's status (${ENHANCE_STATUSES.join(' / ')}) with an optional note — e.g. "failed" after maxAttempts, or "skipped".`,
    schema({ ...projProp, ...fileProp, status: { type: 'string', enum: ENHANCE_STATUSES }, note: S.str }, ['project', 'filename', 'status']),
    async ({ project, filename, status, note }) => edit(project, (proj) => {
      if (!ENHANCE_STATUSES.includes(status)) throw new Error(`Invalid status "${status}". Valid: ${ENHANCE_STATUSES.join(', ')}.`);
      const it = requireItem(proj, filename);
      it.status = status; if (note !== undefined) it.note = String(note); it.updatedAt = nowIso();
      return [txt({ ok: true, filename: it.filename, status: it.status, note: it.note })];
    }));

  tool('enhance_generate', 'AI Enhance: generate ONE scene variant of a queued photo with the user\'s configured image API. The full-res photo (≤ 2048 px) goes only to that provider; you get back a ≤ 640 px preview + face metrics (yawDiff/pitchDiff/rollDiff in °, similarity 0..1) and a verdictHint. Writes enhanced/<stem>/attempt-<n>.png, status → review. Enforces maxAttempts. The identity text is appended when the provider cannot keep the face via a mask (or keepFace is false); a pose-lock line is always appended.',
    schema({ ...projProp, ...fileProp, prompt: { ...S.str, description: 'Scene/wardrobe/lighting for THIS photo (+ identity rules).' }, keepFace: S.bool, size: { ...S.str, description: 'Provider size, e.g. auto | 1024x1536 (default: provider setting).' }, quality: { ...S.str, description: 'Provider quality, e.g. high (default: provider setting).' } }, ['project', 'filename', 'prompt']),
    async ({ project, filename, prompt, keepFace, size, quality }) => {
      if (!String(prompt || '').trim()) throw new Error('A prompt is required.');
      const t0 = Date.now();
      const { proj, filePath } = await loadProject(project);
      const e = ensureEnhance(proj);
      const item = requireItem(proj, filename);
      if (item.attempts.length >= e.maxAttempts) {
        throw new Error(`maxAttempts (${e.maxAttempts}) reached for "${item.filename}". Composite the best attempt (enhance_composite {variant}), or call enhance_set_status { status: "failed" | "skipped", note }.`);
      }
      const { cfg, error } = await readProvider(PEBBLE_HOME);
      if (!cfg) throw new Error(error || 'No image provider configured. Ask the user to set one up in the app: AI Enhance studio → Image API → Save.');
      const src = sourcePathOf(ctx, proj, item);
      const dirRel = await itemDir(ctx, proj, item);
      const n = item.attempts.reduce((mx, a) => Math.max(mx, a.n || 0), 0) + 1;
      const relOut = `${dirRel}/attempt-${n}.png`;

      // Upright, ≤ 2048 px copy to send. Dims from the resize info (EXIF-rotated).
      const sendMime = cfg.provider === 'gemini' ? 'image/jpeg' : 'image/png';
      let pipe = sharp(src).rotate().resize(SEND_MAX, SEND_MAX, { fit: 'inside', withoutEnlargement: true }).removeAlpha();
      pipe = sendMime === 'image/jpeg' ? pipe.jpeg({ quality: 92 }) : pipe.png();
      const { data: sendBuf, info: sendInfo } = await pipe.toBuffer({ resolveWithObject: true });

      const srcDet = await detectFace(src);
      const kf = toBool(keepFace) ?? e.keepFace;
      let mask; let maskNote = '';
      if (kf && providerSupportsMask(cfg)) {
        if (srcDet.face) {
          const k = sendInfo.width / srcDet.width;
          mask = await keepFaceMaskPng(srcDet.face.landmarks.map((p) => [p[0] * k, p[1] * k]), sendInfo.width, sendInfo.height);
          maskNote = 'keep-face mask sent';
        } else maskNote = 'no face found in the source — sent without a mask';
      }
      let fullPrompt = String(prompt).trim();
      if (!mask && !fullPrompt.includes(e.identityText.trim())) fullPrompt += `\n\n${e.identityText.trim()}`;
      fullPrompt += `\n\n${POSE_LOCK}`;

      // Mark "generating" so the studio can show progress (separate save).
      item.status = 'generating'; item.updatedAt = nowIso();
      await saveProject(filePath, proj);
      let gen; let genMs; let png; let meta; let metrics;
      try {
        gen = await generateImage(cfg, { image: sendBuf, mime: sendMime, mask, prompt: fullPrompt, size: size || cfg.size, quality: quality || cfg.quality });
        genMs = Date.now() - t0;
        await ensureOutDir(ctx, proj, dirRel);
        const outAbs = outFile(ctx, proj, relOut);
        png = /png/i.test(gen.mime || '') ? gen.buffer : await sharp(gen.buffer).png().toBuffer();
        await fs.writeFile(outAbs, png);
        meta = await sharp(png).metadata();
        const varDet = await detectFace(outAbs);
        metrics = compareMetrics(srcDet, varDet);
      } catch (err) {
        // Never leave the item stuck in "generating" (provider error, undecodable output, write failure…).
        const fresh = await loadProject(project); ensureEnhance(fresh.proj);
        const it2 = findItem(fresh.proj, item.filename);
        if (it2) { it2.status = it2.attempts.length ? 'review' : 'pending'; it2.note = `Last generation failed: ${err.message}`; it2.updatedAt = nowIso(); await saveProject(fresh.filePath, fresh.proj); }
        throw err;
      }

      // Re-read (the studio may have saved meanwhile), then append the attempt.
      const fresh = await loadProject(project);
      ensureEnhance(fresh.proj);
      let it = findItem(fresh.proj, item.filename);
      if (!it) { it = { filename: item.filename, status: 'pending', attempts: [], updatedAt: nowIso() }; fresh.proj.enhance.items.push(it); }
      const attempt = {
        n, path: relOut, prompt: fullPrompt, provider: cfg.provider, model: gen.model || cfg.model, createdAt: nowIso(),
        width: meta.width || 0, height: meta.height || 0, verdict: 'pending', metrics,
        ...(gen.note || maskNote ? { note: [maskNote, gen.note].filter(Boolean).join('; ') } : {}),
      };
      it.attempts = it.attempts.filter((a) => a.n !== n).concat(attempt);
      it.status = 'review'; it.updatedAt = nowIso(); delete it.note;
      await saveProject(fresh.filePath, fresh.proj);
      const prev = await previewJpeg(png);
      log(`enhance_generate ${item.filename} #${n} via ${cfg.provider} in ${Date.now() - t0} ms`);
      return [txt({
        attempt: n, of: e.maxAttempts, path: relOut, provider: cfg.provider, model: attempt.model,
        width: attempt.width, height: attempt.height, maskUsed: !!mask, metrics, verdictHint: verdictHint(metrics),
        note: attempt.note, generationMs: genMs,
      }), imageContent(prev.toString('base64'))];
    });

  tool('enhance_compare_faces', 'AI Enhance: side-by-side face crops (source | variant, each ≤ 320 px, padded 60% around the face) plus the metrics. variant = attempt number (default latest) or "final".',
    schema({ ...projProp, ...fileProp, ...variantProp }, ['project', 'filename']),
    async ({ project, filename, variant }) => {
      const { proj } = await loadProject(project);
      ensureEnhance(proj);
      const item = requireItem(proj, filename);
      const src = sourcePathOf(ctx, proj, item);
      let rel; let label;
      if (String(variant ?? '').trim().toLowerCase() === 'final') {
        if (!item.resultPath) throw new Error('No final yet — run enhance_composite first.');
        rel = item.resultPath; label = 'final';
      } else { const a = pickAttempt(item, variant); rel = a.path; label = `attempt ${a.n}`; }
      const vAbs = outFile(ctx, proj, rel);
      const [sd, vd] = [await detectFace(src), await detectFace(vAbs)];
      const metrics = compareMetrics(sd, vd);
      const img = await sideBySide(await faceCrop(src, sd), await faceCrop(vAbs, vd), ['source', label]);
      return [txt({ variant: label, path: rel, metrics, verdictHint: verdictHint(metrics) }), imageContent(img.toString('base64'))];
    });

  tool('enhance_composite', 'AI Enhance: put the ORIGINAL face back onto a variant — 5-point alignment, feathered landmark mask, Lab skin-tone match — and write enhanced/<stem>/final.jpg (registered as an album photo). Marks the attempt accepted and the photo done. Returns metrics + a ≤ 640 px preview + a ≤ 320 px blend face crop. Tune: feather 0..0.5 (fade width, fraction of face width, default 0.12), toneMatch 0..1 (0.85), expand 0.8..1.5 (mask scale, 1.05), maskTop 0..0.8 (forehead above the brows, fraction of face height, 0.35).',
    schema({ ...projProp, ...fileProp, ...variantProp, feather: S.num, toneMatch: S.num, expand: S.num, maskTop: S.num }, ['project', 'filename']),
    async ({ project, filename, variant, feather, toneMatch, expand, maskTop }) => {
      const t0 = Date.now();
      const { proj } = await loadProject(project);
      ensureEnhance(proj);
      const item = requireItem(proj, filename);
      const att = pickAttempt(item, variant, { preferAccepted: true });
      const src = sourcePathOf(ctx, proj, item);
      const vAbs = outFile(ctx, proj, att.path);
      const sd = await detectFace(src);
      if (!sd.face) throw new Error('No face detected in the source photo — nothing to composite. Use enhance_set_status (skipped) or keep the variant as is.');
      const vd = await detectFace(vAbs);
      if (!vd.face) throw new Error(`No face detected in attempt ${att.n} — generate again (the face must be visible).`);
      const opts = {
        feather: clampN(toNum(feather), 0, 0.5, 0.12), toneMatch: clampN(toNum(toneMatch), 0, 1, 0.85),
        expand: clampN(toNum(expand), 0.8, 1.5, 1.05), maskTop: clampN(toNum(maskTop), 0, 0.8, 0.35),
      };
      const res = await compositeFace({ sourcePath: src, sourceFace: { landmarks: sd.face.landmarks, width: sd.width, height: sd.height }, variantPath: vAbs, variantFace: { landmarks: vd.face.landmarks }, ...opts });
      const dirRel = path.posix.dirname(att.path);
      await ensureOutDir(ctx, proj, dirRel);
      const relFinal = `${dirRel}/final.jpg`;
      const finalAbs = outFile(ctx, proj, relFinal);
      await fs.writeFile(finalAbs, res.buffer);

      const fresh = await loadProject(project);
      ensureEnhance(fresh.proj);
      const p2 = fresh.proj;
      p2.imageRegistry = p2.imageRegistry || [];
      const existing = p2.imageRegistry.find((r) => r.relativePath === relFinal);
      const rec = {
        filename: relFinal, relativePath: relFinal, absolutePath: finalAbs,
        width: res.width, height: res.height, fileSize: res.buffer.length, mimeType: 'image/jpeg',
        thumbnailPath: '', parsedLabels: {}, usedOnPages: [], skipped: false,
      };
      if (existing) Object.assign(existing, { width: rec.width, height: rec.height, fileSize: rec.fileSize, absolutePath: finalAbs, mimeType: 'image/jpeg' });
      else p2.imageRegistry.push(rec);
      const it = findItem(p2, item.filename) || item;
      if (!p2.enhance.items.includes(it)) p2.enhance.items.push(it);
      for (const a of it.attempts) {
        if (a.n === att.n) a.verdict = 'accepted';
        else if (a.verdict === 'accepted') a.verdict = 'rejected';
      }
      it.status = 'done'; it.resultPath = relFinal; it.updatedAt = nowIso(); delete it.note;
      await saveProject(fresh.filePath, p2);

      const prev = await previewJpeg(res.buffer);
      const fdet = { width: res.width, height: res.height, face: { box: res.faceBox } };
      const crop = await faceCrop(res.buffer, fdet);
      const metrics = { alignmentResidualPx: res.alignmentResidualPx, scale: res.scale, rotationDeg: res.rotationDeg, maskPx: res.maskPx };
      return [txt({
        ok: true, variant: att.n, path: relFinal, width: res.width, height: res.height, registered: !existing ? 'added' : 'updated',
        metrics, params: opts, ms: Date.now() - t0,
        hint: 'Check the blend crop: visible seam/halo → larger feather (0.18–0.25); tone off → adjust toneMatch; face misplaced → generate again.',
      }), imageContent(prev.toString('base64')), imageContent(crop.toString('base64'))];
    });

  tool('enhance_view', 'AI Enhance: preview (≤ 640 px JPEG) of a queued photo\'s source, one attempt, or the final. Attempts are not album photos, so view_image cannot show them.',
    schema({ ...projProp, ...fileProp, which: { type: 'string', enum: ['source', 'attempt', 'final'] }, attempt: S.int, maxWidth: S.int }, ['project', 'filename', 'which']),
    async ({ project, filename, which, attempt, maxWidth }) => {
      const { proj } = await loadProject(project);
      ensureEnhance(proj);
      const item = requireItem(proj, filename);
      let abs; let rel;
      if (which === 'source') { abs = sourcePathOf(ctx, proj, item); rel = item.filename; }
      else if (which === 'final') { if (!item.resultPath) throw new Error('No final yet — run enhance_composite first.'); rel = item.resultPath; abs = outFile(ctx, proj, rel); }
      else if (which === 'attempt') { const a = pickAttempt(item, attempt); rel = a.path; abs = outFile(ctx, proj, rel); }
      else throw new Error('which must be "source", "attempt" or "final".');
      const buf = await previewJpeg(abs, toInt(maxWidth) ?? PREVIEW_MAX);
      const m = await sharp(buf).metadata();
      return [txt({ which, path: rel, previewWidth: m.width, previewHeight: m.height, bytes: buf.length }), imageContent(buf.toString('base64'))];
    });
}

function clampN(v, lo, hi, d) { return v === undefined ? d : Math.max(lo, Math.min(hi, v)); }
