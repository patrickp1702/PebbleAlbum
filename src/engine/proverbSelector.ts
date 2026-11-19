/**
 * proverbSelector.ts
 * -----------------------------------------------------------------------------
 * Distributes proverbs across album pages according to a frequency policy and
 * honours per-page `proverb` flags first. Exposes the built-in library too.
 *
 * (The project structure references this module as the proverb selector; it is
 * re-exported from proverSelector.ts for spec-compatible imports.)
 */
import defaultProverbs from '@/config/defaultProverbs.json';
import type { AlbumPage } from '@shared/pebble.types';

export type ProverbFrequency = 'every' | 'every2' | 'every3' | 'flagged' | 'none';

interface ProverbCategory { category: string; proverbs: string[] }
const LIB = (defaultProverbs as { library: ProverbCategory[]; total: number });

/** Flat list of every built-in proverb. */
export function allBuiltInProverbs(): string[] {
  return LIB.library.flatMap((c) => c.proverbs);
}

export function proverbCategories(): string[] {
  return LIB.library.map((c) => c.category);
}

export function proverbsByCategory(category: string): string[] {
  return LIB.library.find((c) => c.category === category)?.proverbs ?? [];
}

/** Case-insensitive search across all categories. */
export function searchProverbs(query: string): { category: string; text: string }[] {
  const q = query.trim().toLowerCase();
  const out: { category: string; text: string }[] = [];
  for (const c of LIB.library) {
    for (const p of c.proverbs) {
      if (!q || p.toLowerCase().includes(q)) out.push({ category: c.category, text: p });
    }
  }
  return out;
}

function frequencyStep(freq: ProverbFrequency): number {
  switch (freq) {
    case 'every': return 1;
    case 'every2': return 2;
    case 'every3': return 3;
    default: return 0;
  }
}

/**
 * Assign proverbs to pages in place. Pages whose first image carries the
 * `proverb` flag always receive one; remaining proverbs are spread by frequency.
 * @returns the mutated pages array (for chaining).
 */
export function assignProverbs(
  pages: AlbumPage[],
  proverbs: string[],
  frequency: ProverbFrequency,
): AlbumPage[] {
  if (!proverbs.length || frequency === 'none') return pages;
  const pool = [...proverbs];
  let cursor = 0;
  const next = () => pool[cursor++ % pool.length];

  const step = frequencyStep(frequency);
  pages.forEach((page, idx) => {
    if (page.type === 'cover' || page.type === 'back_cover') return;
    const flagged = page.images.some((im) => im.parsedLabels.flags?.includes('proverb'));
    if (flagged || frequency === 'flagged') {
      if (flagged) page.proverb = next();
      return;
    }
    if (step > 0 && idx % step === 0) page.proverb = next();
  });
  return pages;
}
