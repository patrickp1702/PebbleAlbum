#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * pebble-mcp-server.mjs
 * =============================================================================
 * PebbleAlbum MCP server — lets an AI agent design albums by operating directly
 * on the `.pebble` project files (the single source of truth the desktop app
 * reads/writes). It speaks the Model Context Protocol over stdio (newline-
 * delimited JSON-RPC 2.0) and depends only on Node built-ins + `sharp`.
 *
 * It exposes tools for EVERYTHING a user can do in the app — pages, image
 * placement/transform/effects/borders (incl. gradient + decorative SVG frames),
 * decorations, stickers, text & proverbs, theme — plus low-cost VISION tools
 * (`render_page`, `view_image`) that return small JPEGs so the model can see a
 * page/photo without huge token cost, and SKILL tools that teach the agent how
 * to use the app.
 *
 * It is launched by the agent's MCP client; the desktop app provides the exact
 * launch config + a starter prompt via its "Connect AI" panel.
 *
 * IMPORTANT: stdout is reserved for protocol messages. All logging → stderr.
 */
import { promises as fs } from 'node:fs';
import fss from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = process.env.PEBBLE_APP_ROOT || path.join(HERE, '..');
// Dirs are overridable via env so the app can point a packaged build at its
// resources (a plain Node process can't read inside an Electron asar archive).
const CONFIG_DIR = process.env.PEBBLE_CONFIG_DIR || path.join(APP_ROOT, 'src', 'config');
const ASSETS_DIR = process.env.PEBBLE_ASSETS_DIR || path.join(APP_ROOT, 'assets');
const SKILLS_DIR = process.env.PEBBLE_SKILLS_DIR || path.join(HERE, 'skills');
const PEBBLE_HOME = process.env.PEBBLE_HOME || path.join(os.homedir(), 'Documents', 'Pebble');
const SERVER_NAME = 'pebble-album';
const SERVER_VERSION = '1.0.0';

const log = (...a) => console.error('[pebble-mcp]', ...a);

// ---------------------------------------------------------------------------
// Catalogs (read from the app's config so ids always match what the app knows).
// ---------------------------------------------------------------------------
function readJsonSync(p, fallback) {
  try { return JSON.parse(fss.readFileSync(p, 'utf-8')); } catch { return fallback; }
}
const LAYOUTS = readJsonSync(path.join(CONFIG_DIR, 'layouts.json'), []);
const THEMES = readJsonSync(path.join(CONFIG_DIR, 'themes.json'), []);
const PATTERNS = (readJsonSync(path.join(CONFIG_DIR, 'patterns.json'), { patterns: [] }).patterns) || [];
const FONTS = (readJsonSync(path.join(CONFIG_DIR, 'fonts.json'), { fonts: [] }).fonts) || [];
const FILTERS = ['none', 'auto_enhance', 'bw', 'noir', 'silver', 'sepia', 'vivid', 'muted', 'warm', 'warm_skin', 'cool', 'faded', 'dramatic', 'portrait_glow', 'lomo', 'chrome', 'fade', 'matte_film', 'cinematic', 'kodachrome', 'technicolor', 'polaroid', 'vintage', 'brownie'];
/** Shape masks a photo can be clipped to (mirrors src/engine/maskShapes.ts). */
const MASK_IDS = ['circle', 'ellipse', 'squircle', 'heart', 'star', 'hexagon', 'diamond', 'arch', 'blob', 'scallop'];
/** Per-image adjust sliders (mirrors ImageEffects) with their valid ranges. */
const ADJUST_KEYS = ['brightness', 'contrast', 'saturation', 'vignette', 'blur', 'exposure', 'temperature', 'tint', 'hue', 'highlights', 'shadows', 'noise', 'filterStrength'];
// Keep in sync with src/engine/borderFrames.ts BORDER_FRAMES.
const BORDER_FRAMES = ['scallop_fan', 'scallop', 'dots', 'dashes', 'zigzag', 'wave', 'greek_key', 'rope', 'beads', 'deco_lines', 'vine', 'hearts', 'triangles', 'washi_tape', 'film_strip', 'studs', 'pinstripe'];

function listStickerIds() {
  try { return fss.readdirSync(path.join(ASSETS_DIR, 'sticker')).filter((f) => f.endsWith('.svg')).map((f) => f.replace(/\.svg$/, '')); } catch { return []; }
}
function layoutById(id) { return LAYOUTS.find((l) => l.id === id); }
function themeById(id) { return THEMES.find((t) => t.id === id) || THEMES[0]; }

// ---------------------------------------------------------------------------
// SECURITY SANDBOX. The agent may ONLY:
//   • read/write the .pebble project file, inside PEBBLE_HOME (+ its .bak),
//   • read image files INSIDE the project's album source folder, and
//   • write new files ONLY into <sourceFolder>/cutouts/ (remove_background) and
//     <sourceFolder>/.pebble_masks/ (erase_image_region), both album-confined.
// Forbidden: writes/deletes anywhere else, reads outside the album folder,
// absolute paths, "../" traversal, and symlink escapes. (This server deletes no
// files at all.) Every file-touching path goes through the helpers below.
// ---------------------------------------------------------------------------
const PROJECT_ROOT = path.resolve(PEBBLE_HOME);
function isInside(baseResolved, targetResolved) {
  return targetResolved === baseResolved || targetResolved.startsWith(baseResolved + path.sep);
}
/** Reject empty / NUL / absolute / "../" relative paths. */
function assertSafeRelative(rel, label) {
  if (typeof rel !== 'string' || rel.length === 0) throw new Error(`${label}: a relative path is required.`);
  if (rel.includes('\0')) throw new Error(`${label}: illegal NUL byte.`);
  if (path.isAbsolute(rel) || /^[a-zA-Z]:[\\/]/.test(rel)) throw new Error(`${label}: absolute paths are not allowed — use a path relative to the album folder.`);
  if (rel.split(/[\\/]+/).some((s) => s === '..')) throw new Error(`${label}: parent-directory ("..") segments are not allowed.`);
  return rel;
}
/** Resolve a relative image path strictly INSIDE the project's album folder. */
function safeImagePath(proj, rel) {
  const base = proj?.meta?.sourceFolder;
  if (!base) throw new Error('Project has no source folder.');
  assertSafeRelative(rel, 'image path');
  const baseResolved = path.resolve(base);
  const full = path.resolve(baseResolved, rel);
  if (!isInside(baseResolved, full)) throw new Error(`Refused: "${rel}" is outside the album folder.`);
  // Defeat symlink escapes when base + target exist (best effort).
  try {
    const rb = fss.realpathSync(baseResolved); const rf = fss.realpathSync(full);
    if (!isInside(rb, rf)) throw new Error(`Refused: "${rel}" resolves outside the album folder (symlink).`);
  } catch (e) { if (e && typeof e.message === 'string' && e.message.startsWith('Refused')) throw e; /* ENOENT → normalized check stands */ }
  return full;
}
/** Sanitise a sticker/overlay id to a BARE name (never a path). */
function safeAssetId(id) { return String(id || '').replace(/[^a-z0-9_\-]/gi, ''); }

// ---------------------------------------------------------------------------
// Project file IO — restricted to PEBBLE_HOME/*.pebble (+ .bak). Ground truth.
// ---------------------------------------------------------------------------
function sanitize(name) { return String(name).replace(/[^a-z0-9_\- ]/gi, '').trim() || 'album'; }

async function resolveProjectPath(project) {
  if (!project || typeof project !== 'string') throw new Error('Missing "project" (the project name).');
  if (project.includes('\0')) throw new Error('Invalid project name.');
  // Absolute path: allowed ONLY if it is a .pebble file inside PEBBLE_HOME.
  if (path.isAbsolute(project)) {
    const full = path.resolve(project);
    if (isInside(PROJECT_ROOT, full) && full.endsWith('.pebble') && fss.existsSync(full)) return full;
    throw new Error(`Refused: a project must be a .pebble file inside ${PEBBLE_HOME}.`);
  }
  // Otherwise a bare name only — no separators, no traversal.
  if (/[\\/]/.test(project)) throw new Error('Project name must not contain path separators.');
  const base = project.endsWith('.pebble') ? project : `${project}.pebble`;
  assertSafeRelative(base, 'project');
  const direct = path.join(PROJECT_ROOT, base);
  if (isInside(PROJECT_ROOT, path.resolve(direct)) && fss.existsSync(direct)) return direct;
  // Match by meta.name (scan stays within PEBBLE_HOME).
  let files = [];
  try { files = (await fs.readdir(PROJECT_ROOT)).filter((f) => f.endsWith('.pebble')); } catch { /* none */ }
  for (const f of files) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const proj = JSON.parse(await fs.readFile(path.join(PROJECT_ROOT, f), 'utf-8'));
      if ((proj?.meta?.name || '').toLowerCase() === project.toLowerCase()) return path.join(PROJECT_ROOT, f);
    } catch { /* skip */ }
  }
  throw new Error(`Project "${project}" not found in ${PEBBLE_HOME}. Use list_projects to see available projects.`);
}

async function loadProject(project) {
  const filePath = await resolveProjectPath(project);
  const proj = JSON.parse(await fs.readFile(filePath, 'utf-8'));
  return { filePath, proj };
}

async function saveProject(filePath, proj) {
  // Hard guard (defence in depth): only ever write a .pebble (+ .bak) in PEBBLE_HOME.
  const full = path.resolve(filePath);
  if (!isInside(PROJECT_ROOT, full) || !full.endsWith('.pebble')) {
    throw new Error('Refused: project writes are restricted to the Pebble projects folder.');
  }
  if (proj.meta) { proj.meta.updatedAt = new Date().toISOString(); proj.meta.pageCount = (proj.pages || []).length; }
  const json = JSON.stringify(proj, null, 2);
  await fs.writeFile(full, json, 'utf-8');
  await fs.writeFile(`${full}.bak`, json, 'utf-8');
}

// ---------------------------------------------------------------------------
// Small geometry helpers (mirror the app's pageRenderer / collageComposer).
// ---------------------------------------------------------------------------
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
function imgRecord(proj, filename) {
  return (proj.imageRegistry || []).find((r) => r.relativePath === filename || r.filename === filename);
}
function slotRectFromSlot(slot, meta) {
  return { x: slot.x * meta.albumWidth, y: slot.y * meta.albumHeight, width: slot.w * meta.albumWidth, height: slot.h * meta.albumHeight };
}
function coverBox(frame, iw, ih) {
  const s = Math.max(frame.width / (iw || 1), frame.height / (ih || 1));
  const w = (iw || 1) * s; const h = (ih || 1) * s;
  return { x: frame.x + (frame.width - w) / 2, y: frame.y + (frame.height - h) / 2, width: w, height: h };
}
function defaultEffects() {
  return { filter: 'none', brightness: 0, contrast: 0, saturation: 0, sharpness: 0, vignette: 0, blur: 0, noise: 0, tintOpacity: 0 };
}
function newPageImage(proj, filename, slot, meta) {
  const rec = imgRecord(proj, filename);
  const iw = rec?.width || (slot ? slotRectFromSlot(slot, meta).width : meta.albumWidth);
  const ih = rec?.height || (slot ? slotRectFromSlot(slot, meta).height : meta.albumHeight);
  if (slot) {
    const frame = slotRectFromSlot(slot, meta);
    const box = coverBox(frame, iw, ih);
    return {
      id: randomUUID(), filename, slotId: slot.id, slotRect: frame, free: false, fit: 'auto', manual: false,
      position: { x: box.x, y: box.y, width: box.width, height: box.height, rotation: slot.rotation || 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false },
      crop: { x: 0, y: 0, width: 1, height: 1 }, parsedLabels: rec?.parsedLabels || {}, overrides: {},
      effects: defaultEffects(), border: null, shadow: null, opacity: 1, zIndex: 1, visible: true,
    };
  }
  const w = meta.albumWidth * 0.3; const ar = ih ? iw / ih : 1.5; const h = w / ar;
  return {
    id: randomUUID(), filename, slotId: 'free', free: true, fit: 'auto', manual: false,
    position: { x: meta.albumWidth / 2 - w / 2, y: meta.albumHeight / 2 - h / 2, width: w, height: h, rotation: 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false },
    crop: { x: 0, y: 0, width: 1, height: 1 }, parsedLabels: rec?.parsedLabels || {}, overrides: {},
    effects: defaultEffects(), border: null, shadow: null, opacity: 1, zIndex: 500, visible: true,
  };
}
function getPage(proj, page) {
  const pages = proj.pages || [];
  // Accept a numeric index OR a numeric string ("1") — some MCP clients pass
  // numbers as strings, which used to fall through to the id lookup and error.
  const idx = typeof page === 'number' ? page : (/^-?\d+$/.test(String(page).trim()) ? Number(page) : null);
  if (idx !== null) { const p = pages[idx]; if (!p) throw new Error(`No page at index ${idx} (album has ${pages.length} pages).`); return p; }
  const byId = pages.find((p) => p.id === page);
  if (!byId) throw new Error(`Page "${page}" not found.`);
  return byId;
}
/** Coerce a value to an integer or undefined (tolerates numeric strings). */
function toInt(v) { if (v === undefined || v === null || v === '') return undefined; const n = Number(v); return Number.isFinite(n) ? Math.round(n) : undefined; }
function getImage(page, imageId) {
  const im = (page.images || []).find((i) => i.id === imageId);
  if (!im) throw new Error(`Image "${imageId}" not found on this page.`);
  return im;
}

// ---- config validation + normalisers (border/shadow) -----------------------
/** Accept an object or null; coerce a JSON string; otherwise throw loudly. */
function asConfigOrNull(v, name) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') {
    const s = v.trim();
    if (s === '' || s.toLowerCase() === 'null') return null;
    try { const o = JSON.parse(s); if (o && typeof o === 'object') return o; } catch { /* not json */ }
    throw new Error(`${name} must be a JSON object or null — got a string. Example: {"style":"solid","width":6,"color":"#ffffff"}.`);
  }
  if (typeof v !== 'object') throw new Error(`${name} must be an object or null.`);
  return v;
}
const VALID_BORDER_STYLES = ['solid', 'dashed', 'dotted', 'double', 'pattern'];
function normalizeBorder(b) {
  const style = b.style || 'solid';
  if (!VALID_BORDER_STYLES.includes(style)) throw new Error(`Invalid border.style "${style}". Valid: ${VALID_BORDER_STYLES.join(', ')}`);
  if (style === 'pattern' && !BORDER_FRAMES.includes(b.frameId)) throw new Error(`A "pattern" border needs a valid frameId. Valid: ${BORDER_FRAMES.join(', ')}`);
  return { style, width: b.width ?? 6, color: b.color || '#ffffff', radius: b.radius ?? 0, padding: b.padding ?? 0, gradient: b.gradient || null, frameId: b.frameId };
}
function normalizeShadow(s) {
  return { offsetX: s.offsetX ?? 0, offsetY: s.offsetY ?? 8, blur: s.blur ?? 24, spread: s.spread ?? 0, color: s.color || '#000000', opacity: s.opacity ?? 0.35 };
}
/** Named style presets → {border, shadow}, sized relative to the album (DPI-safe). */
function expandPreset(name, meta) {
  const u = Math.max(2, Math.round((meta.albumHeight || 1200) * 0.006));
  switch (name) {
    case 'matte_white': return { border: { style: 'solid', width: u * 2, color: '#ffffff', radius: u, padding: 0, gradient: null }, shadow: { offsetX: 0, offsetY: u * 2, blur: u * 5, spread: 0, color: '#000000', opacity: 0.25 } };
    case 'thin_gold': return { border: { style: 'solid', width: Math.max(2, Math.round(u * 0.8)), color: '#c9a227', radius: 0, padding: 0, gradient: null }, shadow: null };
    case 'soft_shadow': return { border: null, shadow: { offsetX: 0, offsetY: u * 2, blur: u * 6, spread: 0, color: '#000000', opacity: 0.3 } };
    case 'polaroid': return { border: { style: 'solid', width: u * 3, color: '#ffffff', radius: 0, padding: 0, gradient: null }, shadow: { offsetX: 0, offsetY: u * 2, blur: u * 4, spread: 0, color: '#000000', opacity: 0.3 } };
    case 'scallop_frame': return { border: { style: 'pattern', frameId: 'scallop_fan', width: Math.round((meta.albumHeight || 1200) * 0.022), color: '#ffffff', radius: 0, padding: 0, gradient: null }, shadow: null };
    case 'none': return { border: null, shadow: null };
    default: return null;
  }
}
const STYLE_PRESETS = ['matte_white', 'thin_gold', 'soft_shadow', 'polaroid', 'scallop_frame', 'none'];

/** Per-slot orientation/aspect for a layout, given album dimensions. */
function layoutSlotMeta(layout, albW, albH) {
  const orient = (a) => (a > 1.15 ? 'landscape' : a < 0.87 ? 'portrait' : 'square');
  const slots = (layout.slots || []).map((s) => {
    const aw = (s.w || 0) * albW; const ah = (s.h || 0) * albH;
    const aspect = ah ? +(aw / ah).toFixed(2) : 0;
    return { id: s.id, aspect, orientation: orient(aspect), areaPct: +(((s.w || 0) * (s.h || 0)) * 100).toFixed(0) };
  });
  const counts = slots.reduce((m, s) => { m[s.orientation] = (m[s.orientation] || 0) + 1; return m; }, {});
  const dominant = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] || 'mixed';
  return { slots, bestForOrientation: dominant };
}

// ---------------------------------------------------------------------------
// Culling: near-duplicate detection + quality (mirrors src/engine/similarity.ts).
// ---------------------------------------------------------------------------
function dHashFromGray(g) {
  let bits = '';
  for (let r = 0; r < 8; r += 1) for (let c = 0; c < 8; c += 1) bits += (g[r * 9 + c] ?? 0) < (g[r * 9 + c + 1] ?? 0) ? '1' : '0';
  let hex = ''; for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}
function hammingHex(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) { let x = (parseInt(a[i], 16) ^ parseInt(b[i], 16)) & 0xf; while (x) { d += x & 1; x >>= 1; } }
  return d;
}
function qualityFromGray(g, w, h) {
  let grad = 0; let sum = 0; let over = 0; let under = 0; let n = 0;
  for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) {
    const i = y * w + x; const v = g[i] ?? 0; sum += v; if (v > 239) over += 1; if (v < 16) under += 1;
    if (x + 1 < w) { const dx = v - (g[i + 1] ?? 0); grad += dx * dx; }
    if (y + 1 < h) { const dy = v - (g[i + w] ?? 0); grad += dy * dy; }
    n += 1;
  }
  n = n || 1; const sharpness = grad / n; const mean = sum / n; const clipOver = over / n; const clipUnder = under / n;
  const exposure = Math.max(0, 1 - (clipOver + clipUnder) * 2.5 - (Math.abs(mean - 125) / 125) * 0.6);
  return { sharpness: +sharpness.toFixed(2), exposure: +exposure.toFixed(3), score: +(sharpness * exposure).toFixed(2), clipOver: +clipOver.toFixed(3), clipUnder: +clipUnder.toFixed(3) };
}
async function analyzeImage(absPath) {
  const hashBuf = await sharp(absPath).rotate().greyscale().resize(9, 8, { fit: 'fill' }).raw().toBuffer();
  const { data, info } = await sharp(absPath).rotate().greyscale().resize(256, 256, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true });
  return { phash: dHashFromGray(hashBuf), quality: qualityFromGray(data, info.width, info.height) };
}
/** Ensure every registry image has phash+quality; (re)build proj.duplicateGroups. Mutates proj. */
async function ensureAnalysis(proj, threshold = 10) {
  const recs = proj.imageRegistry || [];
  for (const r of recs) {
    if (r.phash && r.quality) continue;
    try { const a = await analyzeImage(safeImagePath(proj, r.relativePath)); r.phash = a.phash; r.quality = a.quality; } catch { /* unreadable / outside album */ }
  }
  // union-find clustering
  const parent = recs.map((_, i) => i);
  const find = (i) => { let x = i; while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let i = 0; i < recs.length; i += 1) for (let j = i + 1; j < recs.length; j += 1) {
    const A = recs[i]; const B = recs[j]; if (!A.phash || !B.phash) continue;
    const aspA = A.height ? A.width / A.height : 1; const aspB = B.height ? B.width / B.height : 1;
    if (Math.abs(aspA - aspB) > 0.25) continue;
    if (hammingHex(A.phash, B.phash) <= threshold) { const ra = find(i); const rb = find(j); if (ra !== rb) parent[ra] = rb; }
  }
  const map = new Map();
  recs.forEach((r, i) => { const root = find(i); const arr = map.get(root) ?? []; arr.push(r.relativePath); map.set(root, arr); });
  const qOf = (rp) => recs.find((r) => r.relativePath === rp)?.quality?.score ?? 0;
  const groups = [...map.values()].filter((m) => m.length >= 2).map((members, idx) => {
    const sorted = members.slice().sort((a, b) => qOf(b) - qOf(a));
    return { id: `grp_${idx + 1}`, members: sorted, suggested: sorted[0] };
  });
  proj.duplicateGroups = groups;
  return groups;
}
/** Park (hide) any placed PageImages whose filename is now skipped. */
function parkSkipped(proj) {
  const skip = new Set((proj.imageRegistry || []).filter((r) => r.skipped).map((r) => r.relativePath));
  for (const pg of (proj.pages || [])) for (const im of (pg.images || [])) if (skip.has(im.filename) && im.visible !== false) im.visible = false;
}

// ---------------------------------------------------------------------------
// Vision: render a page or image to a small JPEG (base64) using sharp.
// ---------------------------------------------------------------------------
function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function buildOverlaySvg(proj, page, scale, W, H) {
  const parts = [];
  const texts = (page.textBlocks || []).filter((t) => t.visible !== false).slice();
  if (page.proverb && !texts.some((t) => t.type === 'proverb')) {
    texts.push({ content: page.proverb, type: 'proverb', position: { x: proj.meta.albumWidth * 0.1, y: proj.meta.albumHeight * 0.86, width: proj.meta.albumWidth * 0.8, rotation: 0 }, style: { fontFamily: 'serif', fontSize: Math.round(proj.meta.albumHeight * 0.03), fontStyle: 'italic', fontWeight: 'normal', color: themeById(proj.meta.theme)?.colors?.text || '#333', align: 'center', opacity: 0.95 } });
  }
  for (const tb of texts) {
    const x = tb.position.x * scale; const y = tb.position.y * scale; const w = (tb.position.width || 200) * scale;
    const fs = Math.max(6, (tb.style.fontSize || 24) * scale);
    const anchor = tb.style.align === 'center' ? 'middle' : tb.style.align === 'right' ? 'end' : 'start';
    const ax = tb.style.align === 'center' ? x + w / 2 : tb.style.align === 'right' ? x + w : x;
    const style = `font-family:${esc(tb.style.fontFamily || 'serif')};font-size:${fs}px;font-style:${tb.style.fontStyle || 'normal'};font-weight:${tb.style.fontWeight || 'normal'};fill:${tb.style.color || '#000'};opacity:${tb.style.opacity ?? 1}`;
    const rot = tb.position.rotation ? ` transform="rotate(${tb.position.rotation} ${ax} ${y})"` : '';
    const lines = String(tb.content || '').split(/\n/);
    let t = `<text x="${ax}" y="${y + fs}" text-anchor="${anchor}" style="${style}"${rot}>`;
    lines.forEach((ln, i) => { t += `<tspan x="${ax}" dy="${i === 0 ? 0 : fs * 1.3}">${esc(ln)}</tspan>`; });
    parts.push(`${t}</text>`);
  }
  for (const d of (page.decorations || [])) {
    if (d.type !== 'sticker') continue;
    const x = d.position.x * scale; const y = d.position.y * scale;
    const sw = (d.position.width || 80) * scale; const sh = (d.position.height || sw) * scale / (scale || 1);
    if (d.params && d.params.emoji) parts.push(`<text x="${x}" y="${y + sw}" style="font-size:${sw}px">${esc(d.params.emoji)}</text>`);
    else if (d.params && d.params.svg) {
      try {
        const sid = safeAssetId(d.params.svg); if (!sid) continue;
        const raw = fss.readFileSync(path.join(ASSETS_DIR, 'sticker', `${sid}.svg`), 'utf-8');
        const b64 = Buffer.from(raw).toString('base64');
        parts.push(`<image x="${x}" y="${y}" width="${sw}" height="${(d.position.height || 80) * scale}" xlink:href="data:image/svg+xml;base64,${b64}"/>`);
      } catch { /* missing sticker */ }
    }
  }
  if (!parts.length) return null;
  return `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink">${parts.join('')}</svg>`;
}

/**
 * Render one photo into its frame cell (preview px fw×fh), mirroring the app's
 * computeImagePlacement: auto slot photos honour focus{x,y} + coverZoom by
 * resizing to the cover size and EXTRACTING the focal window (so faces survive).
 * Manual / free / contain photos use a plain cover/contain resize.
 */
/** Apply an image's erase mask to the WHOLE (EXIF-rotated) source at a working size. Null → no/unreadable mask. */
async function loadMaskedSource(proj, pi, work) {
  if (!pi.eraseMask) return null;
  try {
    const src = safeImagePath(proj, pi.filename);
    const mfile = safeImagePath(proj, pi.eraseMask);
    const base = await sharp(src).rotate().resize(work, work, { fit: 'inside', withoutEnlargement: true }).ensureAlpha().png().toBuffer({ resolveWithObject: true });
    const mk = await sharp(mfile).toColourspace('srgb').ensureAlpha().resize(base.info.width, base.info.height, { fit: 'fill' }).png().toBuffer();
    const input = await sharp(base.data).composite([{ input: mk, blend: 'dest-in' }]).png().toBuffer();
    return { input, w: base.info.width, h: base.info.height };
  } catch (e) { log('eraseMask ignored:', e.message); return null; }
}

async function renderImageCell(proj, pi, fw, fh, bg) {
  const src = safeImagePath(proj, pi.filename);
  const rec = imgRecord(proj, pi.filename);
  let iw = rec?.width || fw; let ih = rec?.height || fh;
  // Non-destructive erase: mask the WHOLE source first, then crop/fit as usual.
  // A missing/unreadable mask → un-masked render.
  let input = src; let masked = false;
  const ms = await loadMaskedSource(proj, pi, clamp(Math.max(fw, fh) * 2, 64, 2048));
  if (ms) { input = ms.input; iw = ms.w; ih = ms.h; masked = true; }
  const finish = (pipe) => (masked ? pipe.png().toBuffer() : pipe.jpeg({ quality: 55 }).toBuffer());
  const clear = { r: 0, g: 0, b: 0, alpha: 0 };
  const auto = !!pi.slotRect && !pi.manual;
  const fCover = Math.max(fw / iw, fh / ih);
  const fContain = Math.min(fw / iw, fh / ih);
  const useContain = pi.fit === 'contain' || (auto && pi.fit !== 'cover' && fCover / fContain > 1.7);
  if (!auto || useContain) {
    return finish(sharp(input).rotate().resize(fw, fh, { fit: useContain ? 'contain' : 'cover', position: 'centre', background: masked ? clear : bg }));
  }
  const zoom = pi.coverZoom && pi.coverZoom > 0 ? pi.coverZoom : 1;
  const s = fCover * zoom;
  const dispW = Math.max(fw, Math.round(iw * s));
  const dispH = Math.max(fh, Math.round(ih * s));
  const fx = pi.focus ? clamp(pi.focus.x, 0, 1) : 0.5;
  const fy = pi.focus ? clamp(pi.focus.y, 0, 1) : 0.5;
  const offX = Math.round(clamp(fx * dispW - fw / 2, 0, dispW - fw));
  const offY = Math.round(clamp(fy * dispH - fh / 2, 0, dispH - fh));
  return finish(sharp(input).rotate().resize(dispW, dispH).extract({ left: offX, top: offY, width: fw, height: fh }));
}

/** Does this photo need the flip / rotate / opacity compositor path? */
function hasTransform(pi) {
  const pos = pi.position || {};
  return !!(pos.flipX || pos.flipY || (Number(pos.rotation) || 0) % 360 !== 0);
}

/**
 * Photo with flip + rotation, mirroring the app (pageRenderer.buildImageObject):
 * the displayed photo box is mirrored about its own centre (flipX/flipY, in the
 * photo's own space), then rotated CLOCKWISE by position.rotation about its
 * TOP-LEFT corner (Fabric originX/Y = left/top). Slotted photos are additionally
 * clipped to the (unrotated) slotRect, as in the app. Returns a PNG layer with
 * its page offset (may be negative / exceed the page; cropped later).
 */
async function renderTransformedPhoto(proj, pi, scale) {
  const src = safeImagePath(proj, pi.filename);
  const rec = imgRecord(proj, pi.filename);
  const pos = pi.position;
  // Display box in album px (port of computeImagePlacement).
  let dx; let dy; let dw; let dh; let clip = null;
  const iw = rec?.width || pos.width; const ih = rec?.height || pos.height;
  if (pi.slotRect && !pi.manual) {
    const f = pi.slotRect;
    const fCover = Math.max(f.width / iw, f.height / ih); const fContain = Math.min(f.width / iw, f.height / ih);
    const baseFit = pi.fit === 'cover' ? fCover : pi.fit === 'contain' ? fContain : (fCover / fContain > 1.7 ? fContain : fCover);
    const sc = baseFit * (pi.coverZoom > 0 ? pi.coverZoom : 1);
    dw = iw * sc; dh = ih * sc;
    const fx = pi.focus ? clamp(pi.focus.x, 0, 1) : 0.5; const fy = pi.focus ? clamp(pi.focus.y, 0, 1) : 0.5;
    dx = f.x + f.width / 2 - fx * dw; dy = f.y + f.height / 2 - fy * dh;
    dx = dw >= f.width ? Math.min(f.x, Math.max(f.x + f.width - dw, dx)) : f.x + (f.width - dw) / 2;
    dy = dh >= f.height ? Math.min(f.y, Math.max(f.y + f.height - dh, dy)) : f.y + (f.height - dh) / 2;
    clip = { x: f.x * scale, y: f.y * scale, w: f.width * scale, h: f.height * scale };
  } else {
    const rw = pos.width / iw; const rh = pos.height / ih;
    const sc = pi.fit === 'contain' ? Math.min(rw, rh) : Math.max(rw, rh);
    dw = iw * sc; dh = ih * sc; dx = pos.x; dy = pos.y;
    if (pi.slotRect) { const f = pi.slotRect; clip = { x: f.x * scale, y: f.y * scale, w: f.width * scale, h: f.height * scale }; }
  }
  const pw = Math.max(1, Math.round(dw * scale)); const ph = Math.max(1, Math.round(dh * scale));
  const ms = await loadMaskedSource(proj, pi, clamp(Math.max(pw, ph) * 2, 64, 2048));
  let buf = await sharp(ms ? ms.input : src).rotate().resize(pw, ph, { fit: 'fill' }).ensureAlpha().png().toBuffer();
  if (pos.flipX) buf = await sharp(buf).flop().png().toBuffer();
  if (pos.flipY) buf = await sharp(buf).flip().png().toBuffer();
  let ox = 0; let oy = 0; let lw = pw; let lh = ph;
  const deg = (((Number(pos.rotation) || 0) % 360) + 360) % 360;
  if (deg !== 0) {
    const t = (deg * Math.PI) / 180; const c = Math.cos(t); const sn = Math.sin(t);
    const xs = [0, pw * c, -ph * sn, pw * c - ph * sn]; const ys = [0, pw * sn, ph * c, pw * sn + ph * c];
    ox = Math.min(...xs); oy = Math.min(...ys);
    const r = await sharp(buf).rotate(deg, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
    buf = r.data; lw = r.info.width; lh = r.info.height;
  }
  return { input: buf, left: Math.round(dx * scale + ox), top: Math.round(dy * scale + oy), w: lw, h: lh, clip };
}

/** Multiply a layer's alpha by `op` (0..1). */
async function applyOpacity(input, op) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let i = 3; i < data.length; i += 4) data[i] = Math.round(data[i] * op);
  return sharp(data, { raw: { width: info.width, height: info.height, channels: 4 } }).png().toBuffer();
}

/** Crop a layer to the page (and optional clip rect) — never shift it. Null when fully outside. */
async function cropLayer(layer, W, H) {
  const c = layer.clip || { x: 0, y: 0, w: W, h: H };
  const x0 = Math.max(layer.left, 0, Math.round(c.x)); const y0 = Math.max(layer.top, 0, Math.round(c.y));
  const x1 = Math.min(layer.left + layer.w, W, Math.round(c.x + c.w)); const y1 = Math.min(layer.top + layer.h, H, Math.round(c.y + c.h));
  if (x1 <= x0 || y1 <= y0) return null;
  if (x0 === layer.left && y0 === layer.top && x1 - x0 === layer.w && y1 - y0 === layer.h) return { input: layer.input, left: x0, top: y0 };
  const input = await sharp(layer.input).extract({ left: x0 - layer.left, top: y0 - layer.top, width: x1 - x0, height: y1 - y0 }).png().toBuffer();
  return { input, left: x0, top: y0 };
}

async function renderPageBuffer(proj, page, maxWidth = 640, quality = 62) {
  const meta = proj.meta;
  const theme = themeById(meta.theme);
  const scale = clamp(maxWidth, 240, 1100) / meta.albumWidth;
  const W = Math.max(1, Math.round(meta.albumWidth * scale));
  const H = Math.max(1, Math.round(meta.albumHeight * scale));
  const bg = page.backgroundColor || theme?.colors?.background || '#ffffff';
  const layers = [];
  // Per-page gradient background (preview): paint it as the bottom layer.
  if (page.backgroundGradient) {
    try {
      const a = ((page.backgroundGradient.angle ?? 135) * Math.PI) / 180;
      const x1 = Math.round(50 - Math.cos(a) * 50); const y1 = Math.round(50 - Math.sin(a) * 50);
      const x2 = Math.round(50 + Math.cos(a) * 50); const y2 = Math.round(50 + Math.sin(a) * 50);
      const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g" x1="${x1}%" y1="${y1}%" x2="${x2}%" y2="${y2}%"><stop offset="0" stop-color="${page.backgroundGradient.from}"/><stop offset="1" stop-color="${page.backgroundGradient.to}"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#g)"/></svg>`;
      layers.push({ input: await sharp(Buffer.from(svg)).png().toBuffer(), left: 0, top: 0 });
    } catch (e) { log('page gradient skipped:', e.message); }
  }
  const imgs = (page.images || []).filter((i) => i.visible !== false).sort((a, b) => (a.zIndex || 0) - (b.zIndex || 0));
  for (const pi of imgs) {
    const fr = pi.slotRect || pi.position;
    // Unclamped frame: a photo partly off the page is CROPPED, never shifted.
    const left = Math.round(fr.x * scale); const top = Math.round(fr.y * scale);
    const fw = Math.max(1, Math.min(Math.round(fr.width * scale), 8192)); const fh = Math.max(1, Math.min(Math.round(fr.height * scale), 8192));
    try {
      let layer;
      // eslint-disable-next-line no-await-in-loop
      if (hasTransform(pi)) layer = await renderTransformedPhoto(proj, pi, scale);
      // eslint-disable-next-line no-await-in-loop
      else layer = { input: await renderImageCell(proj, pi, fw, fh, bg), left, top, w: fw, h: fh };
      const op = pi.opacity === undefined || pi.opacity === null ? 1 : clamp(Number(pi.opacity), 0, 1);
      // eslint-disable-next-line no-await-in-loop
      if (op < 1) layer.input = await applyOpacity(layer.input, op);
      // eslint-disable-next-line no-await-in-loop
      const cropped = await cropLayer(layer, W, H);
      if (cropped) layers.push(cropped);
    } catch {
      const gl = clamp(left, 0, W - 1); const gt = clamp(top, 0, H - 1);
      // eslint-disable-next-line no-await-in-loop
      const gray = await sharp({ create: { width: Math.max(1, Math.min(fw, W - gl)), height: Math.max(1, Math.min(fh, H - gt)), channels: 3, background: '#cfcfcf' } }).jpeg().toBuffer();
      layers.push({ input: gray, left: gl, top: gt });
    }
  }
  try {
    const ov = buildOverlaySvg(proj, page, scale, W, H);
    if (ov) { const ob = await sharp(Buffer.from(ov)).png().toBuffer(); layers.push({ input: ob, left: 0, top: 0 }); }
  } catch (e) { log('overlay raster skipped:', e.message); }
  const out = await sharp({ create: { width: W, height: H, channels: 4, background: bg } })
    .composite(layers).jpeg({ quality: clamp(quality, 30, 85) }).toBuffer();
  return { data: out.toString('base64'), W, H, bytes: out.length };
}

async function viewImageBuffer(proj, filename, maxWidth = 560, quality = 65) {
  const rec = imgRecord(proj, filename);
  const src = safeImagePath(proj, rec?.relativePath || filename);
  const out = await sharp(src).rotate().resize(clamp(maxWidth, 160, 1000), null, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: clamp(quality, 30, 85) }).toBuffer();
  return { data: out.toString('base64'), bytes: out.length };
}

// ---------------------------------------------------------------------------
// Content helpers for tool results.
// ---------------------------------------------------------------------------
const txt = (s) => ({ type: 'text', text: typeof s === 'string' ? s : JSON.stringify(s, null, 2) });
const imageContent = (b64, mime = 'image/jpeg') => ({ type: 'image', data: b64, mimeType: mime });

function pageSummary(p, i) {
  return {
    index: i, id: p.id, type: p.type, layoutId: p.layoutId,
    images: (p.images || []).filter((im) => im.visible !== false).length,
    notPlaced: (p.images || []).filter((im) => im.visible === false).length,
    decorations: (p.decorations || []).length,
    textBlocks: (p.textBlocks || []).length,
    proverb: p.proverb || ((p.textBlocks || []).find((t) => t.type === 'proverb')?.content) || null,
    backgroundColor: p.backgroundColor || null, locked: !!p.locked,
  };
}

// ---------------------------------------------------------------------------
// TOOLS
// ---------------------------------------------------------------------------
const S = {
  str: { type: 'string' }, num: { type: 'number' }, int: { type: 'integer' }, bool: { type: 'boolean' },
};
function schema(props, required = []) { return { type: 'object', properties: props, required, additionalProperties: false }; }
const projProp = { project: { type: 'string', description: 'Project name (meta.name) or absolute .pebble path.' } };
const pageProp = { page: { type: 'integer', description: 'Zero-based page index.' } };

const TOOLS = [];
function tool(name, description, inputSchema, handler) { TOOLS.push({ name, description, inputSchema, handler }); }

// ---- Discovery / skills -------------------------------------------------
tool('pebble_guide', 'START HERE. Returns an overview of PebbleAlbum, what it does, and the recommended workflow for building a beautiful album with these tools. Always call this first.',
  schema({}), async () => {
    let guide = '';
    try { guide = await fs.readFile(path.join(SKILLS_DIR, 'pebble-overview.md'), 'utf-8'); } catch { guide = 'PebbleAlbum MCP server.'; }
    const skills = await listSkillNames();
    return [txt(`${guide}\n\nAvailable skills (read with read_skill): ${skills.join(', ')}\nProjects folder: ${PEBBLE_HOME}`)];
  });

async function listSkillNames() {
  try { return (await fs.readdir(SKILLS_DIR)).filter((f) => f.endsWith('.md')).map((f) => f.replace(/\.md$/, '')); } catch { return []; }
}
tool('list_skills', 'List the available skill documents that explain how to use PebbleAlbum.', schema({}), async () => [txt(await listSkillNames())]);
tool('read_skill', 'Read a named skill document (markdown). Use list_skills to see names.', schema({ name: S.str }, ['name']),
  async ({ name }) => {
    const safe = String(name).replace(/[^a-z0-9_\-]/gi, '');
    try { return [txt(await fs.readFile(path.join(SKILLS_DIR, `${safe}.md`), 'utf-8'))]; }
    catch { throw new Error(`Skill "${name}" not found. Available: ${(await listSkillNames()).join(', ')}`); }
  });

tool('list_projects', 'List all saved PebbleAlbum projects (name, pages, images, path).', schema({}), async () => {
  let files = [];
  try { files = (await fs.readdir(PEBBLE_HOME)).filter((f) => f.endsWith('.pebble')); } catch { /* none */ }
  const out = [];
  for (const f of files) {
    try {
      // eslint-disable-next-line no-await-in-loop
      const proj = JSON.parse(await fs.readFile(path.join(PEBBLE_HOME, f), 'utf-8'));
      out.push({ name: proj?.meta?.name || f.replace(/\.pebble$/, ''), pages: (proj.pages || []).length, images: (proj.imageRegistry || []).length, theme: proj?.meta?.theme, path: path.join(PEBBLE_HOME, f) });
    } catch { /* skip */ }
  }
  return [txt(out.length ? out : `No projects found in ${PEBBLE_HOME}. Create + save one in the PebbleAlbum app first.`)];
});

tool('get_project', 'Get a project overview: album metadata + a summary of every page. Call this to understand the album before editing.', schema({ ...projProp }, ['project']),
  async ({ project }) => {
    const { proj } = await loadProject(project);
    const m = proj.meta;
    return [txt({
      meta: { name: m.name, theme: m.theme, coverTitle: m.coverTitle, coverSubtitle: m.coverSubtitle, coverDate: m.coverDate, albumWidth: m.albumWidth, albumHeight: m.albumHeight, dpi: m.dpi, orientation: m.orientation, sourceFolder: m.sourceFolder, proverbs: m.proverbs },
      pageCount: (proj.pages || []).length,
      imageCount: (proj.imageRegistry || []).length,
      pages: (proj.pages || []).map(pageSummary),
    })];
  });

tool('get_page', 'Get full detail for one page: every image (id, filename, frame, fit, effects, border, shadow, z-index), text blocks, decorations and proverb. Use the ids returned here with the edit tools.', schema({ ...projProp, ...pageProp }, ['project', 'page']),
  async ({ project, page }) => {
    const { proj } = await loadProject(project);
    const p = getPage(proj, page);
    return [txt({
      index: typeof page === 'number' ? page : proj.pages.indexOf(p), id: p.id, type: p.type, layoutId: p.layoutId, backgroundColor: p.backgroundColor || null, locked: !!p.locked,
      images: (p.images || []).map((im) => ({ id: im.id, filename: im.filename, slotId: im.slotId, visible: im.visible !== false, free: !!im.free, fit: im.fit || 'auto', zIndex: im.zIndex, opacity: im.opacity, rotation: im.position?.rotation, frame: im.slotRect || im.position, effects: im.effects, border: im.border, shadow: im.shadow, caption: im.caption, eraseMask: im.eraseMask || null })),
      textBlocks: (p.textBlocks || []).map((t) => ({ id: t.id, type: t.type, content: t.content, position: t.position, style: t.style })),
      decorations: (p.decorations || []).map((d) => ({ id: d.id, type: d.type, renderer: d.renderer, params: d.params, position: d.position })),
      proverb: p.proverb || null,
    })];
  });

tool('list_images', 'List the album\'s source photos: filename, pixel size, aspect, parsed filename labels, and which pages use each. Use these filenames with place_image / view_image.', schema({ ...projProp, unusedOnly: { ...S.bool, description: 'Only list photos not placed on any page.' } }, ['project']),
  async ({ project, unusedOnly }) => {
    const { proj } = await loadProject(project);
    const used = new Set();
    for (const p of (proj.pages || [])) for (const im of (p.images || [])) if (im.visible !== false) used.add(im.filename);
    let recs = (proj.imageRegistry || []).map((r) => ({ filename: r.relativePath, width: r.width, height: r.height, aspect: r.width && r.height ? +(r.width / r.height).toFixed(2) : null, labels: r.parsedLabels || {}, used: used.has(r.relativePath) }));
    if (unusedOnly) recs = recs.filter((r) => !r.used);
    return [txt({ count: recs.length, images: recs })];
  });

// ---- Culling: duplicates + quality ------------------------------------------
tool('find_duplicates', 'Detect near-duplicate / burst photos and score quality. Returns groups (members best-first) with a suggested keeper and per-photo flags (blurry / overexposed / underexposed). Then view_group to SEE a group, and cull_duplicates or select_photos to keep the best. Caches the analysis into the project.',
  schema({ ...projProp, threshold: { ...S.integer, description: 'Hamming distance 0–20 (default 10; lower = stricter grouping).' } }, ['project']),
  async ({ project, threshold }) => edit(project, async (proj) => {
    const groups = await ensureAnalysis(proj, clamp(toInt(threshold) ?? 10, 0, 20));
    const rec = new Map((proj.imageRegistry || []).map((r) => [r.relativePath, r]));
    const out = groups.map((g) => {
      const maxSharp = Math.max(0, ...g.members.map((m) => rec.get(m)?.quality?.sharpness ?? 0));
      return {
        id: g.id, suggested: g.suggested,
        members: g.members.map((m) => {
          const q = rec.get(m)?.quality; const flags = [];
          if (q) { if (maxSharp > 0 && q.sharpness < maxSharp * 0.6) flags.push('blurry'); if (q.clipOver > 0.08) flags.push('overexposed'); if (q.clipUnder > 0.12) flags.push('underexposed'); }
          return { filename: m, score: q?.score ?? 0, skipped: !!rec.get(m)?.skipped, flags };
        }),
      };
    });
    const dup = groups.reduce((s, g) => s + g.members.length - 1, 0);
    return [txt({ groupCount: groups.length, photosCulledIfBestOnly: dup, groups: out, hint: 'cull_duplicates keeps the suggested frame in each group; or view_group + select_photos to choose manually.' })];
  }));

tool('view_group', 'Show a near-duplicate group as ONE low-res montage so you can compare frames with your vision and pick the best. Pass groupId (from find_duplicates) or an explicit members[] of filenames.',
  schema({ ...projProp, groupId: S.str, members: { type: 'array', items: S.str }, thumbWidth: S.integer }, ['project']),
  async ({ project, groupId, members, thumbWidth }) => {
    const { proj } = await loadProject(project);
    let mem = members && members.length ? members : null;
    if (!mem) { const groups = (proj.duplicateGroups && proj.duplicateGroups.length) ? proj.duplicateGroups : await ensureAnalysis(proj); const g = groups.find((x) => x.id === groupId) || groups[0]; if (!g) throw new Error('No duplicate groups — run find_duplicates first.'); mem = g.members; }
    mem.forEach((m) => assertSafeRelative(m, 'member')); // reject any traversal/absolute member up front
    const tw = clamp(toInt(thumbWidth) || 240, 120, 400); const cellH = Math.round(tw * 0.75); const cols = Math.min(Math.max(mem.length, 1), 4); const pad = 8; const labelH = 16;
    const rec = new Map((proj.imageRegistry || []).map((r) => [r.relativePath, r]));
    const thumbs = [];
    for (const m of mem) {
      const src = safeImagePath(proj, m);
      // eslint-disable-next-line no-await-in-loop
      try { thumbs.push({ m, buf: await sharp(src).rotate().resize(tw, cellH, { fit: 'contain', background: '#222222' }).jpeg({ quality: 55 }).toBuffer() }); }
      // eslint-disable-next-line no-await-in-loop
      catch { thumbs.push({ m, buf: await sharp({ create: { width: tw, height: cellH, channels: 3, background: '#444444' } }).jpeg().toBuffer() }); }
    }
    const rows = Math.ceil(thumbs.length / cols); const W = cols * tw + (cols + 1) * pad; const H = rows * (cellH + labelH + pad) + pad;
    const layers = []; const labels = [];
    thumbs.forEach((t, idx) => {
      const c = idx % cols; const r = Math.floor(idx / cols); const x = pad + c * (tw + pad); const y = pad + r * (cellH + labelH + pad);
      layers.push({ input: t.buf, left: x, top: y + labelH });
      const q = rec.get(t.m)?.quality; const tag = `${t.m.split('/').pop()}${q ? ` q${q.score}` : ''}`;
      labels.push(`<text x="${x + 2}" y="${y + 12}" style="font-family:sans-serif;font-size:11px;fill:#333">${esc(tag.slice(0, 34))}</text>`);
    });
    try { const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${labels.join('')}</svg>`; layers.push({ input: await sharp(Buffer.from(svg)).png().toBuffer(), left: 0, top: 0 }); } catch (e) { log('view_group labels skipped:', e.message); }
    const out = await sharp({ create: { width: W, height: H, channels: 4, background: '#ffffff' } }).composite(layers).jpeg({ quality: 58 }).toBuffer();
    return [txt(`Group of ${mem.length}: ${mem.map((m) => m.split('/').pop()).join(', ')}`), imageContent(out.toString('base64'))];
  });

tool('cull_duplicates', 'Keep only the best frame in EVERY near-duplicate group (others are skipped → excluded from the album, and parked if already placed). Runs find_duplicates first if needed. `keep` (filenames) force-keeps specific frames over the auto-suggested one.',
  schema({ ...projProp, keep: { type: 'array', items: S.str, description: 'filenames to force-keep (their group-mates get skipped)' } }, ['project']),
  async ({ project, keep }) => edit(project, async (proj) => {
    const groups = (proj.duplicateGroups && proj.duplicateGroups.length) ? proj.duplicateGroups : await ensureAnalysis(proj);
    const keepSet = new Set(keep || []);
    const rec = new Map((proj.imageRegistry || []).map((r) => [r.relativePath, r]));
    let kept = 0; let skipped = 0;
    for (const g of groups) {
      const winner = g.members.find((m) => keepSet.has(m)) || g.suggested;
      for (const m of g.members) { const r = rec.get(m); if (!r) continue; if (m === winner) { r.skipped = false; kept += 1; } else { r.skipped = true; skipped += 1; } }
    }
    parkSkipped(proj);
    return [txt(`Culled ${groups.length} group(s): kept ${kept}, skipped ${skipped} duplicate(s). Skipped photos are excluded from the album.`)];
  }));

tool('select_photos', 'Manually keep/skip photos by filename. keep[] → included; skip[] → excluded from the album (and parked if already placed).',
  schema({ ...projProp, keep: { type: 'array', items: S.str }, skip: { type: 'array', items: S.str } }, ['project']),
  async ({ project, keep, skip }) => edit(project, (proj) => {
    const rec = new Map((proj.imageRegistry || []).map((r) => [r.relativePath, r]));
    let k = 0; let s = 0;
    for (const f of (keep || [])) { const r = rec.get(f); if (r) { r.skipped = false; k += 1; } }
    for (const f of (skip || [])) { const r = rec.get(f); if (r) { r.skipped = true; s += 1; } }
    parkSkipped(proj);
    return [txt(`Selected: kept ${k}, skipped ${s}.`)];
  }));

tool('list_catalog', 'List valid ids for a catalog. kind: layouts | themes | patterns | stickers | borderFrames | filters | masks | fonts. For layouts, PASS `project` to get each slot\'s true orientation/aspect (portrait vs landscape) + capacity + whether it reserves a caption zone — match each photo to a SAME-orientation slot so faces are never cropped, and vary layouts across spreads.',
  schema({ kind: { type: 'string', enum: ['layouts', 'themes', 'patterns', 'stickers', 'borderFrames', 'filters', 'masks', 'fonts'] }, project: { ...S.str, description: 'For layouts: compute slot orientation against this album\'s dimensions.' } }, ['kind']),
  async ({ kind, project }) => {
    switch (kind) {
      case 'layouts': {
        let albW = 3600; let albH = 2400; let basis = 'assumed 3:2 landscape — pass "project" for this album\'s exact slot orientation';
        if (project) { try { const { proj } = await loadProject(project); albW = proj.meta.albumWidth; albH = proj.meta.albumHeight; basis = `${albW}×${albH} (${proj.meta.name})`; } catch { /* keep default */ } }
        const layouts = LAYOUTS.map((l) => {
          const meta = layoutSlotMeta(l, albW, albH);
          return { id: l.id, name: l.name, category: l.category, minImages: l.minImages, maxImages: l.maxImages, hasTextZone: !!l.textZone, bestForOrientation: meta.bestForOrientation, slots: meta.slots };
        });
        return [txt({ basis, hint: 'Put portrait photos in portrait slots and landscape in landscape slots. Use varied layouts — avoid repeating one layout more than twice in the album.', layouts })];
      }
      case 'themes': return [txt(THEMES.map((t) => ({ id: t.id, name: t.name, accent: t.colors?.accent, fonts: t.fonts, proverbCategory: t.proverbCategory })))];
      case 'patterns': return [txt(PATTERNS.map((p) => ({ id: p.id, label: p.label, type: p.type })))];
      case 'stickers': return [txt(listStickerIds())];
      case 'borderFrames': return [txt(BORDER_FRAMES)];
      case 'filters': return [txt(FILTERS)];
      case 'masks': return [txt(MASK_IDS)];
      case 'fonts': return [txt(FONTS.map((f) => f.family))];
      default: throw new Error('Unknown catalog kind.');
    }
  });

// ---- Vision -------------------------------------------------------------
tool('render_page', 'Render a page to a small JPEG so you can SEE it (low resolution to keep token cost down). Use after edits to verify the result. maxWidth defaults to 640; lower it (e.g. 420) for cheaper checks.',
  schema({ ...projProp, ...pageProp, maxWidth: { ...S.integer, description: 'Max width px (240–1100, default 640).' }, quality: { ...S.integer, description: 'JPEG quality 30–85, default 62.' } }, ['project', 'page']),
  async ({ project, page, maxWidth, quality }) => {
    const { proj } = await loadProject(project);
    const p = getPage(proj, page);
    const r = await renderPageBuffer(proj, p, maxWidth || 640, quality || 62);
    return [txt(`Page ${typeof page === 'number' ? page : ''} rendered at ${r.W}×${r.H} (${Math.round(r.bytes / 1024)} KB).`), imageContent(r.data)];
  });

tool('view_image', 'View a source photo as a small JPEG (downscaled to keep cost low). Use to decide placement/cropping. maxWidth default 560.',
  schema({ ...projProp, filename: { ...S.str, description: 'Source filename (from list_images).' }, maxWidth: S.integer, quality: S.integer }, ['project', 'filename']),
  async ({ project, filename, maxWidth, quality }) => {
    const { proj } = await loadProject(project);
    const r = await viewImageBuffer(proj, filename, maxWidth || 560, quality || 65);
    return [txt(`${filename} (${Math.round(r.bytes / 1024)} KB preview).`), imageContent(r.data)];
  });

tool('view_images', 'A labelled thumbnail grid of the album\'s SOURCE photos (or a range / only-unused) in ONE call — learn the content fast instead of many view_image calls. columns default 4, thumbWidth default 220.',
  schema({ ...projProp, from: S.integer, to: S.integer, columns: S.integer, thumbWidth: S.integer, unusedOnly: S.bool }, ['project']),
  async ({ project, from, to, columns, thumbWidth, unusedOnly }) => {
    const { proj } = await loadProject(project);
    let recs = proj.imageRegistry || [];
    if (unusedOnly) {
      const used = new Set();
      for (const p of (proj.pages || [])) for (const im of (p.images || [])) if (im.visible !== false) used.add(im.filename);
      recs = recs.filter((r) => !used.has(r.relativePath));
    }
    if (!recs.length) throw new Error('No source images to show.');
    const start = clamp(toInt(from) ?? 0, 0, recs.length - 1);
    const end = clamp(toInt(to) ?? recs.length - 1, start, recs.length - 1);
    const sel = recs.slice(start, end + 1);
    const tw = clamp(toInt(thumbWidth) || 220, 100, 400);
    const cellH = Math.round(tw * 0.72); const cols = clamp(toInt(columns) || 4, 1, 8);
    const pad = 8; const labelH = 16;
    const thumbs = [];
    for (const r of sel) {
      try {
        const src = safeImagePath(proj, r.relativePath);
        // eslint-disable-next-line no-await-in-loop
        thumbs.push({ name: r.relativePath, buf: await sharp(src).rotate().resize(tw, cellH, { fit: 'contain', background: '#222222' }).jpeg({ quality: 55 }).toBuffer() });
      } catch {
        // eslint-disable-next-line no-await-in-loop
        thumbs.push({ name: r.relativePath, buf: await sharp({ create: { width: tw, height: cellH, channels: 3, background: '#444444' } }).jpeg().toBuffer() });
      }
    }
    const rows = Math.ceil(thumbs.length / cols);
    const W = cols * tw + (cols + 1) * pad; const H = rows * (cellH + labelH + pad) + pad;
    const layers = []; const labels = [];
    thumbs.forEach((t, idx) => {
      const c = idx % cols; const rw = Math.floor(idx / cols);
      const x = pad + c * (tw + pad); const y = pad + rw * (cellH + labelH + pad);
      layers.push({ input: t.buf, left: x, top: y + labelH });
      const short = t.name.length > 30 ? `…${t.name.slice(-29)}` : t.name;
      labels.push(`<text x="${x + 2}" y="${y + 12}" style="font-family:sans-serif;font-size:11px;fill:#333">${esc(short)}</text>`);
    });
    try { const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${labels.join('')}</svg>`; layers.push({ input: await sharp(Buffer.from(svg)).png().toBuffer(), left: 0, top: 0 }); } catch (e) { log('view_images labels skipped:', e.message); }
    const out = await sharp({ create: { width: W, height: H, channels: 4, background: '#ffffff' } }).composite(layers).jpeg({ quality: 60 }).toBuffer();
    return [txt(`Source photos ${start}–${end} of ${recs.length} (${thumbs.length} shown, ${Math.round(out.length / 1024)} KB).`), imageContent(out.toString('base64'))];
  });

tool('render_album', 'Render ALL pages (or a range from..to) as ONE labelled thumbnail-grid JPEG — verify the whole album in a single call instead of one render_page per page (big token + call saving). thumbWidth default 300, columns default 3.',
  schema({ ...projProp, from: S.integer, to: S.integer, columns: S.integer, thumbWidth: S.integer, quality: S.integer }, ['project']),
  async ({ project, from, to, columns, thumbWidth, quality }) => {
    const { proj } = await loadProject(project);
    const pages = proj.pages || [];
    if (!pages.length) throw new Error('Album has no pages.');
    const start = clamp(from ?? 0, 0, pages.length - 1);
    const end = clamp(to ?? pages.length - 1, start, pages.length - 1);
    const tw = clamp(thumbWidth || 300, 120, 480);
    const cols = clamp(columns || (end - start + 1 <= 4 ? 2 : 3), 1, 6);
    const cellH = Math.max(1, Math.round(tw * proj.meta.albumHeight / proj.meta.albumWidth));
    const pad = 10; const labelH = 22;
    const thumbs = [];
    for (let i = start; i <= end; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const r = await renderPageBuffer(proj, pages[i], tw, 56);
      thumbs.push({ i, data: r.data });
    }
    const rows = Math.ceil(thumbs.length / cols);
    const W = cols * tw + (cols + 1) * pad;
    const H = rows * (cellH + labelH + pad) + pad;
    const layers = []; const labels = [];
    thumbs.forEach((t, idx) => {
      const c = idx % cols; const r = Math.floor(idx / cols);
      const x = pad + c * (tw + pad); const y = pad + r * (cellH + labelH + pad);
      layers.push({ input: Buffer.from(t.data, 'base64'), left: x, top: y + labelH });
      const tag = pages[t.i].type === 'spread' ? '' : ` (${pages[t.i].type})`;
      labels.push(`<text x="${x + 2}" y="${y + 15}" style="font-family:sans-serif;font-size:14px;fill:#333">Page ${t.i}${tag}</text>`);
    });
    try {
      const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">${labels.join('')}</svg>`;
      layers.push({ input: await sharp(Buffer.from(svg)).png().toBuffer(), left: 0, top: 0 });
    } catch (e) { log('contact-sheet labels skipped:', e.message); }
    const out = await sharp({ create: { width: W, height: H, channels: 4, background: '#ffffff' } })
      .composite(layers).jpeg({ quality: clamp(quality || 60, 30, 85) }).toBuffer();
    return [txt(`Contact sheet: pages ${start}–${end} (${thumbs.length} pages, ${cols} cols, ${Math.round(out.length / 1024)} KB).`), imageContent(out.toString('base64'))];
  });

// ---- helper to load+mutate+save in one go ------------------------------
async function edit(project, fn) {
  const { filePath, proj } = await loadProject(project);
  const result = await fn(proj);
  await saveProject(filePath, proj);
  return result;
}

// ---- Pages --------------------------------------------------------------
tool('add_page', 'Add a new page. type: spread|single|divider|cover|back_cover (default spread). Optional layoutId and atIndex (insert position).',
  schema({ ...projProp, type: S.str, layoutId: S.str, atIndex: S.integer }, ['project']),
  async ({ project, type, layoutId, atIndex }) => edit(project, (proj) => {
    const id = randomUUID();
    const lid = layoutId && layoutById(layoutId) ? layoutId : (type === 'single' ? 'single_full' : type === 'divider' ? 'divider_page' : 'two_equal');
    const pageObj = { id, index: 0, type: type || 'spread', layoutId: lid, images: [], decorations: [], textBlocks: [], locked: false };
    const ai = toInt(atIndex);
    const at = ai !== undefined ? clamp(ai, 0, proj.pages.length) : proj.pages.length;
    proj.pages.splice(at, 0, pageObj);
    proj.pages.forEach((p, i) => { p.index = i; });
    return [txt(`Added ${pageObj.type} page at index ${at} (id ${id}, layout ${lid}). Album now has ${proj.pages.length} pages.`)];
  }));

tool('delete_page', 'Delete the page at the given index.', schema({ ...projProp, ...pageProp }, ['project', 'page']),
  async ({ project, page }) => edit(project, (proj) => {
    const p = getPage(proj, page); const i = proj.pages.indexOf(p);
    proj.pages.splice(i, 1); proj.pages.forEach((pp, idx) => { pp.index = idx; });
    return [txt(`Deleted page ${i}. ${proj.pages.length} pages remain.`)];
  }));

tool('duplicate_page', 'Duplicate the page at the given index (inserted right after it).', schema({ ...projProp, ...pageProp }, ['project', 'page']),
  async ({ project, page }) => edit(project, (proj) => {
    const p = getPage(proj, page); const i = proj.pages.indexOf(p);
    const copy = JSON.parse(JSON.stringify(p)); copy.id = randomUUID();
    copy.images.forEach((im) => { im.id = randomUUID(); }); copy.decorations.forEach((d) => { d.id = randomUUID(); }); copy.textBlocks.forEach((t) => { t.id = randomUUID(); });
    proj.pages.splice(i + 1, 0, copy); proj.pages.forEach((pp, idx) => { pp.index = idx; });
    return [txt(`Duplicated page ${i} → new page at ${i + 1} (id ${copy.id}).`)];
  }));

tool('move_page', 'Reorder a page from one index to another.', schema({ ...projProp, from: S.integer, to: S.integer }, ['project', 'from', 'to']),
  async ({ project, from, to }) => edit(project, (proj) => {
    const n = proj.pages.length;
    const f = clamp(toInt(from) ?? 0, 0, n - 1); const t = clamp(toInt(to) ?? 0, 0, n - 1);
    const [m] = proj.pages.splice(f, 1); proj.pages.splice(t, 0, m); proj.pages.forEach((pp, idx) => { pp.index = idx; });
    return [txt(`Moved page ${f} → ${t}.`)];
  }));

tool('add_pages', 'Add SEVERAL pages in one call. `pages`: [{ type?, layoutId? }]. Inserted at `atIndex` (default: appended), in order.',
  schema({ ...projProp, pages: { type: 'array', items: { type: 'object' }, description: '[{type?, layoutId?}]' }, atIndex: S.integer }, ['project', 'pages']),
  async ({ project, pages, atIndex }) => edit(project, (proj) => {
    const ai = toInt(atIndex);
    let at = ai !== undefined ? clamp(ai, 0, proj.pages.length) : proj.pages.length;
    let added = 0;
    for (const spec of (pages || [])) {
      const type = spec?.type || 'spread';
      const lid = spec?.layoutId && layoutById(spec.layoutId) ? spec.layoutId : (type === 'single' ? 'single_full' : type === 'divider' ? 'divider_page' : 'two_equal');
      proj.pages.splice(at, 0, { id: randomUUID(), index: 0, type, layoutId: lid, images: [], decorations: [], textBlocks: [], locked: false });
      at += 1; added += 1;
    }
    proj.pages.forEach((p, i) => { p.index = i; });
    return [txt(`Added ${added} page(s). Album now has ${proj.pages.length} pages.`)];
  }));

tool('fill_page', 'Compose a whole page in ONE call: set its layout and place a list of photos into the slots (cover-fit, never stretched), with optional per-photo focus/zoom, plus an optional style preset. Existing photos on the page are parked first. `photos`: [{ filename, slotId?, focusX?, focusY?, zoom?, fit? }] in slot order. This replaces a layout-set + N×place_image + N×focus calls.',
  schema({ ...projProp, ...pageProp, layoutId: S.str, photos: { type: 'array', items: { type: 'object' }, description: '[{filename, slotId?, focusX?, focusY?, zoom?, fit?}]' }, stylePreset: { ...S.str, description: STYLE_PRESETS.join(' | ') } }, ['project', 'page', 'photos']),
  async ({ project, page, layoutId, photos, stylePreset }) => edit(project, (proj) => {
    const p = getPage(proj, page);
    if (layoutId) { if (!layoutById(layoutId)) throw new Error(`Unknown layoutId "${layoutId}".`); p.layoutId = layoutId; }
    const layout = layoutById(p.layoutId); if (!layout) throw new Error(`Page layout "${p.layoutId}" is unknown.`);
    // Park all current images so we fill cleanly (no leftovers / duplicates).
    (p.images || []).forEach((im) => { im.visible = false; im.slotId = 'unplaced'; im.slotRect = undefined; im.clipPolygon = undefined; im.free = false; });
    const used = new Set(); const revived = new Set(); let placed = 0;
    for (const ph of (photos || [])) {
      if (!ph || !ph.filename) continue;
      if (!imgRecord(proj, ph.filename)) throw new Error(`"${ph.filename}" is not in this album's images.`);
      const slot = ph.slotId ? layout.slots.find((s) => s.id === ph.slotId) : layout.slots.find((s) => !used.has(s.id));
      if (!slot) break; // out of slots
      used.add(slot.id);
      const fresh = newPageImage(proj, ph.filename, slot, proj.meta);
      let im = (p.images || []).find((x) => x.filename === ph.filename && x.visible === false && !revived.has(x.id));
      if (im) { Object.assign(im, { slotId: fresh.slotId, slotRect: fresh.slotRect, clipPolygon: undefined, free: false, manual: false, position: fresh.position, visible: true }); revived.add(im.id); }
      else { fresh.zIndex = (p.images || []).length + 1; p.images.push(fresh); im = fresh; }
      im.fit = ph.fit || 'auto';
      if (ph.focusX !== undefined || ph.focusY !== undefined) im.focus = { x: clamp(ph.focusX ?? 0.5, 0, 1), y: clamp(ph.focusY ?? 0.5, 0, 1) };
      if (ph.zoom !== undefined) im.coverZoom = Math.max(0.1, ph.zoom);
      placed += 1;
    }
    if (stylePreset) {
      const pr = expandPreset(stylePreset, proj.meta); if (!pr) throw new Error(`Unknown preset "${stylePreset}".`);
      for (const im of (p.images || []).filter((i) => i.visible !== false)) { im.border = pr.border ? normalizeBorder(pr.border) : null; im.shadow = pr.shadow ? normalizeShadow(pr.shadow) : null; }
    }
    return [txt(`Filled page ${proj.pages.indexOf(p)} (${p.layoutId}): placed ${placed} photo(s)${stylePreset ? ` + preset ${stylePreset}` : ''}.`)];
  }));

tool('update_images', 'Apply per-image changes to MANY photos on a page in ONE call. `items`: [{ imageId, focusX?, focusY?, zoom?, fit?, filter?, filterStrength?, rotation?, opacity?, x?,y?,width?,height?, visible?, caption?, mask?, and any ADJUST slider (exposure/brightness/contrast/highlights/shadows/saturation/temperature/tint/hue/vignette/noise/blur/sharpness) }].',
  schema({ ...projProp, ...pageProp, items: { type: 'array', items: { type: 'object' } } }, ['project', 'page', 'items']),
  async ({ project, page, items }) => edit(project, (proj) => {
    const p = getPage(proj, page); let n = 0;
    for (const it of (items || [])) {
      if (!it || !it.imageId) continue;
      const im = (p.images || []).find((i) => i.id === it.imageId); if (!im) continue;
      const pos = im.position;
      if (it.x !== undefined) { pos.x = it.x; im.manual = true; }
      if (it.y !== undefined) { pos.y = it.y; im.manual = true; }
      if (it.width !== undefined) { pos.width = it.width; im.manual = true; }
      if (it.height !== undefined) { pos.height = it.height; im.manual = true; }
      if (it.rotation !== undefined) pos.rotation = it.rotation;
      if (it.opacity !== undefined) im.opacity = clamp(it.opacity, 0, 1);
      if (it.visible !== undefined) im.visible = !!it.visible;
      if (it.fit !== undefined) { im.fit = it.fit; im.manual = false; }
      if (it.focusX !== undefined || it.focusY !== undefined) { im.focus = { x: clamp(it.focusX ?? im.focus?.x ?? 0.5, 0, 1), y: clamp(it.focusY ?? im.focus?.y ?? 0.5, 0, 1) }; im.manual = false; }
      if (it.zoom !== undefined) { im.coverZoom = Math.max(0.1, it.zoom); im.manual = false; }
      if (it.caption !== undefined) im.caption = it.caption;
      if (it.mask !== undefined) {
        if (it.mask === null || it.mask === 'none' || it.mask === '') delete im.maskId;
        else if (MASK_IDS.includes(it.mask)) im.maskId = it.mask;
      }
      im.effects = im.effects || defaultEffects();
      for (const k of ['filter', 'sharpness', ...ADJUST_KEYS]) if (it[k] !== undefined) im.effects[k] = it[k];
      n += 1;
    }
    return [txt(`Updated ${n} image(s) on page ${proj.pages.indexOf(p)}.`)];
  }));

tool('update_page', 'Update page properties. Set backgroundColor (hex), a backgroundGradient {from,to,angle} (or null to clear), a backgroundPattern (pattern id, or null), type, locked, notes, durationSec (how long this page stays on screen in the slideshow/video; null → album default). If layoutId is given, the page\'s photos are re-slotted into that layout (cover-fit, no stretch).',
  schema({ ...projProp, ...pageProp, backgroundColor: S.str, backgroundGradient: { type: ['object', 'null'] }, backgroundPattern: { type: ['string', 'null'] }, layoutId: S.str, type: S.str, locked: S.bool, notes: S.str, durationSec: { type: ['number', 'null'], description: 'Slideshow seconds for THIS page (1–60), or null for the album default.' } }, ['project', 'page']),
  async ({ project, page, backgroundColor, backgroundGradient, backgroundPattern, layoutId, type, locked, notes, durationSec }) => edit(project, (proj) => {
    const p = getPage(proj, page);
    if (durationSec !== undefined) p.durationSec = durationSec === null ? undefined : clamp(durationSec, 1, 60);
    if (backgroundColor !== undefined) p.backgroundColor = backgroundColor;
    if (backgroundGradient !== undefined) {
      const g = asConfigOrNull(backgroundGradient, 'backgroundGradient');
      p.backgroundGradient = g ? { from: g.from || '#ffffff', to: g.to || '#dddddd', angle: g.angle ?? 135 } : undefined;
    }
    if (backgroundPattern !== undefined) {
      if (backgroundPattern && !PATTERNS.find((x) => x.id === backgroundPattern)) throw new Error(`Unknown backgroundPattern "${backgroundPattern}". See list_catalog patterns.`);
      p.backgroundPattern = backgroundPattern || undefined;
    }
    if (type !== undefined) p.type = type;
    if (locked !== undefined) p.locked = !!locked;
    if (notes !== undefined) p.notes = notes;
    if (layoutId !== undefined) {
      const layout = layoutById(layoutId); if (!layout) throw new Error(`Unknown layoutId "${layoutId}".`);
      p.layoutId = layoutId;
      const placed = (p.images || []).filter((im) => im.visible !== false);
      layout.slots.forEach((slot, idx) => {
        const im = placed[idx]; if (!im) return;
        const rec = imgRecord(proj, im.filename); const frame = slotRectFromSlot(slot, proj.meta);
        const box = coverBox(frame, rec?.width || frame.width, rec?.height || frame.height);
        im.slotId = slot.id; im.slotRect = frame; im.free = false; im.manual = false; im.fit = 'auto';
        im.position = { x: box.x, y: box.y, width: box.width, height: box.height, rotation: slot.rotation || 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false };
        im.clipPolygon = undefined;
      });
      // Extra photos beyond the slot count are parked deterministically (hidden,
      // detached from any slot) so they never overlap the new layout.
      placed.slice(layout.slots.length).forEach((im) => {
        im.visible = false; im.slotId = 'unplaced'; im.slotRect = undefined; im.clipPolygon = undefined; im.free = false;
      });
    }
    const parked = (p.images || []).filter((im) => im.visible === false).length;
    return [txt(`Updated page ${proj.pages.indexOf(p)}.${parked ? ` ${parked} photo(s) parked (not placed) — re-place or remove them.` : ''}`)];
  }));

// ---- Images -------------------------------------------------------------
tool('place_image', 'Place a source photo onto a page. If slotId is given the photo fills that layout slot (cover-fit, never stretched); otherwise it auto-fills the next empty slot, or is placed free-floating if the layout is full. If a PARKED (not-placed) copy of the same photo already exists on the page it is reused instead of creating a duplicate. Pass free:true for the app\'s "Add photo" overlay: the photo is ALWAYS added as a new free-floating object (even when the layout has empty slots), on top of every other photo, with no shadow — optionally at x,y (album px, top-left), width (album px; height follows the photo\'s true aspect ratio) and rotation (degrees). Erase parts of an overlay with erase_image_region.',
  schema({ ...projProp, ...pageProp, filename: S.str, slotId: S.str, free: { ...S.bool, description: 'Add as a free-floating overlay on top (the "Add photo" feature).' }, x: { ...S.num, description: 'free only: left edge, album px' }, y: { ...S.num, description: 'free only: top edge, album px' }, width: { ...S.num, description: 'free only: width in album px (height follows the photo aspect)' }, rotation: { ...S.num, description: 'free only: rotation in degrees' } }, ['project', 'page', 'filename']),
  async ({ project, page, filename, slotId, free, x, y, width, rotation }) => edit(project, (proj) => {
    const p = getPage(proj, page);
    if (!imgRecord(proj, filename)) throw new Error(`"${filename}" is not in this album's images. Use list_images.`);
    if (free) {
      const fresh = newPageImage(proj, filename, null, proj.meta);
      const rec = imgRecord(proj, filename);
      const ar = rec?.width && rec?.height ? rec.width / rec.height : fresh.position.width / fresh.position.height;
      const w = width !== undefined && Number(width) > 0 ? Number(width) : fresh.position.width;
      const h = w / ar;
      const pos = fresh.position;
      pos.width = w; pos.height = h;
      pos.x = x !== undefined ? Number(x) : proj.meta.albumWidth / 2 - w / 2;
      pos.y = y !== undefined ? Number(y) : proj.meta.albumHeight / 2 - h / 2;
      if (rotation !== undefined) pos.rotation = Number(rotation) || 0;
      fresh.manual = true; fresh.shadow = null;
      fresh.zIndex = Math.max(0, ...(p.images || []).map((i) => i.zIndex || 0)) + 1;
      p.images = p.images || [];
      p.images.push(fresh);
      return [txt(`Added ${filename} as a free overlay on page ${proj.pages.indexOf(p)} (image id ${fresh.id}, ${Math.round(w)}×${Math.round(h)} px at ${Math.round(pos.x)},${Math.round(pos.y)}, zIndex ${fresh.zIndex}). Use update_image to move/resize/rotate it and erase_image_region to erase parts of it.`)];
    }
    const layout = layoutById(p.layoutId);
    let slot = null;
    if (slotId && layout) { slot = layout.slots.find((s) => s.id === slotId); if (!slot) throw new Error(`Slot "${slotId}" not in layout ${p.layoutId}. Slots: ${layout.slots.map((s) => s.id).join(', ')}`); }
    else if (layout) { const usedSlots = new Set((p.images || []).filter((im) => im.visible !== false).map((im) => im.slotId)); slot = layout.slots.find((s) => !usedSlots.has(s.id)); }
    const fresh = newPageImage(proj, filename, slot, proj.meta);
    // Reuse a parked (hidden) copy of the same filename → no duplicate.
    const parked = (p.images || []).find((x) => x.filename === filename && x.visible === false);
    if (parked) {
      Object.assign(parked, { slotId: fresh.slotId, slotRect: fresh.slotRect, clipPolygon: undefined, free: fresh.free, fit: fresh.fit, manual: false, position: fresh.position, visible: true });
      return [txt(`Re-placed parked ${filename} on page ${proj.pages.indexOf(p)}${slot ? ` in slot ${slot.id}` : ' (free)'} (image id ${parked.id}).`)];
    }
    fresh.zIndex = (p.images || []).length + 1;
    p.images.push(fresh);
    return [txt(`Placed ${filename} on page ${proj.pages.indexOf(p)}${slot ? ` in slot ${slot.id}` : ' (free)'} (image id ${fresh.id}).`)];
  }));

tool('update_image', 'Update an image\'s geometry/effects. Any field is optional. FACE-SAFE CROP (preferred for slot photos): set focusX/focusY (0..1 of the photo — e.g. 0.5,0.33 to keep an upper face) and/or zoom (1=fill, >1 zooms in); these re-centre the cover-crop without distorting and keep auto-fit. Geometry (manual): x,y,width,height (album px), rotation(°), opacity(0–1), zIndex, visible, flipX, flipY, fit(cover|contain|auto|fill). Effects: filter (see catalog) + filterStrength(0..1), and the ADJUST sliders — exposure/brightness/contrast/highlights/shadows/saturation/temperature/tint (−1..1), hue(−180..180°), vignette/noise=grain (0..1), blur(px 0-20), sharpen via sharpness (1=neutral..2). Also caption.',
  schema({ ...projProp, ...pageProp, imageId: S.str, detach: { ...S.bool, description: 'Free the photo from its slot so x/y/width/height/rotation apply (for custom cover heroes etc.)' }, focusX: { ...S.num, description: '0..1 horizontal focal point' }, focusY: { ...S.num, description: '0..1 vertical focal point' }, zoom: { ...S.num, description: 'cover zoom, 1=fill, >1 zooms in' }, x: S.num, y: S.num, width: S.num, height: S.num, rotation: S.num, opacity: S.num, zIndex: S.num, visible: S.bool, flipX: S.bool, flipY: S.bool, fit: S.str, filter: S.str, filterStrength: { ...S.num, description: 'Named-filter strength 0..1 (default 1)' }, brightness: S.num, contrast: S.num, saturation: S.num, vignette: S.num, blur: S.num, exposure: { ...S.num, description: '−1..1 multiplicative exposure' }, temperature: { ...S.num, description: '−1 cool .. 1 warm' }, tint: { ...S.num, description: '−1 green .. 1 magenta' }, hue: { ...S.num, description: 'Hue rotation in degrees −180..180' }, highlights: { ...S.num, description: '−1..1 top-end lift/crush' }, shadows: { ...S.num, description: '−1..1 low-end lift/crush' }, noise: { ...S.num, description: 'Film grain 0..1' }, sharpness: { ...S.num, description: 'Sharpen: 1 = neutral (default), up to 2 = strong' }, caption: S.str }, ['project', 'page', 'imageId']),
  async (a) => edit(a.project, (proj) => {
    const p = getPage(proj, a.page); const im = getImage(p, a.imageId);
    // Detach from the slot so manual geometry (x/y/width/height/rotation) is honoured.
    if (a.detach) { im.free = true; im.slotId = 'free'; im.slotRect = undefined; im.clipPolygon = undefined; im.manual = true; }
    const pos = im.position;
    if (a.x !== undefined) { pos.x = a.x; im.manual = true; }
    if (a.y !== undefined) { pos.y = a.y; im.manual = true; }
    if (a.width !== undefined) { pos.width = a.width; im.manual = true; }
    if (a.height !== undefined) { pos.height = a.height; im.manual = true; }
    if (a.rotation !== undefined) pos.rotation = a.rotation;
    if (a.flipX !== undefined) pos.flipX = !!a.flipX;
    if (a.flipY !== undefined) pos.flipY = !!a.flipY;
    if (a.opacity !== undefined) im.opacity = clamp(a.opacity, 0, 1);
    if (a.zIndex !== undefined) im.zIndex = a.zIndex;
    if (a.visible !== undefined) im.visible = !!a.visible;
    if (a.fit !== undefined) { im.fit = a.fit; im.manual = false; }
    // Focal point + cover zoom apply to AUTO cover-fit (face-safe crop).
    if (a.focusX !== undefined || a.focusY !== undefined) {
      im.focus = { x: clamp(a.focusX ?? im.focus?.x ?? 0.5, 0, 1), y: clamp(a.focusY ?? im.focus?.y ?? 0.5, 0, 1) };
      im.manual = false;
    }
    if (a.zoom !== undefined) { im.coverZoom = Math.max(0.1, a.zoom); im.manual = false; }
    if (a.caption !== undefined) im.caption = a.caption;
    im.effects = im.effects || defaultEffects();
    for (const k of ['filter', 'sharpness', ...ADJUST_KEYS]) if (a[k] !== undefined) im.effects[k] = a[k];
    return [txt(`Updated image ${a.imageId} on page ${proj.pages.indexOf(p)}.`)];
  }));

tool('set_image_mask', 'Clip a photo to a SHAPE MASK (PicsArt-style shape crop) fitted to the photo\'s visible bounds: circle, ellipse, squircle, heart, star, hexagon, diamond, arch, blob, scallop. Pass mask=null to return to the normal rectangle. Borders and decorative frames trace the mask outline.',
  schema({ ...projProp, ...pageProp, imageId: S.str, mask: { type: ['string', 'null'], description: `One of ${MASK_IDS.join(' | ')}, or null to clear.` } }, ['project', 'page', 'imageId', 'mask']),
  async ({ project, page, imageId, mask }) => edit(project, (proj) => {
    const im = getImage(getPage(proj, page), imageId);
    if (mask === null || mask === 'null' || mask === 'none' || mask === '') { delete im.maskId; return [txt('Mask removed.')]; }
    if (!MASK_IDS.includes(mask)) throw new Error(`Unknown mask "${mask}". Valid: ${MASK_IDS.join(', ')}.`);
    im.maskId = mask;
    return [txt(`Clipped image ${imageId} to a ${mask} mask.`)];
  }));

tool('set_image_border', 'Set or clear an image border. Pass border=null to remove. Line border: {style:"solid|dashed|dotted|double", width, color, radius, gradient:{from,to,angle}}. Decorative frame: {style:"pattern", frameId:"scallop_fan|…(see catalog borderFrames)", width, color}.',
  schema({ ...projProp, ...pageProp, imageId: S.str, border: { type: ['object', 'null'], description: 'Border config or null.' } }, ['project', 'page', 'imageId', 'border']),
  async ({ project, page, imageId, border }) => edit(project, (proj) => {
    const p = getPage(proj, page); const im = getImage(p, imageId);
    const b = asConfigOrNull(border, 'border'); // coerces string, validates type
    if (b === null) { im.border = null; return [txt('Border removed.')]; }
    im.border = normalizeBorder(b); // validates style + frameId, fills defaults
    return [txt(`Set ${im.border.style} border on image ${imageId}.`)];
  }));

tool('set_image_shadow', 'Set or clear an image drop shadow. Pass shadow=null to remove, or {offsetX,offsetY,blur,color,opacity}.',
  schema({ ...projProp, ...pageProp, imageId: S.str, shadow: { type: ['object', 'null'] } }, ['project', 'page', 'imageId', 'shadow']),
  async ({ project, page, imageId, shadow }) => edit(project, (proj) => {
    const im = getImage(getPage(proj, page), imageId);
    const s = asConfigOrNull(shadow, 'shadow');
    im.shadow = s === null ? null : normalizeShadow(s);
    return [txt(im.shadow ? 'Shadow set.' : 'Shadow removed.')];
  }));

tool('set_page_image_style', 'BATCH-style photos in ONE call (use this instead of many set_image_border/shadow calls). Applies to every visible image on a page — or the whole album with allPages:true — or a subset via imageIds. Quickest: pass a `preset` (matte_white | thin_gold | soft_shadow | polaroid | scallop_frame | none). You can also pass explicit border/shadow (object or null)/fit/filter, which override the preset.',
  schema({ ...projProp, page: { ...S.integer, description: 'Page index (omit when allPages=true).' }, allPages: { ...S.bool, description: 'Apply to every page.' }, imageIds: { type: 'array', items: S.str, description: 'Limit to these image ids (default: all visible).' }, preset: { ...S.str, description: STYLE_PRESETS.join(' | ') }, border: { type: ['object', 'null'] }, shadow: { type: ['object', 'null'] }, fit: S.str, filter: S.str }, ['project']),
  async (a) => edit(a.project, (proj) => {
    const meta = proj.meta;
    if (!a.allPages && a.page === undefined) throw new Error('Provide "page" or "allPages": true.');
    let preset = null;
    if (a.preset) { preset = expandPreset(a.preset, meta); if (!preset) throw new Error(`Unknown preset "${a.preset}". Valid: ${STYLE_PRESETS.join(', ')}`); }
    // Resolve border/shadow: explicit arg wins; else preset; else leave unchanged (undefined).
    const border = a.border !== undefined ? asConfigOrNull(a.border, 'border') : (preset ? preset.border : undefined);
    const shadow = a.shadow !== undefined ? asConfigOrNull(a.shadow, 'shadow') : (preset ? preset.shadow : undefined);
    const normBorder = border === undefined ? undefined : (border === null ? null : normalizeBorder(border));
    const normShadow = shadow === undefined ? undefined : (shadow === null ? null : normalizeShadow(shadow));
    const pages = a.allPages ? proj.pages : [getPage(proj, a.page)];
    let count = 0;
    for (const p of pages) {
      let imgs = (p.images || []).filter((im) => im.visible !== false);
      if (a.imageIds && a.imageIds.length) imgs = imgs.filter((im) => a.imageIds.includes(im.id));
      for (const im of imgs) {
        if (normBorder !== undefined) im.border = normBorder;
        if (normShadow !== undefined) im.shadow = normShadow;
        if (a.fit !== undefined) { im.fit = a.fit; im.manual = false; }
        if (a.filter !== undefined) { im.effects = im.effects || defaultEffects(); im.effects.filter = a.filter; }
        count += 1;
      }
    }
    return [txt(`Styled ${count} image(s) across ${pages.length} page(s)${a.preset ? ` with preset "${a.preset}"` : ''}.`)];
  }));

// ---- Non-destructive eraser (PicsArt-style) ----------------------------
const MASK_DIR = '.pebble_masks';
const MASK_LONG_SIDE = 1024;
/** Photo size AFTER EXIF rotation (what the app's eraseMask is stretched over). */
async function orientedSize(file) {
  const m = await sharp(file).metadata();
  const swap = (m.orientation || 1) >= 5;
  return { width: (swap ? m.height : m.width) || 1, height: (swap ? m.width : m.height) || 1 };
}
/**
 * Read a mask PNG's alpha channel as a raw 8-bit single-channel buffer.
 * Returns null when there is nothing to continue from (path fails the sandbox
 * check, or the file does not exist). THROWS when the file exists but cannot be
 * decoded — silently restarting would discard the user's earlier erasing.
 */
async function readMaskAlpha(proj, rel) {
  let file;
  try { file = safeImagePath(proj, rel); } catch { return null; }
  if (!fss.existsSync(file)) return null;
  try {
    // toColourspace('srgb') + ensureAlpha makes grey / grey+alpha / palette PNGs 4-channel RGBA.
    const { data, info } = await sharp(file).toColourspace('srgb').ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true });
    const n = info.width * info.height;
    let out;
    if (data.length === n) out = Buffer.from(data);
    else if (data.length === n * 2) { out = Buffer.alloc(n); for (let i = 0; i < n; i += 1) out[i] = Math.round(data.readUInt16LE(i * 2) / 257); } // 16-bit
    else throw new Error('unexpected pixel layout');
    return { data: out, width: info.width, height: info.height };
  } catch (e) {
    throw new Error(`The existing erase mask "${rel}" exists but could not be read (${e.message}). Continuing would discard the earlier erasing — call clear_image_erase on this image first, then erase again.`);
  }
}

tool('erase_image_region', 'NON-DESTRUCTIVE eraser — the agent\'s equivalent of one brush stroke in the app\'s Erase/Restore brush. Erases (makes transparent) or restores part of a photo so the page/photos below show through; the source file is never modified. Region = a shape in a box given as 0..1 FRACTIONS OF THE SOURCE PHOTO (x,y = top-left of the box, width/height = its size). opacity 0..1 (1 = fully, 0.4 = removes 40% per call, like a 40% brush; repeat calls accumulate); feather 0..1 (0 = hard edge, 1 = fully soft — the inverse of brush hardness). mode "restore" brings erased pixels back. Each call writes a NEW mask PNG to <sourceFolder>/.pebble_masks/ and points the image at it (older files stay on disk). Works on any placed photo, typically a free overlay from place_image {free:true}. See the result with render_page. clear_image_erase removes the erasing entirely.',
  schema({ ...projProp, ...pageProp, imageId: S.str, mode: { type: 'string', enum: ['erase', 'restore'], description: 'default erase' }, shape: { type: 'string', enum: ['ellipse', 'rect'], description: 'default ellipse' }, x: { ...S.num, description: '0..1 left of the box (fraction of photo width)' }, y: { ...S.num, description: '0..1 top of the box (fraction of photo height)' }, width: { ...S.num, description: '0..1 box width (fraction of photo width)' }, height: { ...S.num, description: '0..1 box height (fraction of photo height)' }, opacity: { ...S.num, description: '0..1, default 1' }, feather: { ...S.num, description: '0..1 edge softness, default 0.3 (0 = hard)' } }, ['project', 'page', 'imageId', 'x', 'y', 'width', 'height']),
  async (a) => edit(a.project, async (proj) => {
    const p = getPage(proj, a.page); const im = getImage(p, a.imageId);
    const mode = a.mode === undefined ? 'erase' : a.mode;
    if (mode !== 'erase' && mode !== 'restore') throw new Error('mode must be "erase" or "restore".');
    const shape = a.shape === undefined ? 'ellipse' : a.shape;
    if (shape !== 'ellipse' && shape !== 'rect') throw new Error('shape must be "ellipse" or "rect".');
    const nums = { x: a.x, y: a.y, width: a.width, height: a.height };
    for (const [k, v] of Object.entries(nums)) if (!Number.isFinite(Number(v)) || v === null || v === '') throw new Error(`${k} must be a number (0..1 fraction of the photo).`);
    const bx = Number(a.x); const by = Number(a.y); const bw = Number(a.width); const bh = Number(a.height);
    if (bw <= 0 || bh <= 0) throw new Error('width and height must be > 0.');
    const opacity = clamp(a.opacity === undefined ? 1 : Number(a.opacity), 0, 1);
    const feather = clamp(a.feather === undefined ? 0.3 : Number(a.feather), 0, 1);

    // 1. Start from the existing mask, else a fully opaque one at the photo's aspect ratio.
    let mask = im.eraseMask ? await readMaskAlpha(proj, im.eraseMask) : null;
    if (!mask) {
      const sz = await orientedSize(safeImagePath(proj, im.filename));
      const k = MASK_LONG_SIDE / Math.max(sz.width, sz.height);
      const width = Math.max(1, Math.round(sz.width * k)); const height = Math.max(1, Math.round(sz.height * k));
      mask = { data: Buffer.alloc(width * height, 255), width, height };
    }
    const { data, width: W, height: H } = mask;

    // 2. Apply the feathered shape (pure JS on the single-channel buffer).
    const cx = (bx + bw / 2) * W; const cy = (by + bh / 2) * H;
    const rx = Math.max(1e-6, (bw * W) / 2); const ry = Math.max(1e-6, (bh * H) / 2);
    const x0 = Math.max(0, Math.floor(cx - rx - 1)); const x1 = Math.min(W - 1, Math.ceil(cx + rx + 1));
    const y0 = Math.max(0, Math.floor(cy - ry - 1)); const y1 = Math.min(H - 1, Math.ceil(cy + ry + 1));
    for (let py = y0; py <= y1; py += 1) {
      const dy = (py + 0.5 - cy) / ry;
      for (let px = x0; px <= x1; px += 1) {
        const dx = (px + 0.5 - cx) / rx;
        const d = shape === 'ellipse' ? Math.sqrt(dx * dx + dy * dy) : Math.max(Math.abs(dx), Math.abs(dy));
        let cov;
        if (d >= 1) cov = 0;
        else if (feather <= 0) cov = 1;
        else cov = clamp((1 - d) / feather, 0, 1);
        if (cov <= 0) continue;
        const i = py * W + px; const al = data[i];
        data[i] = Math.round(mode === 'erase' ? al * (1 - opacity * cov) : al + (255 - al) * opacity * cov);
      }
    }

    // 3. Write a NEW uniquely named PNG (white RGB + alpha) inside <sourceFolder>/.pebble_masks/.
    const base = path.resolve(proj.meta.sourceFolder);
    const dir = path.join(base, MASK_DIR);
    await fs.mkdir(dir, { recursive: true });
    if (!isInside(fss.realpathSync(base), fss.realpathSync(dir))) throw new Error(`Refused: ${MASK_DIR} resolves outside the album folder.`);
    const stem = safeAssetId(im.id) || 'image';
    let name = `${stem}_${Date.now()}.png`; let n = 1;
    // eslint-disable-next-line no-await-in-loop
    while (await fs.access(path.join(dir, name)).then(() => true, () => false)) { name = `${stem}_${Date.now()}_${n}.png`; n += 1; }
    const rel = `${MASK_DIR}/${name}`;
    const out = safeImagePath(proj, rel); // validates containment
    const rgba = Buffer.alloc(W * H * 4, 255);
    let sum = 0;
    for (let i = 0; i < W * H; i += 1) { rgba[i * 4 + 3] = data[i]; sum += data[i]; }
    await sharp(rgba, { raw: { width: W, height: H, channels: 4 } }).png().toFile(out);
    im.eraseMask = rel;
    const erasedPct = Math.round((1 - sum / (255 * W * H)) * 100);
    return [txt(`${mode === 'erase' ? 'Erased' : 'Restored'} a ${shape} region (opacity ${opacity}, feather ${feather}) on image ${im.id}. ${erasedPct}% of the photo is now erased. Mask: ${rel} (${W}×${H}). Use render_page to see it.`)];
  }));

tool('clear_image_erase', 'Remove all erasing from a photo (sets its eraseMask to none, so the full photo shows again). The old mask PNG is left on disk — nothing is deleted.',
  schema({ ...projProp, ...pageProp, imageId: S.str }, ['project', 'page', 'imageId']),
  async ({ project, page, imageId }) => edit(project, (proj) => {
    const p = getPage(proj, page); const im = getImage(p, imageId);
    const had = !!im.eraseMask;
    delete im.eraseMask;
    return [txt(had ? `Cleared erasing on image ${imageId}; the full photo shows again.` : `Image ${imageId} had no erasing.`)];
  }));

tool('remove_image', 'Remove an image from a page. A free image is deleted; a slotted image becomes "not placed" (stays available to re-place).',
  schema({ ...projProp, ...pageProp, imageId: S.str }, ['project', 'page', 'imageId']),
  async ({ project, page, imageId }) => edit(project, (proj) => {
    const p = getPage(proj, page); const im = getImage(p, imageId);
    if (im.free) p.images = p.images.filter((i) => i.id !== imageId); else im.visible = false;
    return [txt(`Removed image ${imageId}.`)];
  }));

tool('swap_images', 'Swap the slot/positions of two images on a page (their frames trade places).',
  schema({ ...projProp, ...pageProp, imageIdA: S.str, imageIdB: S.str }, ['project', 'page', 'imageIdA', 'imageIdB']),
  async ({ project, page, imageIdA, imageIdB }) => edit(project, (proj) => {
    const p = getPage(proj, page); const a = getImage(p, imageIdA); const b = getImage(p, imageIdB);
    const keys = ['slotId', 'slotRect', 'position', 'free', 'fit', 'manual', 'clipPolygon', 'focus', 'coverZoom'];
    for (const k of keys) { const tmp = a[k]; a[k] = b[k]; b[k] = tmp; }
    return [txt(`Swapped ${imageIdA} ↔ ${imageIdB}.`)];
  }));

tool('move_image_to_slot', 'Move an existing image to a specific layout slot (cover-fits it there) without duplicating. If another image already occupies the target slot, the two swap slots. Revives the image if it was parked.',
  schema({ ...projProp, ...pageProp, imageId: S.str, slotId: S.str }, ['project', 'page', 'imageId', 'slotId']),
  async ({ project, page, imageId, slotId }) => edit(project, (proj) => {
    const p = getPage(proj, page); const im = getImage(p, imageId);
    const layout = layoutById(p.layoutId); if (!layout) throw new Error(`Page layout "${p.layoutId}" is unknown.`);
    const slot = layout.slots.find((s) => s.id === slotId);
    if (!slot) throw new Error(`Slot "${slotId}" not in layout ${p.layoutId}. Slots: ${layout.slots.map((s) => s.id).join(', ')}`);
    const fitToSlot = (image, sl) => {
      const fr = slotRectFromSlot(sl, proj.meta); const rec = imgRecord(proj, image.filename);
      const box = coverBox(fr, rec?.width || fr.width, rec?.height || fr.height);
      image.slotId = sl.id; image.slotRect = fr; image.clipPolygon = undefined; image.free = false; image.manual = false; image.fit = 'auto'; image.visible = true;
      image.position = { x: box.x, y: box.y, width: box.width, height: box.height, rotation: sl.rotation || 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false };
    };
    const occupant = (p.images || []).find((x) => x.id !== imageId && x.visible !== false && x.slotId === slotId);
    const oldSlot = layout.slots.find((s) => s.id === im.slotId);
    fitToSlot(im, slot);
    if (occupant) {
      if (oldSlot) fitToSlot(occupant, oldSlot);
      else { occupant.visible = false; occupant.slotId = 'unplaced'; occupant.slotRect = undefined; occupant.clipPolygon = undefined; occupant.free = false; }
    }
    return [txt(`Moved ${imageId} to slot ${slotId}${occupant ? ` (swapped with ${occupant.id})` : ''}.`)];
  }));

tool('copy_image_style', 'Copy the visual style (border, shadow, effects/filter, fit, focus + cover zoom) from one image to other images — to give a page or album a consistent look fast. Targets default to all OTHER visible images on the target page.',
  schema({ ...projProp, fromPage: S.integer, fromImageId: S.str, toPage: S.integer, toImageIds: { type: 'array', items: S.str } }, ['project', 'fromPage', 'fromImageId']),
  async ({ project, fromPage, fromImageId, toPage, toImageIds }) => edit(project, (proj) => {
    const src = getImage(getPage(proj, fromPage), fromImageId);
    const tp = getPage(proj, toPage ?? fromPage);
    let targets = (tp.images || []).filter((im) => im.visible !== false && im.id !== fromImageId);
    if (toImageIds && toImageIds.length) targets = targets.filter((im) => toImageIds.includes(im.id));
    const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
    for (const im of targets) {
      im.border = clone(src.border) ?? null;
      im.shadow = clone(src.shadow) ?? null;
      im.effects = clone(src.effects) || defaultEffects();
      im.fit = src.fit;
      if (src.focus) im.focus = { ...src.focus }; else delete im.focus;
      if (src.coverZoom) im.coverZoom = src.coverZoom; else delete im.coverZoom;
    }
    return [txt(`Copied style from ${fromImageId} to ${targets.length} image(s).`)];
  }));

// ---- Decorations / stickers --------------------------------------------
tool('add_pattern', 'Add a decorative page pattern (drawn BEHIND the photos). patternId from list_catalog patterns (e.g. bokeh_circles, confetti, floral_corner, scallop_border, triangles_scatter).',
  schema({ ...projProp, ...pageProp, patternId: S.str }, ['project', 'page', 'patternId']),
  async ({ project, page, patternId }) => edit(project, (proj) => {
    if (!PATTERNS.find((p) => p.id === patternId)) throw new Error(`Unknown patternId "${patternId}". See list_catalog patterns.`);
    const p = getPage(proj, page);
    if ((p.decorations || []).some((d) => d.renderer === patternId)) return [txt('Pattern already present.')];
    p.decorations.push({ id: randomUUID(), type: 'pattern_tile', renderer: patternId, params: {}, position: { x: 0, y: 0, width: 1, height: 1, rotation: 0 }, opacity: 1, blendMode: 'normal', zIndex: -5, visible: true, locked: false });
    return [txt(`Added pattern ${patternId}.`)];
  }));

/** The user's global custom-sticker (cutout) library: ~/PebbleAlbum/stickers. */
function customStickersDir() { return path.join(os.homedir(), 'PebbleAlbum', 'stickers'); }
async function listCustomStickerFiles() {
  try { return (await fs.readdir(customStickersDir())).filter((f) => f.toLowerCase().endsWith('.png')); } catch { return []; }
}
/** Resolve a custom sticker by library name or absolute path inside the library. */
async function resolveCustomSticker(file) {
  const dir = path.resolve(customStickersDir());
  let full = path.isAbsolute(file) ? path.resolve(file) : path.join(dir, file.endsWith('.png') ? file : `${file}.png`);
  if (!full.startsWith(dir + path.sep)) throw new Error('Custom stickers must live in ~/PebbleAlbum/stickers.');
  await fs.access(full).catch(() => { throw new Error(`Sticker "${file}" not found. See list_custom_stickers.`); });
  return full;
}

tool('add_sticker', 'Add a sticker (in FRONT of the photos). Provide svg (an SVG sticker id from list_catalog stickers — placed at its true aspect ratio), OR emoji (a unicode glyph), OR file (a CUSTOM cutout sticker from list_custom_stickers, by name or path). x,y are album px (default centre); size is the height in album px.',
  schema({ ...projProp, ...pageProp, svg: S.str, emoji: S.str, file: { ...S.str, description: 'Custom sticker name/path from list_custom_stickers' }, x: S.num, y: S.num, size: S.num }, ['project', 'page']),
  async ({ project, page, svg, emoji, file, x, y, size }) => {
    const custom = file ? await resolveCustomSticker(file) : null;
    let cw = 100; let ch = 100;
    if (custom) { const meta = await sharp(custom).metadata(); cw = meta.width || 100; ch = meta.height || 100; }
    return edit(project, (proj) => {
      const p = getPage(proj, page); const m = proj.meta;
      if (!svg && !emoji && !custom) throw new Error('Provide svg (sticker id), emoji, or file (custom sticker).');
      let w; let h;
      if (custom) { h = size || Math.round(m.albumHeight * 0.22); w = Math.round(h * (cw / ch)); }
      else if (svg) {
        if (!listStickerIds().includes(svg)) throw new Error(`Unknown sticker "${svg}". See list_catalog stickers.`);
        const dims = stickerDims(svg); h = size || Math.round(m.albumHeight * 0.16); w = Math.round(h * (dims.w / dims.h));
      } else { w = size || Math.round(m.albumHeight * 0.12); h = w; }
      const px = x ?? (m.albumWidth / 2 - w / 2); const py = y ?? (m.albumHeight / 2 - h / 2);
      const params = custom ? { file: custom } : svg ? { svg } : { emoji };
      p.decorations.push({ id: randomUUID(), type: 'sticker', params, position: { x: px, y: py, width: w, height: h, rotation: 0 }, opacity: 1, blendMode: 'normal', zIndex: 400, visible: true, locked: false });
      return [txt(`Added ${custom ? `custom sticker ${path.basename(custom)}` : svg ? `sticker ${svg}` : `emoji ${emoji}`} at (${Math.round(px)}, ${Math.round(py)}).`)];
    });
  });

tool('list_custom_stickers', 'List the user\'s custom cutout stickers (~/PebbleAlbum/stickers, made with the app\'s Cutout studio or remove_background). Use a returned name with add_sticker {file}.',
  schema({}),
  async () => {
    const files = await listCustomStickerFiles();
    return [txt(files.map((f) => f.replace(/\.png$/i, '')))];
  });

tool('remove_background', 'AI-remove the background of a source photo (client-side model, no cloud API). Writes a transparent PNG to <sourceFolder>/cutouts/, registers it in the album, and returns its relative path — place it with place_image, or pass saveAsSticker:true to ALSO copy it into the custom sticker library for add_sticker. First run downloads the model (needs network once).',
  schema({ ...projProp, filename: { ...S.str, description: 'Source photo (from list_images).' }, saveAsSticker: S.bool }, ['project', 'filename']),
  async ({ project, filename, saveAsSticker }) => {
    const { proj, filePath } = await loadProject(project);
    const src = safeImagePath(proj, filename);
    let removeBackground;
    try { ({ removeBackground } = await import('@imgly/background-removal-node')); }
    catch { throw new Error('Background removal package not installed (npm i @imgly/background-removal-node in the app folder).'); }
    const blob = await removeBackground(src);
    const buf = Buffer.from(await blob.arrayBuffer());
    const dir = path.join(path.resolve(proj.meta.sourceFolder), 'cutouts');
    await fs.mkdir(dir, { recursive: true });
    const stem = path.basename(filename).replace(/\.[^.]+$/, '');
    let out = path.join(dir, `${stem}_cutout.png`); let i = 1;
    // eslint-disable-next-line no-await-in-loop
    while (await fs.access(out).then(() => true, () => false)) { out = path.join(dir, `${stem}_cutout_${i}.png`); i += 1; }
    await fs.writeFile(out, buf);
    const meta = await sharp(out).metadata();
    const rel = path.relative(path.resolve(proj.meta.sourceFolder), out).split(path.sep).join('/');
    proj.imageRegistry = proj.imageRegistry || [];
    proj.imageRegistry.push({
      filename: rel, relativePath: rel, absolutePath: out,
      width: meta.width || 0, height: meta.height || 0, fileSize: buf.length, mimeType: 'image/png',
      thumbnailPath: '', parsedLabels: {}, usedOnPages: [], skipped: false,
    });
    await saveProject(filePath, proj);
    let stickerNote = '';
    if (saveAsSticker) {
      const sdir = customStickersDir();
      await fs.mkdir(sdir, { recursive: true });
      let sp = path.join(sdir, `${stem}.png`); let j = 1;
      // eslint-disable-next-line no-await-in-loop
      while (await fs.access(sp).then(() => true, () => false)) { sp = path.join(sdir, `${stem}_${j}.png`); j += 1; }
      await fs.copyFile(out, sp);
      stickerNote = ` Also saved to the sticker library as "${path.basename(sp, '.png')}".`;
    }
    return [txt(`Background removed → ${rel} (${meta.width}×${meta.height}). Place it with place_image.${stickerNote}`)];
  });

function stickerDims(id) {
  try {
    const raw = fss.readFileSync(path.join(ASSETS_DIR, 'sticker', `${safeAssetId(id)}.svg`), 'utf-8');
    const open = (raw.match(/<svg[^>]*>/i) || [''])[0];
    const w = Number((open.match(/\bwidth\s*=\s*"([\d.]+)"/i) || [])[1]);
    const h = Number((open.match(/\bheight\s*=\s*"([\d.]+)"/i) || [])[1]);
    if (w > 0 && h > 0) return { w, h };
  } catch { /* fallthrough */ }
  return { w: 100, h: 100 };
}

tool('remove_decoration', 'Remove a decoration or sticker by its id (from get_page).', schema({ ...projProp, ...pageProp, decorationId: S.str }, ['project', 'page', 'decorationId']),
  async ({ project, page, decorationId }) => edit(project, (proj) => {
    const p = getPage(proj, page); const n = p.decorations.length;
    p.decorations = p.decorations.filter((d) => d.id !== decorationId);
    if (p.decorations.length === n) throw new Error(`Decoration "${decorationId}" not found.`);
    return [txt('Removed decoration.')];
  }));

// ---- Text / proverbs ----------------------------------------------------
function makeTextBlock(proj, a) {
  const m = proj.meta; const th = themeById(m.theme);
  const tb = {
    id: randomUUID(), content: a.content || '', type: a.type || 'custom',
    position: { x: a.x ?? m.albumWidth * 0.1, y: a.y ?? m.albumHeight * 0.8, width: a.width ?? m.albumWidth * 0.8, height: Math.round(m.albumHeight * 0.08), rotation: a.rotation ?? 0 },
    style: { fontFamily: a.fontFamily || th?.fonts?.display || 'Playfair Display', fontSize: a.fontSize || Math.round(m.albumHeight * 0.035), fontWeight: a.bold ? 'bold' : 'normal', fontStyle: a.italic ? 'italic' : 'normal', color: a.color || th?.colors?.text || '#222222', align: a.align || 'center', letterSpacing: a.letterSpacing ?? 0, lineHeight: a.lineHeight ?? 1.3, textTransform: 'none', opacity: 1 },
    zIndex: 300, visible: true, locked: false,
  };
  applyTextLegibility(tb.style, a);
  return tb;
}
/** Apply the optional legibility kit (plate / outline / shadow) to a text style. */
function applyTextLegibility(style, a) {
  // captionSafe = a guaranteed-readable combo for text over busy photos.
  if (a.captionSafe) {
    if (!a.color) style.color = '#ffffff';
    style.background = a.background || 'rgba(0,0,0,0.6)';
    style.textStroke = { width: 2, color: '#000000' };
    style.textShadow = { offsetX: 0, offsetY: 2, blur: 6, spread: 0, color: '#000000', opacity: 0.7 };
  }
  if (a.background !== undefined) style.background = a.background || undefined;
  if (a.strokeWidth !== undefined || a.strokeColor !== undefined) {
    style.textStroke = (a.strokeWidth ?? 0) > 0 ? { width: a.strokeWidth ?? 2, color: a.strokeColor || '#000000' } : undefined;
  }
  if (a.shadow !== undefined) style.textShadow = a.shadow ? { offsetX: 0, offsetY: 2, blur: 6, spread: 0, color: '#000000', opacity: 0.6 } : undefined;
}
tool('add_text', 'Add a text block. type: custom|title|caption|date|proverb. Style with fontFamily (see catalog fonts), fontSize, color, align, italic, bold, letterSpacing, lineHeight, rotation, curve (curved/bent text: −100..100, + arcs up, − arcs down, ±100 ≈ full circle), position x,y,width (album px). Over a photo, set captionSafe:true for a guaranteed-readable look (white text + dark plate + outline + shadow) — or tune background (plate colour), strokeWidth+strokeColor (outline), shadow:true individually.',
  schema({ ...projProp, ...pageProp, content: S.str, type: S.str, x: S.num, y: S.num, width: S.num, fontFamily: S.str, fontSize: S.num, color: S.str, align: S.str, italic: S.bool, bold: S.bool, letterSpacing: S.num, lineHeight: S.num, rotation: S.num, curve: { ...S.num, description: 'Curved text bend −100..100 (0 = straight)' }, captionSafe: S.bool, background: S.str, strokeWidth: S.num, strokeColor: S.str, shadow: S.bool }, ['project', 'page', 'content']),
  async (a) => edit(a.project, (proj) => {
    const p = getPage(proj, a.page); const tb = makeTextBlock(proj, a); p.textBlocks.push(tb);
    if (a.curve !== undefined) tb.style.curve = clamp(a.curve, -100, 100);
    return [txt(`Added ${tb.type} text (id ${tb.id}).`)];
  }));

tool('add_proverb', 'Add a movable proverb text block to a page (a styled text block of type "proverb").',
  schema({ ...projProp, ...pageProp, text: S.str }, ['project', 'page', 'text']),
  async ({ project, page, text }) => edit(project, (proj) => {
    const p = getPage(proj, page); const tb = makeTextBlock(proj, { content: text, type: 'proverb', italic: true });
    p.textBlocks.push(tb);
    return [txt(`Added proverb (id ${tb.id}).`)];
  }));

tool('set_page_proverb', 'Set the page-level proverb text (auto-renders centred near the bottom). It is suppressed if the page has a proverb text block — for a movable/styled quote use add_proverb instead.',
  schema({ ...projProp, ...pageProp, text: S.str }, ['project', 'page', 'text']),
  async ({ project, page, text }) => edit(project, (proj) => { getPage(proj, page).proverb = text; return [txt('Page proverb set.')]; }));

tool('clear_proverb', 'Clear the page-level proverb field (does not touch proverb text blocks — remove those with remove_text).',
  schema({ ...projProp, ...pageProp }, ['project', 'page']),
  async ({ project, page }) => edit(project, (proj) => { getPage(proj, page).proverb = undefined; return [txt('Page proverb cleared.')]; }));

tool('update_text', 'Update a text block by id. Any of: content, fontFamily, fontSize, color, align, italic, bold, letterSpacing, lineHeight, opacity(0–1), rotation, x, y, width, curve (curved/bent text −100..100, 0 = straight). Legibility: background (plate colour, "" to clear), strokeWidth+strokeColor (outline; width 0 clears), shadow(true/false).',
  schema({ ...projProp, ...pageProp, textId: S.str, content: S.str, fontFamily: S.str, fontSize: S.num, color: S.str, align: S.str, italic: S.bool, bold: S.bool, letterSpacing: S.num, lineHeight: S.num, opacity: S.num, rotation: S.num, x: S.num, y: S.num, width: S.num, curve: { ...S.num, description: 'Curved text bend −100..100 (0 = straight)' }, captionSafe: S.bool, background: S.str, strokeWidth: S.num, strokeColor: S.str, shadow: S.bool }, ['project', 'page', 'textId']),
  async (a) => edit(a.project, (proj) => {
    const p = getPage(proj, a.page); const tb = (p.textBlocks || []).find((t) => t.id === a.textId);
    if (!tb) throw new Error(`Text "${a.textId}" not found.`);
    if (a.content !== undefined) tb.content = a.content;
    if (a.fontFamily !== undefined) tb.style.fontFamily = a.fontFamily;
    if (a.fontSize !== undefined) tb.style.fontSize = a.fontSize;
    if (a.color !== undefined) tb.style.color = a.color;
    if (a.align !== undefined) tb.style.align = a.align;
    if (a.italic !== undefined) tb.style.fontStyle = a.italic ? 'italic' : 'normal';
    if (a.bold !== undefined) tb.style.fontWeight = a.bold ? 'bold' : 'normal';
    if (a.letterSpacing !== undefined) tb.style.letterSpacing = a.letterSpacing;
    if (a.lineHeight !== undefined) tb.style.lineHeight = a.lineHeight;
    if (a.opacity !== undefined) tb.style.opacity = clamp(a.opacity, 0, 1);
    if (a.rotation !== undefined) tb.position.rotation = a.rotation;
    if (a.x !== undefined) tb.position.x = a.x;
    if (a.y !== undefined) tb.position.y = a.y;
    if (a.width !== undefined) tb.position.width = a.width;
    if (a.curve !== undefined) tb.style.curve = a.curve === 0 ? undefined : clamp(a.curve, -100, 100);
    applyTextLegibility(tb.style, a);
    return [txt(`Updated text ${a.textId}.`)];
  }));

tool('remove_text', 'Remove a text block by id.', schema({ ...projProp, ...pageProp, textId: S.str }, ['project', 'page', 'textId']),
  async ({ project, page, textId }) => edit(project, (proj) => {
    const p = getPage(proj, page); const n = p.textBlocks.length;
    p.textBlocks = p.textBlocks.filter((t) => t.id !== textId);
    if (p.textBlocks.length === n) throw new Error(`Text "${textId}" not found.`);
    return [txt('Removed text.')];
  }));

// ---- Album / theme ------------------------------------------------------
tool('set_theme', 'Change the album theme (affects default colours, fonts, page backgrounds). themeId from list_catalog themes.',
  schema({ ...projProp, themeId: S.str }, ['project', 'themeId']),
  async ({ project, themeId }) => edit(project, (proj) => {
    if (!themeById(themeId) || THEMES.findIndex((t) => t.id === themeId) < 0) throw new Error(`Unknown themeId "${themeId}". See list_catalog themes.`);
    proj.meta.theme = themeId;
    return [txt(`Theme set to ${themeId}.`)];
  }));

tool('update_album', 'Update album metadata: name, coverTitle, coverSubtitle, coverDate, pageBackgroundColor. Slideshow: slideshowInterval (default seconds per page, 1–60), pageTurnStyle (curl|slide|push|fade|zoom|flip_up|hard), pageTurnSpeed (slow|normal|fast), slideshowMusic (ordered array of music-library paths from list_music; loops when shorter than the show; [] = silent).',
  schema({ ...projProp, name: S.str, coverTitle: S.str, coverSubtitle: S.str, coverDate: S.str, pageBackgroundColor: S.str, slideshowInterval: S.num, pageTurnStyle: S.str, pageTurnSpeed: S.str, slideshowMusic: { type: 'array', items: { type: 'string' }, description: 'Ordered playlist of music-library paths (see list_music).' } }, ['project']),
  async (a) => edit(a.project, (proj) => {
    for (const k of ['name', 'coverTitle', 'coverSubtitle', 'coverDate', 'pageBackgroundColor']) if (a[k] !== undefined) proj.meta[k] = a[k];
    if (a.slideshowInterval !== undefined) proj.meta.slideshowInterval = clamp(a.slideshowInterval, 1, 60);
    if (a.pageTurnStyle !== undefined) {
      const styles = ['curl', 'slide', 'push', 'fade', 'zoom', 'flip_up', 'hard'];
      if (!styles.includes(a.pageTurnStyle)) throw new Error(`Unknown pageTurnStyle. Valid: ${styles.join(', ')}.`);
      proj.meta.pageTurnStyle = a.pageTurnStyle;
    }
    if (a.pageTurnSpeed !== undefined) {
      if (!['slow', 'normal', 'fast'].includes(a.pageTurnSpeed)) throw new Error('pageTurnSpeed must be slow|normal|fast.');
      proj.meta.pageTurnSpeed = a.pageTurnSpeed;
    }
    if (a.slideshowMusic !== undefined) proj.meta.slideshowMusic = (a.slideshowMusic || []).filter((p) => typeof p === 'string');
    return [txt('Album metadata updated.')];
  }));

tool('list_music', 'List available slideshow music: the app\'s bundled royalty-free tracks + the user\'s ~/PebbleAlbum/music library. Use the returned paths with update_album {slideshowMusic}.',
  schema({}),
  async () => {
    const dirs = [
      { dir: path.join(APP_ROOT, 'assets', 'music'), source: 'bundled' },
      { dir: path.join(os.homedir(), 'PebbleAlbum', 'music'), source: 'library' },
    ];
    const out = [];
    for (const { dir, source } of dirs) {
      let files = [];
      // eslint-disable-next-line no-await-in-loop
      try { files = await fs.readdir(dir); } catch { files = []; }
      for (const f of files) {
        if (!/\.(mp3|m4a|aac|wav|ogg|flac)$/i.test(f)) continue;
        out.push({ path: path.join(dir, f), name: path.basename(f).replace(/\.[^.]+$/, '').replace(/_/g, ' '), source });
      }
    }
    return [txt(out)];
  });

// ---- Duplicate Folder Finder --------------------------------------------
// Standalone (Node built-ins only) re-implementation of the app's folder-dup
// engine so an agent has parity with the UI tool. Metadata-only matching,
// inverted-index pair counting + bottom-up roll-up, containment-on-smaller
// similarity, and outermost-only suppression (same semantics as FolderDupView).
const DUP_JUNK = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini', '.localized', 'Icon']);
const DUP_SYSDIRS = new Set(['.git', 'node_modules', '.Trash', '.Trashes', '.Spotlight-V100', '.fseventsd', '$RECYCLE.BIN', 'System Volume Information', '.TemporaryItems', '.DocumentRevisions-V100', '.cache', '.npm']);
const DUP_PACK = 4194304;

async function dupWalk(roots, skipSys) {
  const dirs = [];
  const push = (r) => { const id = dirs.length; dirs.push({ id, ...r }); return id; };
  let frontier = [];
  for (let r = 0; r < roots.length; r += 1) {
    const abs = path.resolve(roots[r]);
    try { await fs.stat(abs); } catch { continue; } // eslint-disable-line no-await-in-loop
    const id = push({ path: abs, parent: -1, root: r, depth: 0, files: [] });
    frontier.push({ id, abs, root: r, depth: 0 });
  }
  while (frontier.length) {
    const next = [];
    for (let i = 0; i < frontier.length; i += 48) {
      const batch = frontier.slice(i, i + 48);
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(batch.map(async (job) => {
        let ents;
        try { ents = await fs.readdir(job.abs, { withFileTypes: true }); } catch { return; }
        for (const e of ents) {
          const cAbs = path.join(job.abs, e.name);
          if (e.isDirectory()) {
            if (skipSys && DUP_SYSDIRS.has(e.name)) continue;
            const cid = push({ path: cAbs, parent: job.id, root: job.root, depth: job.depth + 1, files: [] });
            next.push({ id: cid, abs: cAbs, root: job.root, depth: job.depth + 1 });
          } else if (e.isFile() && !DUP_JUNK.has(e.name)) {
            try { const st = await fs.stat(cAbs); dirs[job.id].files.push({ name: e.name, size: st.size, mtimeMs: st.mtimeMs }); } catch { /* gone */ }
          }
        }
      }));
    }
    frontier = next;
  }
  return dirs;
}

function dupKey(f, by) {
  const n = f.name.toLowerCase(); const d = Math.round(f.mtimeMs / 2000);
  return by === 'name' ? n : by === 'name_size' ? `${n} ${f.size}` : by === 'name_date_size' ? `${n} ${d} ${f.size}` : `${n} ${d}`;
}

tool('find_duplicate_folders', 'Find duplicate FOLDERS and files across one or many root folders (even whole drives), metadata-only (never content). matchBy: name|name_date|name_size|name_date_size (default name_date). A folder pair is a duplicate when sharedFiles / min(recursiveFilesA, recursiveFilesB) ≥ threshold (default 0.7; containment on the smaller/contained folder). Whole duplicated trees roll up into one outermost pair; child pairs and files inside a shown duplicate folder are suppressed. Each pair is tagged within (same root) or across (different roots). Returns the outermost duplicate folder pairs (duplicate side first) + stray duplicate-file groups + stats. Use to spot redundant backup copies to delete.',
  schema({
    roots: { type: 'array', items: { type: 'string' }, description: 'Absolute folder paths to scan/compare.' },
    threshold: { ...S.num, description: 'Similarity 0..1 (default 0.7).' },
    matchBy: { ...S.str, description: 'name | name_date | name_size | name_date_size' },
    skipSystemDirs: { ...S.bool, description: 'Skip .git/node_modules/system dirs + junk files (default true).' },
    maxResults: { ...S.int, description: 'Max folder pairs to return (default 100).' },
  }, ['roots']),
  async ({ roots, threshold = 0.7, matchBy = 'name_date', skipSystemDirs = true, maxResults = 100 }) => {
    if (!Array.isArray(roots) || !roots.length) throw new Error('Provide roots: an array of folder paths.');
    const dirs = await dupWalk(roots, skipSystemDirs !== false);
    const n = dirs.length;
    // Recursive file counts (deepest-first).
    const order = dirs.map((d) => d.id).sort((a, b) => dirs[b].depth - dirs[a].depth);
    const recFiles = new Float64Array(n);
    for (const id of order) recFiles[id] += dirs[id].files.length;
    for (const id of order) { const p = dirs[id].parent; if (p >= 0) recFiles[p] += recFiles[id]; }
    // Inverted index.
    const index = new Map();
    for (const d of dirs) for (const f of d.files) {
      const k = dupKey(f, matchBy); const a = index.get(k);
      if (a) { if (a[a.length - 1] !== d.id) a.push(d.id); } else index.set(k, [d.id]);
    }
    // Direct pair counts (hot-key capped).
    const pack = (a, b) => (a < b ? a * DUP_PACK + b : b * DUP_PACK + a);
    const direct = new Map();
    for (const ids of index.values()) {
      const list = ids.length > 1 ? [...new Set(ids)] : ids;
      if (list.length < 2 || list.length > 256) continue;
      for (let i = 0; i < list.length; i += 1) for (let j = i + 1; j < list.length; j += 1) { const k = pack(list[i], list[j]); direct.set(k, (direct.get(k) ?? 0) + 1); }
    }
    // Roll-up (depth-bucketed).
    const rec = new Map(direct);
    const pd = (p) => Math.max(dirs[Math.floor(p / DUP_PACK)].depth, dirs[p % DUP_PACK].depth);
    const buckets = new Map(); let maxD = 0;
    const bAdd = (p) => { const d = pd(p); if (d > maxD) maxD = d; let s = buckets.get(d); if (!s) { s = new Set(); buckets.set(d, s); } s.add(p); };
    for (const p of rec.keys()) bAdd(p);
    for (let d = maxD; d >= 1; d -= 1) { const s = buckets.get(d); if (!s) continue; for (const p of s) { const pa = dirs[Math.floor(p / DUP_PACK)].parent; const pb = dirs[p % DUP_PACK].parent; if (pa < 0 || pb < 0 || pa === pb) continue; const pp = pack(pa, pb); const had = rec.has(pp); rec.set(pp, (rec.get(pp) ?? 0) + (rec.get(p) ?? 0)); if (!had) bAdd(pp); } }
    const isAnc = (anc, node) => { let c = dirs[node].parent; while (c >= 0) { if (c === anc) return true; c = dirs[c].parent; } return false; };
    // Candidate pairs ≥ threshold.
    const cand = [];
    for (const [p, rs] of rec) {
      const a = Math.floor(p / DUP_PACK); const b = p % DUP_PACK;
      if (isAnc(a, b) || isAnc(b, a)) continue;
      const minRec = Math.min(recFiles[a], recFiles[b]); if (minRec <= 0) continue;
      const shared = Math.min(rs, minRec); const sim = shared / minRec;
      if (sim < threshold) continue;
      cand.push({ a, b, sim, shared, dmin: Math.min(dirs[a].depth, dirs[b].depth) });
    }
    // Outermost-only suppression.
    cand.sort((x, y) => x.dmin - y.dmin || y.sim - x.sim);
    const accepted = []; const pairs = [];
    for (const c of cand) {
      if (accepted.some((q) => (isAnc(q.a, c.a) && isAnc(q.b, c.b)) || (isAnc(q.a, c.b) && isAnc(q.b, c.a)))) continue;
      accepted.push({ a: c.a, b: c.b });
      const fa = dirs[c.a]; const fb = dirs[c.b];
      const [small, big] = recFiles[c.a] <= recFiles[c.b] ? [c.a, c.b] : [c.b, c.a];
      pairs.push({
        similarity: Math.round(c.sim * 100), shared: c.shared,
        duplicate: dirs[small].path, duplicateFiles: recFiles[small],
        alsoIn: dirs[big].path, alsoInFiles: recFiles[big],
        scope: fa.root === fb.root ? 'within' : 'across',
      });
    }
    // Stray duplicate files (not inside a shown duplicate folder's smaller side).
    const shownSmall = new Set(accepted.map((q) => (recFiles[q.a] <= recFiles[q.b] ? q.a : q.b)));
    const underShown = (id) => { let c = id; while (c >= 0) { if (shownSmall.has(c)) return true; c = dirs[c].parent; } return false; };
    let strayFiles = 0;
    for (const ids of index.values()) { const list = [...new Set(ids)].filter((id) => !underShown(id)); if (list.length >= 2) strayFiles += 1; }
    return [txt({
      stats: { folders: n, files: dirs.reduce((s, d) => s + d.files.length, 0), duplicateFolderPairs: pairs.length, strayDuplicateFileGroups: strayFiles, threshold, matchBy },
      duplicateFolders: pairs.slice(0, maxResults),
    })];
  });

// ---------------------------------------------------------------------------
// JSON-RPC over stdio (newline-delimited).
// ---------------------------------------------------------------------------
const TOOL_MAP = new Map(TOOLS.map((t) => [t.name, t]));
function send(msg) { process.stdout.write(`${JSON.stringify(msg)}\n`); }
function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }
function replyError(id, code, message) { send({ jsonrpc: '2.0', id, error: { code, message } }); }

async function handleMessage(msg) {
  const { id, method, params } = msg;
  if (method === undefined) return; // a response, ignore
  try {
    if (method === 'initialize') {
      reply(id, {
        protocolVersion: params?.protocolVersion || '2024-11-05',
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: SERVER_NAME, version: SERVER_VERSION },
        instructions: 'PebbleAlbum album-design tools. Call pebble_guide first, then list_projects / get_project. Use render_page and view_image to SEE results (low-res to save cost).',
      });
      return;
    }
    if (method === 'notifications/initialized' || method === 'notifications/cancelled') return;
    if (method === 'ping') { reply(id, {}); return; }
    if (method === 'tools/list') { reply(id, { tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })) }); return; }
    if (method === 'tools/call') {
      const t = TOOL_MAP.get(params?.name);
      if (!t) { replyError(id, -32602, `Unknown tool: ${params?.name}`); return; }
      try {
        const content = await t.handler(params.arguments || {});
        reply(id, { content, isError: false });
      } catch (err) {
        log(`tool ${params?.name} error:`, err?.message);
        reply(id, { content: [txt(`Error: ${err?.message || String(err)}`)], isError: true });
      }
      return;
    }
    if (id !== undefined) replyError(id, -32601, `Method not found: ${method}`);
  } catch (err) {
    log('handler error:', err?.message);
    if (id !== undefined) replyError(id, -32603, `Internal error: ${err?.message || String(err)}`);
  }
}

function main() {
  log(`starting (home=${PEBBLE_HOME}, appRoot=${APP_ROOT}, layouts=${LAYOUTS.length}, themes=${THEMES.length}, tools=${TOOLS.length})`);
  const rl = readline.createInterface({ input: process.stdin, terminal: false });
  rl.on('line', (line) => {
    const s = line.trim();
    if (!s) return;
    let msg;
    try { msg = JSON.parse(s); } catch { log('bad JSON line ignored'); return; }
    if (Array.isArray(msg)) msg.forEach((m) => handleMessage(m)); else handleMessage(msg);
  });
  rl.on('close', () => process.exit(0));
}
main();
