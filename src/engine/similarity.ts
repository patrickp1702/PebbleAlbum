/**
 * similarity.ts
 * -----------------------------------------------------------------------------
 * Near-duplicate detection + photo-quality scoring — the culling brain.
 *
 * Approach (what pro cullers like Aftershoot/Narrative/Lightroom do, distilled to
 * a fast, dependency-free heuristic):
 *   • a perceptual **dHash** (difference hash) makes a 64-bit fingerprint of each
 *     photo's structure that's robust to resize/compression/minor exposure shifts;
 *   • photos whose hashes are within a small **Hamming distance** AND similar
 *     aspect are clustered (union-find) into "same shot" groups (bursts/dupes);
 *   • each photo gets a **quality score** (sharpness via gradient energy ×
 *     exposure goodness) so the group's *best* frame — sharpest, well-exposed, not
 *     blurry/blown-out — is auto-suggested as the keeper.
 *
 * This module is PURE (no sharp/DOM): it takes already-decoded grayscale pixels
 * and precomputed hashes, so it runs identically in the main process, the
 * renderer, and unit tests.
 */

/** Build a 64-bit dHash (16 hex chars) from a 9×8 row-major grayscale buffer. */
export function dHashFromGray(g: ArrayLike<number>): string {
  let bits = '';
  for (let r = 0; r < 8; r += 1) {
    for (let c = 0; c < 8; c += 1) {
      const i = r * 9 + c;
      bits += (g[i] ?? 0) < (g[i + 1] ?? 0) ? '1' : '0';
    }
  }
  let hex = '';
  for (let i = 0; i < 64; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex; // 16 hex chars
}

/** Hamming distance between two equal-length hex hashes (0–64). */
export function hamming(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i += 1) {
    let x = (parseInt(a[i], 16) ^ parseInt(b[i], 16)) & 0xf;
    while (x) { d += x & 1; x >>= 1; }
  }
  return d;
}

export interface PhotoQuality {
  /** Mean gradient energy — higher = sharper (lower = blurry). */
  sharpness: number;
  /** 0..1 exposure goodness (1 = well exposed, low when clipped/too dark/bright). */
  exposure: number;
  /** Combined keeper score (sharpness × exposure). Higher = better. */
  score: number;
  /** Fraction of near-white pixels (blown highlights). */
  clipOver: number;
  /** Fraction of near-black pixels (crushed shadows). */
  clipUnder: number;
}

/** Quality metrics from a small (≤256px) row-major grayscale buffer. */
export function qualityFromGray(g: ArrayLike<number>, w: number, h: number): PhotoQuality {
  let grad = 0; let sum = 0; let over = 0; let under = 0; let n = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x; const v = g[i] ?? 0;
      sum += v; if (v > 239) over += 1; if (v < 16) under += 1;
      if (x + 1 < w) { const dx = v - (g[i + 1] ?? 0); grad += dx * dx; }
      if (y + 1 < h) { const dy = v - (g[i + w] ?? 0); grad += dy * dy; }
      n += 1;
    }
  }
  n = n || 1;
  const sharpness = grad / n;
  const mean = sum / n;
  const clipOver = over / n; const clipUnder = under / n;
  const meanPenalty = Math.abs(mean - 125) / 125; // 0 (mid-tone) … 1 (very dark/bright)
  const exposure = Math.max(0, 1 - (clipOver + clipUnder) * 2.5 - meanPenalty * 0.6);
  const score = sharpness * exposure;
  return {
    sharpness: +sharpness.toFixed(2), exposure: +exposure.toFixed(3), score: +score.toFixed(2),
    clipOver: +clipOver.toFixed(3), clipUnder: +clipUnder.toFixed(3),
  };
}

export interface SimItem { id: string; phash?: string; aspect?: number }

/** Cluster items into near-duplicate groups via union-find on Hamming distance. */
export function clusterPhotos(items: SimItem[], threshold = 10): string[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => { let r = i; while (parent[r] !== r) { parent[r] = parent[parent[r]]; r = parent[r]; } return r; };
  const union = (a: number, b: number): void => { const ra = find(a); const rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const A = items[i]; const B = items[j];
      if (!A.phash || !B.phash) continue;
      if (A.aspect && B.aspect && Math.abs(A.aspect - B.aspect) > 0.25) continue; // different shape ⇒ not the same shot
      if (hamming(A.phash, B.phash) <= threshold) union(i, j);
    }
  }
  const map = new Map<number, string[]>();
  items.forEach((it, i) => { const r = find(i); const arr = map.get(r) ?? []; arr.push(it.id); map.set(r, arr); });
  return [...map.values()];
}

export interface DuplicateGroup { id: string; members: string[]; suggested: string }

/** Build duplicate groups (size ≥ 2) with the highest-quality member suggested. */
export function buildDuplicateGroups(
  items: SimItem[],
  qualityById: Record<string, PhotoQuality | undefined>,
  threshold = 10,
): DuplicateGroup[] {
  const clusters = clusterPhotos(items, threshold).filter((c) => c.length >= 2);
  return clusters.map((members, idx) => ({
    id: `grp_${idx + 1}`,
    members: members.slice().sort((a, b) => (qualityById[b]?.score ?? 0) - (qualityById[a]?.score ?? 0)),
    suggested: pickBest(members, qualityById),
  }));
}

/** The best (highest-score) member of a group. */
export function pickBest(members: string[], qualityById: Record<string, PhotoQuality | undefined>): string {
  let best = members[0]; let bestScore = -Infinity;
  for (const m of members) {
    const s = qualityById[m]?.score ?? 0;
    if (s > bestScore) { bestScore = s; best = m; }
  }
  return best;
}

/** Human-readable quality flags for one photo within its group context. */
export function qualityFlags(q: PhotoQuality | undefined, groupMaxSharpness: number): string[] {
  if (!q) return [];
  const flags: string[] = [];
  if (groupMaxSharpness > 0 && q.sharpness < groupMaxSharpness * 0.6) flags.push('blurry');
  if (q.clipOver > 0.08) flags.push('overexposed');
  if (q.clipUnder > 0.12) flags.push('underexposed');
  return flags;
}
