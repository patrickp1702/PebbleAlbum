/**
 * decoEngine.ts
 * -----------------------------------------------------------------------------
 * Procedural decoration renderers. Each renderer draws onto a standard
 * CanvasRenderingContext2D, so the exact same code paints the interactive
 * preview (Fabric uses a 2D context internally) and the full-DPI export.
 *
 * Colour tokens like "theme.accent" are resolved against the active theme
 * before a renderer runs.
 */
import patternsData from '@/config/patterns.json';
import type { Theme } from '@shared/theme.types';

interface PatternDef {
  id: string;
  label: string;
  type: 'canvas_draw' | 'svg_overlay';
  renderer?: string;
  asset?: string;
  params?: Record<string, unknown>;
  positions?: string[];
  mode?: string;
  opacity?: number;
  scaleFactor?: number;
}

export const PATTERNS = (patternsData as { patterns: PatternDef[] }).patterns;

export function getPattern(id: string): PatternDef | undefined {
  return PATTERNS.find((p) => p.id === id);
}

/** Resolve "theme.accent" style tokens; passthrough literal colours. */
export function resolveColor(token: string, theme: Theme): string {
  if (!token?.startsWith('theme.')) return token;
  const key = token.slice(6) as keyof Theme['colors'];
  return theme.colors[key] ?? theme.colors.accent;
}

type Ctx = CanvasRenderingContext2D;
type Params = Record<string, unknown>;
function num(p: Params, k: string, d: number): number {
  const v = p[k];
  return typeof v === 'number' ? v : d;
}

/** Seeded RNG so generated decorations are stable between renders. */
function mulberry32(seed: number) {
  return function rng() {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface RenderEnv { w: number; h: number; theme: Theme; seed?: number }

export type Renderer = (ctx: Ctx, params: Params, env: RenderEnv) => void;

const bokehRenderer: Renderer = (ctx, p, env) => {
  const rng = mulberry32(env.seed ?? 7);
  const colors = (p.colors as string[]) ?? ['theme.accent'];
  const count = num(p, 'count', 40);
  ctx.save();
  ctx.globalAlpha = num(p, 'opacity', 0.2);
  for (let i = 0; i < count; i += 1) {
    const r = num(p, 'minRadius', 8) + rng() * (num(p, 'maxRadius', 80) - num(p, 'minRadius', 8));
    ctx.beginPath();
    ctx.fillStyle = resolveColor(colors[i % colors.length], env.theme);
    ctx.arc(rng() * env.w, rng() * env.h, r, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
};

const diagonalStripeRenderer: Renderer = (ctx, p, env) => {
  ctx.save();
  ctx.globalAlpha = num(p, 'opacity', 0.08);
  ctx.strokeStyle = resolveColor((p.color as string) ?? 'theme.accent', env.theme);
  ctx.lineWidth = num(p, 'stripeWidth', 4);
  const gap = ctx.lineWidth * 6;
  for (let x = -env.h; x < env.w; x += gap) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + env.h, env.h);
    ctx.stroke();
  }
  ctx.restore();
};

const diagonalSplitRenderer: Renderer = (ctx, p, env) => {
  ctx.save();
  ctx.globalAlpha = 0.12;
  ctx.fillStyle = resolveColor((p.color as string) ?? 'theme.accent', env.theme);
  ctx.beginPath();
  ctx.moveTo(0, env.h);
  ctx.lineTo(env.w * 0.45, 0);
  ctx.lineTo(0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
};

const dotPatternRenderer: Renderer = (ctx, p, env) => {
  ctx.save();
  ctx.globalAlpha = num(p, 'opacity', 0.12);
  ctx.fillStyle = resolveColor((p.color as string) ?? 'theme.accent', env.theme);
  const spacing = num(p, 'spacing', 25);
  const radius = num(p, 'radius', 2);
  for (let y = spacing; y < env.h; y += spacing) {
    for (let x = spacing; x < env.w; x += spacing) {
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  ctx.restore();
};

const geometricGridRenderer: Renderer = (ctx, p, env) => {
  ctx.save();
  ctx.globalAlpha = num(p, 'opacity', 0.1);
  ctx.strokeStyle = resolveColor((p.color as string) ?? 'theme.border', env.theme);
  ctx.lineWidth = 1;
  const cell = num(p, 'cellSize', 60);
  for (let x = 0; x <= env.w; x += cell) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, env.h); ctx.stroke(); }
  for (let y = 0; y <= env.h; y += cell) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(env.w, y); ctx.stroke(); }
  ctx.restore();
};

function drawHeart(ctx: Ctx, x: number, y: number, s: number) {
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.3);
  ctx.bezierCurveTo(x, y, x - s / 2, y, x - s / 2, y + s * 0.3);
  ctx.bezierCurveTo(x - s / 2, y + s * 0.6, x, y + s * 0.8, x, y + s);
  ctx.bezierCurveTo(x, y + s * 0.8, x + s / 2, y + s * 0.6, x + s / 2, y + s * 0.3);
  ctx.bezierCurveTo(x + s / 2, y, x, y, x, y + s * 0.3);
  ctx.closePath();
  ctx.fill();
}

function drawStar(ctx: Ctx, cx: number, cy: number, r: number) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const rad = i % 2 === 0 ? r : r / 2.4;
    const a = (Math.PI / 5) * i - Math.PI / 2;
    const x = cx + Math.cos(a) * rad;
    const y = cy + Math.sin(a) * rad;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

const shapesScatterRenderer: Renderer = (ctx, p, env) => {
  const rng = mulberry32(env.seed ?? 13);
  ctx.save();
  ctx.globalAlpha = num(p, 'opacity', 0.15);
  ctx.fillStyle = resolveColor((p.color as string) ?? 'theme.accent', env.theme);
  const count = num(p, 'count', 20);
  const shape = (p.shape as string) ?? 'heart';
  for (let i = 0; i < count; i += 1) {
    const s = num(p, 'minSize', 10) + rng() * (num(p, 'maxSize', 35) - num(p, 'minSize', 10));
    const x = rng() * env.w; const y = rng() * env.h;
    if (shape === 'star') drawStar(ctx, x, y, s); else drawHeart(ctx, x, y, s);
  }
  ctx.restore();
};

const confettiRenderer: Renderer = (ctx, p, env) => {
  const rng = mulberry32(env.seed ?? 21);
  const colors = (p.colors as string[]) ?? ['theme.accent'];
  ctx.save();
  ctx.globalAlpha = num(p, 'opacity', 0.55);
  const count = num(p, 'count', 60);
  for (let i = 0; i < count; i += 1) {
    ctx.fillStyle = resolveColor(colors[i % colors.length], env.theme);
    ctx.save();
    ctx.translate(rng() * env.w, rng() * env.h);
    ctx.rotate(rng() * Math.PI);
    ctx.fillRect(-4, -2, 8, 4);
    ctx.restore();
  }
  ctx.restore();
};

const filmStripRenderer: Renderer = (ctx, p, env) => {
  ctx.save();
  ctx.globalAlpha = num(p, 'opacity', 0.85);
  ctx.fillStyle = (p.color as string) ?? '#111';
  const band = env.h * 0.12;
  ctx.fillRect(0, 0, env.w, band);
  ctx.fillRect(0, env.h - band, env.w, band);
  ctx.fillStyle = '#fff';
  const hole = num(p, 'holeRadius', 12);
  const spacing = num(p, 'holeSpacing', 30) + hole * 2;
  for (let x = spacing / 2; x < env.w; x += spacing) {
    ctx.fillRect(x - hole / 2, band / 2 - hole / 2, hole, hole);
    ctx.fillRect(x - hole / 2, env.h - band / 2 - hole / 2, hole, hole);
  }
  ctx.restore();
};

const filmGrainRenderer: Renderer = (ctx, p, env) => {
  const rng = mulberry32(env.seed ?? 99);
  const intensity = num(p, 'intensity', 0.12);
  ctx.save();
  for (let i = 0; i < env.w * env.h * 0.05; i += 1) {
    ctx.globalAlpha = rng() * intensity;
    ctx.fillStyle = rng() > 0.5 ? '#fff' : '#000';
    ctx.fillRect(rng() * env.w, rng() * env.h, 1, 1);
  }
  ctx.restore();
};

const vignetteRenderer: Renderer = (ctx, p, env) => {
  const strength = num(p, 'strength', 0.4);
  const g = ctx.createRadialGradient(
    env.w / 2, env.h / 2, Math.min(env.w, env.h) * 0.3,
    env.w / 2, env.h / 2, Math.max(env.w, env.h) * 0.75,
  );
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, `rgba(0,0,0,${strength})`);
  ctx.save();
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, env.w, env.h);
  ctx.restore();
};

const lightLeakRenderer: Renderer = (ctx, p, env) => {
  const g = ctx.createLinearGradient(env.w, 0, env.w * 0.5, env.h);
  const color = (p.color as string) ?? '#ff9500';
  g.addColorStop(0, color);
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.save();
  ctx.globalAlpha = num(p, 'opacity', 0.15);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, env.w, env.h);
  ctx.restore();
};

const trianglesScatterRenderer: Renderer = (ctx, p, env) => {
  const rng = mulberry32(env.seed ?? 31);
  ctx.save();
  ctx.globalAlpha = num(p, 'opacity', 0.12);
  ctx.fillStyle = resolveColor((p.color as string) ?? 'theme.accent', env.theme);
  const count = num(p, 'count', 26);
  for (let i = 0; i < count; i += 1) {
    const s = num(p, 'minSize', 10) + rng() * (num(p, 'maxSize', 34) - num(p, 'minSize', 10));
    ctx.save();
    ctx.translate(rng() * env.w, rng() * env.h);
    ctx.rotate(rng() * Math.PI * 2);
    ctx.beginPath();
    ctx.moveTo(0, -s / 2);
    ctx.lineTo(s / 2, s / 2);
    ctx.lineTo(-s / 2, s / 2);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
};

const crosshatchRenderer: Renderer = (ctx, p, env) => {
  ctx.save();
  ctx.globalAlpha = num(p, 'opacity', 0.07);
  ctx.strokeStyle = resolveColor((p.color as string) ?? 'theme.accent', env.theme);
  ctx.lineWidth = 1;
  const gap = num(p, 'spacing', 22);
  for (let x = -env.h; x < env.w; x += gap) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x + env.h, env.h); ctx.stroke();
  }
  for (let x = 0; x < env.w + env.h; x += gap) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x - env.h, env.h); ctx.stroke();
  }
  ctx.restore();
};

const sunburstRenderer: Renderer = (ctx, p, env) => {
  ctx.save();
  ctx.globalAlpha = num(p, 'opacity', 0.06);
  ctx.strokeStyle = resolveColor((p.color as string) ?? 'theme.accent', env.theme);
  ctx.lineWidth = 1.5;
  const cx = env.w / 2; const cy = env.h / 2;
  const rays = Math.max(8, Math.round(num(p, 'rays', 48)));
  const len = Math.hypot(env.w, env.h);
  for (let i = 0; i < rays; i += 1) {
    const a = (Math.PI * 2 * i) / rays;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * len, cy + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();
};

const plusGridRenderer: Renderer = (ctx, p, env) => {
  ctx.save();
  ctx.globalAlpha = num(p, 'opacity', 0.1);
  ctx.strokeStyle = resolveColor((p.color as string) ?? 'theme.accent', env.theme);
  ctx.lineWidth = 1.5;
  ctx.lineCap = 'round';
  const spacing = num(p, 'spacing', 46);
  const arm = num(p, 'arm', 5);
  for (let y = spacing; y < env.h; y += spacing) {
    for (let x = spacing; x < env.w; x += spacing) {
      ctx.beginPath(); ctx.moveTo(x - arm, y); ctx.lineTo(x + arm, y);
      ctx.moveTo(x, y - arm); ctx.lineTo(x, y + arm); ctx.stroke();
    }
  }
  ctx.restore();
};

const balloonsScatterRenderer: Renderer = (ctx, p, env) => {
  const rng = mulberry32(env.seed ?? 41);
  const colors = (p.colors as string[]) ?? ['theme.accent'];
  const op = num(p, 'opacity', 0.16);
  ctx.save();
  const count = num(p, 'count', 16);
  for (let i = 0; i < count; i += 1) {
    const s = num(p, 'minSize', 16) + rng() * (num(p, 'maxSize', 42) - num(p, 'minSize', 16));
    const x = rng() * env.w; const y = rng() * env.h;
    const col = resolveColor(colors[i % colors.length], env.theme);
    ctx.fillStyle = col; ctx.strokeStyle = col;
    ctx.globalAlpha = op;
    ctx.beginPath(); ctx.ellipse(x, y, s * 0.6, s * 0.8, 0, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.moveTo(x, y + s * 0.8); ctx.lineTo(x - s * 0.1, y + s * 0.96); ctx.lineTo(x + s * 0.1, y + s * 0.96); ctx.closePath(); ctx.fill();
    ctx.globalAlpha = op * 0.6; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(x, y + s * 0.96); ctx.quadraticCurveTo(x + s * 0.2, y + s * 1.4, x, y + s * 1.8); ctx.stroke();
  }
  ctx.restore();
};

/** Registry of all procedural renderers, keyed by `renderer` in patterns.json. */
export const RENDERERS: Record<string, Renderer> = {
  balloonsScatterRenderer,
  bokehRenderer,
  diagonalStripeRenderer,
  diagonalSplitRenderer,
  dotPatternRenderer,
  geometricGridRenderer,
  shapesScatterRenderer,
  confettiRenderer,
  filmStripRenderer,
  filmGrainRenderer,
  vignetteRenderer,
  lightLeakRenderer,
  trianglesScatterRenderer,
  crosshatchRenderer,
  sunburstRenderer,
  plusGridRenderer,
};

/** Draw a named pattern onto a context. No-op for svg_overlay patterns. */
export function drawPattern(id: string, ctx: Ctx, env: RenderEnv): void {
  const def = getPattern(id);
  if (!def || def.type !== 'canvas_draw' || !def.renderer) return;
  const fn = RENDERERS[def.renderer];
  if (fn) fn(ctx, def.params ?? {}, env);
}
