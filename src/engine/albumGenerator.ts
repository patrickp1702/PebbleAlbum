/**
 * albumGenerator.ts
 * -----------------------------------------------------------------------------
 * Orchestrates full album generation from a folder of images + settings.
 * Pipeline: filter → sort → group → assign roles → select layout → compose →
 * decorate → place proverbs → cover → back cover.
 *
 * Pure & synchronous (except optional progress callback) so it can run in a
 * Web Worker or be unit-tested directly.
 */
import type {
  AlbumMeta, AlbumPage, ImageRecord, Decoration,
} from '@shared/pebble.types';
import { v4 as uuid } from 'uuid';
import { hasFlag } from './filenameParser';
import { selectLayout, getLayout, layoutsByCategory, type LayoutImageItem } from './layoutSelector';
import { composePage, ComposeOptions } from './collageComposer';
import { assignProverbs, ProverbFrequency } from './proverbSelector';
import { resolveTheme } from './themeEngine';

export interface GeneratorConfig {
  minImagesPerPage: number;
  maxImagesPerPage: number;
  variety: number; // 0..1
  randomLayouts: boolean;
  sortBy: 'filename' | 'date' | 'manual';
  proverbFrequency: ProverbFrequency;
  groupByDate: boolean;
  sectionDividers: boolean;
  backCover: boolean;
  compose: ComposeOptions;
}

export type ProgressCb = (step: string, pct: number) => void;

export const DEFAULT_GENERATOR_CONFIG: GeneratorConfig = {
  minImagesPerPage: 2,
  maxImagesPerPage: 4,
  variety: 0.7,
  randomLayouts: true,
  sortBy: 'filename',
  proverbFrequency: 'every3',
  groupByDate: false,
  sectionDividers: false,
  backCover: true,
  compose: { captionStyle: 'none' },
};

/** Step 2: sort images by order label, then date or filename. */
function sortImages(records: ImageRecord[], sortBy: GeneratorConfig['sortBy']): ImageRecord[] {
  return [...records].sort((a, b) => {
    const ao = a.parsedLabels.order ?? Number.POSITIVE_INFINITY;
    const bo = b.parsedLabels.order ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    if (sortBy === 'date') {
      const ad = a.exif?.dateTaken ?? a.filename;
      const bd = b.exif?.dateTaken ?? b.filename;
      return ad.localeCompare(bd);
    }
    return a.filename.localeCompare(b.filename);
  });
}

/** Orientation bucket for a record: 'p' portrait, 'l' landscape, 's' square. */
function orientationOf(r: ImageRecord): 'p' | 'l' | 's' {
  const ar = r.width > 0 && r.height > 0 ? r.width / r.height : 1.5;
  if (ar < 0.92) return 'p';
  if (ar > 1.1) return 'l';
  return 's';
}

/**
 * Step 3: split images into page-sized groups honouring tags + flags AND
 * keeping each group orientation-homogeneous where possible, so a page's images
 * share a shape and the chosen layout fits them without heavy cropping.
 */
function groupImages(records: ImageRecord[], cfg: GeneratorConfig): ImageRecord[][] {
  const groups: ImageRecord[][] = [];
  let current: ImageRecord[] = [];
  let currentTag: string | undefined;
  let currentOrient: 'p' | 'l' | 's' | null = null;

  const flush = () => { if (current.length) { groups.push(current); current = []; currentOrient = null; } };

  for (const rec of records) {
    const lbl = rec.parsedLabels;
    const tag = lbl.pageTag;
    const orient = orientationOf(rec);

    if (hasFlag(lbl, 'newpage') || hasFlag(lbl, 'fullpage')) flush();
    if (tag !== currentTag && current.length) flush();
    // Start a new page when orientation changes mid-group (keeps shapes consistent),
    // but only once the group already has at least 2 images so we don't make
    // every page a single photo.
    if (!tag && currentOrient && orient !== currentOrient && current.length >= 2) flush();
    currentTag = tag;
    if (currentOrient === null) currentOrient = orient;

    current.push(rec);

    if (hasFlag(lbl, 'fullpage')) { flush(); continue; }
    // Portrait pages can hold more (e.g. 3 side-by-side); landscape fewer.
    const cap = currentOrient === 'p' ? Math.max(cfg.maxImagesPerPage, 3) : cfg.maxImagesPerPage;
    if (!tag && current.length >= cap) flush();
  }
  flush();
  return groups;
}

function itemsOf(records: ImageRecord[]): LayoutImageItem[] {
  return records.map((r) => ({ labels: r.parsedLabels, aspect: r.width > 0 && r.height > 0 ? r.width / r.height : 1.5 }));
}

/** Theme-driven page decorations (one descriptor per configured pattern). */
function themeDecorations(patternIds: string[]): Decoration[] {
  return patternIds.map((id, i) => ({
    id: uuid(),
    type: 'pattern_tile',
    renderer: id,
    params: {},
    position: { x: 0, y: 0, width: 1, height: 1, rotation: 0 },
    opacity: 1,
    blendMode: 'normal',
    zIndex: -10 + i,
    visible: true,
    locked: false,
  }));
}

/**
 * Generate the full ordered page list.
 */
export function generateAlbum(
  meta: AlbumMeta,
  imageRecords: ImageRecord[],
  config: Partial<GeneratorConfig> = {},
  onProgress?: ProgressCb,
): AlbumPage[] {
  const cfg = { ...DEFAULT_GENERATOR_CONFIG, ...config };
  const theme = resolveTheme(meta);
  const pages: AlbumPage[] = [];
  const recentLayoutIds: string[] = [];

  onProgress?.('Scanning images', 5);
  // Step 1: filter skipped images.
  const usable = imageRecords.filter((r) => !r.skipped && !hasFlag(r.parsedLabels, 'skip'));

  onProgress?.('Parsing labels', 15);
  const sorted = sortImages(usable, cfg.sortBy);

  // Step 4a: pick a cover image (explicit cover/hero, else the first image).
  const coverIdx = sorted.findIndex((r) => r.parsedLabels.role === 'cover' || r.parsedLabels.role === 'hero');
  const coverRec = coverIdx >= 0 ? sorted.splice(coverIdx, 1)[0] : sorted[0];
  const interiorStart = coverIdx >= 0 ? 0 : 1;
  const interior = sorted.slice(interiorStart);

  onProgress?.('Selecting layouts', 30);
  // Step 9: cover page.
  if (coverRec) {
    const coverLayout = layoutsByCategory('cover')[0];
    const cover = composePage(coverLayout, [coverRec], theme, meta, 0, 'cover', cfg.compose);
    cover.decorations = themeDecorations(theme.decorations);
    cover.textBlocks.push({
      id: uuid(),
      content: meta.coverTitle || meta.name,
      type: 'title',
      position: { x: 0.05 * meta.albumWidth, y: 0.7 * meta.albumHeight, width: 0.9 * meta.albumWidth, height: 0.15 * meta.albumHeight, rotation: 0 },
      style: {
        fontFamily: theme.fonts.display, fontSize: Math.round(meta.albumHeight * 0.06),
        fontWeight: '700', fontStyle: 'normal', color: theme.colors.text, align: 'center',
        letterSpacing: 1, lineHeight: 1.1, textTransform: 'none', opacity: 1,
      },
      zIndex: 100, visible: true, locked: false,
    });
    pages.push(cover);
  }

  // Steps 5-8: interior pages.
  const groups = groupImages(interior, cfg);
  onProgress?.('Composing pages', 45);
  groups.forEach((group, gi) => {
    const isFull = group.length === 1 && hasFlag(group[0].parsedLabels, 'fullpage');
    let layout;
    if (isFull) {
      layout = getLayout('single_full')!;
    } else {
      const albumAspect = meta.albumWidth / meta.albumHeight;
      // Occasionally use a trendy creative (diagonal/overlapping) layout for variety.
      const wantCreative = cfg.randomLayouts && Math.random() < 0.28;
      if (wantCreative) {
        const creative = selectLayout(itemsOf(group), { recentLayoutIds, variety: cfg.variety, category: 'creative', albumAspect }, true);
        if (creative && creative.id !== 'single_full') layout = creative;
      }
      if (!layout) {
        layout = selectLayout(itemsOf(group), { recentLayoutIds, variety: cfg.variety, category: 'spread', albumAspect }, cfg.randomLayouts);
        if (!layout || layout.id === 'single_full') {
          layout = selectLayout(itemsOf(group), { recentLayoutIds, variety: cfg.variety, albumAspect }, cfg.randomLayouts);
        }
      }
    }
    recentLayoutIds.push(layout.id);
    const type = group.length === 1 ? 'single' : 'spread';
    const page = composePage(layout, group, theme, meta, pages.length, type, cfg.compose);
    // Keep most interior pages clean. Apply theme decorations to only a random
    // ~30% of pages, and a single corner sticker to a random ~18%, so the album
    // breathes instead of every page being busy.
    page.decorations = Math.random() < 0.3 ? themeDecorations(theme.decorations) : [];
    if (theme.stickers?.length && Math.random() < 0.18) {
      const emoji = theme.stickers[gi % theme.stickers.length];
      const size = Math.round(meta.albumHeight * 0.09);
      page.decorations.push({
        id: uuid(), type: 'sticker', params: { emoji },
        position: { x: meta.albumWidth - size * 1.5, y: meta.albumHeight - size * 1.5, width: size, height: size, rotation: 0 },
        opacity: 0.92, blendMode: 'normal', zIndex: 450, visible: true, locked: false,
      });
    }
    pages.push(page);
    onProgress?.('Composing pages', 45 + Math.round((gi / Math.max(1, groups.length)) * 35));
  });

  // Step 8: proverbs.
  onProgress?.('Placing proverbs', 85);
  assignProverbs(pages, meta.proverbs, cfg.proverbFrequency);

  // Step 10: back cover.
  if (cfg.backCover) {
    pages.push({
      id: uuid(), index: pages.length, type: 'back_cover',
      layoutId: 'single_full', backgroundColor: undefined,
      images: [], decorations: themeDecorations(theme.decorations), textBlocks: [],
      locked: false,
    });
  }

  // Re-index.
  pages.forEach((p, i) => { p.index = i; });
  onProgress?.('Saving project', 100);
  return pages;
}
