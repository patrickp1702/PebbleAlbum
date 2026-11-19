/**
 * maskShapes.ts
 * -----------------------------------------------------------------------------
 * PicsArt-style shape masks: generates an SVG path for a mask id fitted to a
 * rect, and builds the Fabric clipPath used by the renderer. Pure geometry —
 * safe to use from both the editor canvas and the static exporter.
 */
import { Path } from 'fabric';
import type { MaskId } from '@shared/pebble.types';

export interface MaskDef { id: MaskId; label: string; /** tiny glyph for the picker */ glyph: string }
export const MASKS: MaskDef[] = [
  { id: 'circle', label: 'Circle', glyph: '●' },
  { id: 'ellipse', label: 'Ellipse', glyph: '⬮' },
  { id: 'squircle', label: 'Squircle', glyph: '▢' },
  { id: 'heart', label: 'Heart', glyph: '♥' },
  { id: 'star', label: 'Star', glyph: '★' },
  { id: 'hexagon', label: 'Hexagon', glyph: '⬡' },
  { id: 'diamond', label: 'Diamond', glyph: '◆' },
  { id: 'arch', label: 'Arch', glyph: '◠' },
  { id: 'blob', label: 'Blob', glyph: '❨' },
  { id: 'scallop', label: 'Scallop', glyph: '❋' },
];

const fmt = (n: number) => Math.round(n * 100) / 100;

function polygonPath(pts: { x: number; y: number }[]): string {
  return `M${pts.map((p) => `${fmt(p.x)},${fmt(p.y)}`).join('L')}Z`;
}

function starPoints(w: number, h: number, spikes = 5, innerRatio = 0.45): { x: number; y: number }[] {
  const cx = w / 2; const cy = h / 2;
  const R = Math.min(w, h) / 2; const r = R * innerRatio;
  const pts = [];
  for (let i = 0; i < spikes * 2; i += 1) {
    const rad = i % 2 === 0 ? R : r;
    const a = (Math.PI / spikes) * i - Math.PI / 2;
    pts.push({ x: cx + rad * Math.cos(a), y: cy + rad * Math.sin(a) });
  }
  return pts;
}

function hexPoints(w: number, h: number): { x: number; y: number }[] {
  const cx = w / 2; const cy = h / 2;
  const pts = [];
  for (let i = 0; i < 6; i += 1) {
    const a = (Math.PI / 3) * i - Math.PI / 2;
    pts.push({ x: cx + (w / 2) * Math.cos(a) * 0.98, y: cy + (h / 2) * Math.sin(a) * 0.98 });
  }
  return pts;
}

/** Scalloped ellipse: n petal bumps around the rect's inscribed ellipse. */
function scallopPath(w: number, h: number, bumps = 12): string {
  const cx = w / 2; const cy = h / 2;
  const rx = w / 2 * 0.92; const ry = h / 2 * 0.92;
  let d = '';
  for (let i = 0; i < bumps; i += 1) {
    const a0 = (2 * Math.PI * i) / bumps - Math.PI / 2;
    const a1 = (2 * Math.PI * (i + 1)) / bumps - Math.PI / 2;
    const am = (a0 + a1) / 2;
    const x0 = cx + rx * Math.cos(a0); const y0 = cy + ry * Math.sin(a0);
    const x1 = cx + rx * Math.cos(a1); const y1 = cy + ry * Math.sin(a1);
    const xm = cx + rx * 1.13 * Math.cos(am); const ym = cy + ry * 1.13 * Math.sin(am);
    d += i === 0 ? `M${fmt(x0)},${fmt(y0)}` : '';
    d += `Q${fmt(xm)},${fmt(ym)} ${fmt(x1)},${fmt(y1)}`;
  }
  return `${d}Z`;
}

/** SVG path data for a mask id, fitted to a w×h box with origin (0,0). */
export function maskPathData(id: MaskId, w: number, h: number): string {
  switch (id) {
    case 'circle': {
      const r = Math.min(w, h) / 2; const cx = w / 2; const cy = h / 2;
      return `M${fmt(cx - r)},${fmt(cy)}A${fmt(r)},${fmt(r)} 0 1 0 ${fmt(cx + r)},${fmt(cy)}A${fmt(r)},${fmt(r)} 0 1 0 ${fmt(cx - r)},${fmt(cy)}Z`;
    }
    case 'ellipse':
      return `M0,${fmt(h / 2)}A${fmt(w / 2)},${fmt(h / 2)} 0 1 0 ${fmt(w)},${fmt(h / 2)}A${fmt(w / 2)},${fmt(h / 2)} 0 1 0 0,${fmt(h / 2)}Z`;
    case 'squircle': {
      const r = Math.min(w, h) * 0.3;
      return `M${fmt(r)},0L${fmt(w - r)},0Q${fmt(w)},0 ${fmt(w)},${fmt(r)}L${fmt(w)},${fmt(h - r)}Q${fmt(w)},${fmt(h)} ${fmt(w - r)},${fmt(h)}L${fmt(r)},${fmt(h)}Q0,${fmt(h)} 0,${fmt(h - r)}L0,${fmt(r)}Q0,0 ${fmt(r)},0Z`;
    }
    case 'heart':
      return `M${fmt(w * 0.5)},${fmt(h * 0.3)}C${fmt(w * 0.5)},${fmt(h * 0.08)} ${fmt(w * 0.32)},${fmt(h * -0.02)} ${fmt(w * 0.16)},${fmt(h * 0.08)}C0,${fmt(h * 0.2)} 0,${fmt(h * 0.42)} ${fmt(w * 0.14)},${fmt(h * 0.58)}L${fmt(w * 0.5)},${fmt(h * 0.96)}L${fmt(w * 0.86)},${fmt(h * 0.58)}C${fmt(w)},${fmt(h * 0.42)} ${fmt(w)},${fmt(h * 0.2)} ${fmt(w * 0.84)},${fmt(h * 0.08)}C${fmt(w * 0.68)},${fmt(h * -0.02)} ${fmt(w * 0.5)},${fmt(h * 0.08)} ${fmt(w * 0.5)},${fmt(h * 0.3)}Z`;
    case 'star': return polygonPath(starPoints(w, h));
    case 'hexagon': return polygonPath(hexPoints(w, h));
    case 'diamond': return polygonPath([{ x: w / 2, y: 0 }, { x: w, y: h / 2 }, { x: w / 2, y: h }, { x: 0, y: h / 2 }]);
    case 'arch':
      return `M0,${fmt(h)}L0,${fmt(h * 0.38)}Q0,0 ${fmt(w / 2)},0Q${fmt(w)},0 ${fmt(w)},${fmt(h * 0.38)}L${fmt(w)},${fmt(h)}Z`;
    case 'blob':
      return `M${fmt(w * 0.5)},${fmt(h * 0.02)}C${fmt(w * 0.78)},${fmt(h * -0.02)} ${fmt(w * 0.99)},${fmt(h * 0.18)} ${fmt(w * 0.97)},${fmt(h * 0.46)}C${fmt(w * 0.95)},${fmt(h * 0.72)} ${fmt(w * 0.84)},${fmt(h * 0.97)} ${fmt(w * 0.54)},${fmt(h * 0.99)}C${fmt(w * 0.26)},${fmt(h * 1.0)} ${fmt(w * 0.04)},${fmt(h * 0.84)} ${fmt(w * 0.02)},${fmt(h * 0.58)}C${fmt(w * 0.0)},${fmt(h * 0.3)} ${fmt(w * 0.2)},${fmt(h * 0.06)} ${fmt(w * 0.5)},${fmt(h * 0.02)}Z`;
    case 'scallop': return scallopPath(w, h);
    default: return `M0,0L${fmt(w)},0L${fmt(w)},${fmt(h)}L0,${fmt(h)}Z`;
  }
}

/** Build an absolute-positioned Fabric clipPath for a mask fitted to a rect. */
export function buildMaskPath(id: MaskId, rect: { x: number; y: number; width: number; height: number }): Path {
  const p = new Path(maskPathData(id, rect.width, rect.height), {
    left: rect.x, top: rect.y, originX: 'left', originY: 'top',
    absolutePositioned: true,
  });
  return p;
}
