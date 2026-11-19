/**
 * borderFrames.ts
 * -----------------------------------------------------------------------------
 * Decorative SVG photo borders ("frames"). Unlike the simple stroked-rectangle
 * borders, these draw a repeating motif around the photo's perimeter — e.g. the
 * scalloped fan/shell band, spaced dots, Greek key, rope, vine, etc.
 *
 * Each border is an EDGE MOTIF that tiles along an edge. We generate the full
 * frame SVG at the photo frame's exact pixel size (so the motif tiles cleanly
 * and is NOT stretched), then place it as an image on the frame. The art is
 * themeable: `{color}` is the border colour (usually the theme accent).
 *
 * To add a new border: add an entry to BORDER_FRAMES and an `edge()` case below.
 */

export interface BorderFrameDef {
  id: string;
  label: string;
  /** Suggested band thickness as a multiple of the border `width`. */
  thicknessFactor?: number;
}

export const BORDER_FRAMES: BorderFrameDef[] = [
  { id: 'scallop_fan', label: 'Scallop Fan', thicknessFactor: 1.6 },
  { id: 'scallop', label: 'Scallops', thicknessFactor: 1.4 },
  { id: 'dots', label: 'Spaced Dots', thicknessFactor: 1.0 },
  { id: 'dashes', label: 'Dashes', thicknessFactor: 0.8 },
  { id: 'zigzag', label: 'Zigzag', thicknessFactor: 1.0 },
  { id: 'wave', label: 'Wave', thicknessFactor: 1.0 },
  { id: 'greek_key', label: 'Greek Key', thicknessFactor: 1.1 },
  { id: 'rope', label: 'Rope', thicknessFactor: 1.0 },
  { id: 'beads', label: 'Beads', thicknessFactor: 1.0 },
  { id: 'deco_lines', label: 'Deco Lines', thicknessFactor: 0.9 },
  { id: 'vine', label: 'Leaf Vine', thicknessFactor: 1.3 },
  { id: 'hearts', label: 'Hearts', thicknessFactor: 1.1 },
  { id: 'triangles', label: 'Triangles', thicknessFactor: 1.0 },
  { id: 'washi_tape', label: 'Washi Tape', thicknessFactor: 1.2 },
  { id: 'film_strip', label: 'Film Strip', thicknessFactor: 1.2 },
  { id: 'studs', label: 'Studs', thicknessFactor: 1.0 },
  { id: 'pinstripe', label: 'Pinstripe', thicknessFactor: 0.7 },
];

const BY_ID = new Map(BORDER_FRAMES.map((b) => [b.id, b]));
export function getBorderFrame(id: string): BorderFrameDef | undefined { return BY_ID.get(id); }

/** Repeat a per-tile motif across an edge of length `len`, fitting whole tiles.
 *  Tile count is capped so very large frames can't produce a huge SVG string. */
function rep(len: number, tile: number, fn: (x: number, w: number) => string): string {
  const count = Math.min(80, Math.max(1, Math.round(len / Math.max(1, tile))));
  const w = len / count;
  let s = '';
  for (let i = 0; i < count; i += 1) s += fn(i * w, w);
  return s;
}

/**
 * Build one edge band, drawn along x ∈ [0, len], occupying y ∈ [0, t], with the
 * motif pointing DOWN (= inward once the band is rotated onto each side).
 */
function edge(id: string, len: number, t: number, c: string): string {
  const hl = 'rgba(255,255,255,0.85)'; // highlight for the fan rays
  switch (id) {
    case 'scallop_fan': {
      const bar = Math.max(2, t * 0.16);
      let s = `<rect x="0" y="0" width="${len}" height="${bar}" fill="${c}"/>`;
      s += rep(len, t * 0.95, (x, w) => {
        const cx = x + w / 2; const top = bar; const depth = t - bar - 1;
        let g = `<path d="M ${f(x)} ${f(top)} Q ${f(cx)} ${f(top + depth * 1.5)} ${f(x + w)} ${f(top)} Z" fill="${c}"/>`;
        const rays = 6;
        for (let k = 0; k <= rays; k += 1) {
          const ex = x + (k / rays) * w;
          g += `<line x1="${f(cx)}" y1="${f(top + 1)}" x2="${f(ex)}" y2="${f(top + depth * 0.9)}" stroke="${hl}" stroke-width="0.8" stroke-linecap="round"/>`;
        }
        g += `<circle cx="${f(cx)}" cy="${f(top + 1.5)}" r="1.3" fill="${hl}"/>`;
        return g;
      });
      return s;
    }
    case 'scallop': {
      const bar = Math.max(2, t * 0.14);
      let s = `<rect x="0" y="0" width="${len}" height="${bar}" fill="${c}"/>`;
      s += rep(len, t * 0.9, (x, w) => {
        const cx = x + w / 2; const depth = t - bar;
        return `<path d="M ${f(x)} ${f(bar)} Q ${f(cx)} ${f(bar + depth * 1.4)} ${f(x + w)} ${f(bar)} Z" fill="${c}"/>`;
      });
      return s;
    }
    case 'dots':
      return rep(len, t * 0.9, (x, w) => `<circle cx="${f(x + w / 2)}" cy="${f(t / 2)}" r="${f(t * 0.22)}" fill="${c}"/>`);
    case 'dashes':
      return rep(len, t * 1.1, (x, w) => `<rect x="${f(x + w * 0.18)}" y="${f(t * 0.38)}" width="${f(w * 0.64)}" height="${f(t * 0.24)}" rx="${f(t * 0.12)}" fill="${c}"/>`);
    case 'zigzag':
      return `<path d="${zig(len, t * 0.92, t)}" fill="none" stroke="${c}" stroke-width="${f(Math.max(1.5, t * 0.12))}" stroke-linejoin="round" stroke-linecap="round"/>`;
    case 'wave':
      return `<path d="${wave(len, t)}" fill="none" stroke="${c}" stroke-width="${f(Math.max(1.5, t * 0.14))}" stroke-linecap="round"/>`;
    case 'greek_key':
      return rep(len, t * 1.4, (x, w) => greekKey(x, w, t, c));
    case 'rope':
      return rep(len, t * 0.7, (x, w) => `<path d="M ${f(x)} ${f(t * 0.5)} Q ${f(x + w * 0.5)} ${f(t * 0.05)} ${f(x + w)} ${f(t * 0.5)} Q ${f(x + w * 0.5)} ${f(t * 0.95)} ${f(x)} ${f(t * 0.5)} Z" fill="${c}" opacity="0.92"/>`);
    case 'beads':
      return rep(len, t * 0.8, (x, w) => `<circle cx="${f(x + w / 2)}" cy="${f(t / 2)}" r="${f(t * 0.26)}" fill="${c}"/><circle cx="${f(x + w)}" cy="${f(t / 2)}" r="${f(t * 0.1)}" fill="${c}"/>`);
    case 'deco_lines': {
      const y1 = t * 0.3; const y2 = t * 0.7; const lw = Math.max(1, t * 0.08);
      let s = `<rect x="0" y="${f(y1)}" width="${len}" height="${f(lw)}" fill="${c}"/><rect x="0" y="${f(y2)}" width="${len}" height="${f(lw)}" fill="${c}"/>`;
      s += rep(len, t * 1.2, (x) => `<rect x="${f(x)}" y="${f(y1)}" width="${f(lw)}" height="${f(y2 - y1 + lw)}" fill="${c}"/>`);
      return s;
    }
    case 'vine': {
      const midY = t * 0.5;
      let s = `<path d="M 0 ${f(midY)} L ${f(len)} ${f(midY)}" stroke="${c}" stroke-width="${f(Math.max(1, t * 0.08))}" fill="none"/>`;
      s += rep(len, t * 1.1, (x, w) => {
        const cx = x + w / 2; const lr = w * 0.34;
        return `<path d="M ${f(cx)} ${f(midY)} q ${f(-lr)} ${f(-t * 0.34)} ${f(-lr * 0.3)} ${f(-t * 0.42)} q ${f(lr * 0.7)} ${f(0)} ${f(lr * 0.3)} ${f(t * 0.42)} z" fill="${c}"/>` +
               `<path d="M ${f(cx)} ${f(midY)} q ${f(lr)} ${f(t * 0.34)} ${f(lr * 0.3)} ${f(t * 0.42)} q ${f(-lr * 0.7)} ${f(0)} ${f(-lr * 0.3)} ${f(-t * 0.42)} z" fill="${c}" opacity="0.85"/>`;
      });
      return s;
    }
    case 'hearts':
      return rep(len, t * 0.95, (x, w) => {
        const s = Math.min(w, t) * 0.6; const cx = x + w / 2; const cy = t * 0.5 - s * 0.1;
        return `<path d="M ${f(cx)} ${f(cy + s * 0.78)} C ${f(cx - s)} ${f(cy + s * 0.2)} ${f(cx - s * 0.5)} ${f(cy - s * 0.35)} ${f(cx)} ${f(cy + s * 0.08)} C ${f(cx + s * 0.5)} ${f(cy - s * 0.35)} ${f(cx + s)} ${f(cy + s * 0.2)} ${f(cx)} ${f(cy + s * 0.78)} Z" fill="${c}"/>`;
      });
    case 'triangles':
      return rep(len, t * 1.0, (x, w) => `<path d="M ${f(x)} ${f(t * 0.15)} L ${f(x + w)} ${f(t * 0.15)} L ${f(x + w / 2)} ${f(t * 0.9)} Z" fill="${c}"/>`);
    case 'washi_tape':
      return rep(len, t * 1.9, (x, w) => {
        const cx = x + w / 2; const tw = w * 0.82; const th = t * 0.62;
        return `<g transform="rotate(-5 ${f(cx)} ${f(t / 2)})"><rect x="${f(cx - tw / 2)}" y="${f((t - th) / 2)}" width="${f(tw)}" height="${f(th)}" fill="${c}" opacity="0.55"/><rect x="${f(cx - tw / 2)}" y="${f((t - th) / 2)}" width="${f(tw)}" height="${f(th * 0.28)}" fill="#ffffff" opacity="0.18"/></g>`;
      });
    case 'film_strip': {
      let s = `<rect x="0" y="0" width="${len}" height="${f(t)}" fill="#141414" opacity="0.92"/>`;
      const hole = t * 0.34; const hw = hole * 0.8;
      s += rep(len, hole * 1.9, (x, w) => `<rect x="${f(x + (w - hw) / 2)}" y="${f(t * 0.5 - hole / 2)}" width="${f(hw)}" height="${f(hole)}" rx="${f(hw * 0.25)}" fill="#fdfdfd"/>`);
      return s;
    }
    case 'studs':
      return rep(len, t * 0.95, (x, w) => {
        const cx = x + w / 2; const r = t * 0.24;
        return `<circle cx="${f(cx)}" cy="${f(t / 2)}" r="${f(r)}" fill="${c}"/><circle cx="${f(cx - r * 0.3)}" cy="${f(t / 2 - r * 0.3)}" r="${f(r * 0.35)}" fill="#ffffff" opacity="0.5"/>`;
      });
    case 'pinstripe': {
      const lw = Math.max(1, t * 0.09);
      return `<rect x="0" y="${f(t * 0.32)}" width="${len}" height="${f(lw)}" fill="${c}"/><rect x="0" y="${f(t * 0.62)}" width="${len}" height="${f(lw * 0.6)}" fill="${c}" opacity="0.7"/>`;
    }
    default:
      return `<rect x="0" y="${f(t * 0.4)}" width="${len}" height="${f(t * 0.2)}" fill="${c}"/>`;
  }
}

/** Round to 2dp to keep the generated SVG small. */
function f(n: number): number { return Math.round(n * 100) / 100; }

function zig(len: number, amp: number, t: number): string {
  const step = Math.max(6, t * 0.9);
  const count = Math.max(2, Math.round(len / step));
  const w = len / count;
  let d = `M 0 ${f(t * 0.5 + amp * 0.5)}`;
  for (let i = 0; i < count; i += 1) {
    d += ` L ${f((i + 0.5) * w)} ${f(t * 0.5 - amp * 0.5)} L ${f((i + 1) * w)} ${f(t * 0.5 + amp * 0.5)}`;
  }
  return d;
}

function wave(len: number, t: number): string {
  const step = Math.max(10, t * 1.4);
  const count = Math.max(2, Math.round(len / step));
  const w = len / count;
  let d = `M 0 ${f(t * 0.5)}`;
  for (let i = 0; i < count; i += 1) {
    const x0 = i * w; const dir = i % 2 === 0 ? -1 : 1;
    d += ` Q ${f(x0 + w * 0.5)} ${f(t * 0.5 + dir * t * 0.34)} ${f(x0 + w)} ${f(t * 0.5)}`;
  }
  return d;
}

function greekKey(x: number, w: number, t: number, c: string): string {
  const sw = Math.max(1.2, t * 0.1);
  const a = t * 0.22;
  // A simple squared meander unit.
  const d = `M ${f(x + a)} ${f(t - a)} L ${f(x + a)} ${f(a)} L ${f(x + w - a)} ${f(a)} L ${f(x + w - a)} ${f(t - a * 2)} L ${f(x + w - a * 2.4)} ${f(t - a * 2)} L ${f(x + w - a * 2.4)} ${f(a * 2)} L ${f(x + a * 2.4)} ${f(a * 2)}`;
  return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${f(sw)}"/>`;
}

/**
 * Build the full decorative border-frame SVG sized to the frame (w × h), with a
 * transparent centre. The four edges reuse the same motif, rotated onto each
 * side, so the motif always points inward.
 */
export function borderFrameSvg(id: string, w: number, h: number, color: string, thickness: number): string {
  const t = Math.max(6, thickness);
  const top = edge(id, w, t, color);
  const bottom = edge(id, w, t, color);
  const left = edge(id, h, t, color);
  const right = edge(id, h, t, color);
  return `<svg width="${f(w)}" height="${f(h)}" viewBox="0 0 ${f(w)} ${f(h)}" xmlns="http://www.w3.org/2000/svg">`
    + `<g>${top}</g>`
    + `<g transform="translate(${f(w)} ${f(h)}) rotate(180)">${bottom}</g>`
    + `<g transform="translate(0 ${f(h)}) rotate(-90)">${left}</g>`
    + `<g transform="translate(${f(w)} 0) rotate(90)">${right}</g>`
    + `</svg>`;
}

/** Data URL for a border frame at a given size + colour. */
export function borderFrameDataUrl(id: string, w: number, h: number, color: string, thickness: number): string | null {
  if (!BY_ID.has(id)) return null;
  const svg = borderFrameSvg(id, w, h, color, thickness);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
