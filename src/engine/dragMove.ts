/**
 * dragMove.ts — Shared drag-and-drop payload helpers for moving images between
 * pages (page strip / filmstrip / canvas). An image dropped on another page is
 * added as "not placed" so it stays assigned to that page for the user to align.
 * A MOVE of an existing page image (payload carries `fromImageId`) keeps the
 * photo's look — erase mask, effects, border, shadow, shape mask, opacity,
 * flips, caption — via `carriedAppearance`; a plain bin drop starts fresh.
 */
import { v4 as uuid } from 'uuid';
import { defaultEffects } from './collageComposer';
import type { ImageRecord, AlbumPage, PebbleProject, PageImage } from '@shared/pebble.types';

/** The slice of the project store dragMove needs (structural, avoids a cycle). */
interface ProjectStore {
  pages: readonly AlbumPage[];
  images: readonly ImageRecord[];
  project: PebbleProject | null;
  syncUsage: (p: PebbleProject) => void;
  markDirty: () => void;
}

export interface MovePayload {
  filename: string;
  fromPageId?: string;
  fromImageId?: string;
}

export const MOVE_MIME = 'application/pebble-move';
export const FILE_MIME = 'text/pebble-image';

/** Write a move payload onto a drag event's dataTransfer. */
export function setMovePayload(e: DragEvent, p: MovePayload): void {
  if (!e.dataTransfer) return;
  e.dataTransfer.setData(MOVE_MIME, JSON.stringify(p));
  e.dataTransfer.setData(FILE_MIME, p.filename); // canvas free-drop fallback
  e.dataTransfer.effectAllowed = 'move';
}

/** Read a move/place payload from a drop event (move JSON, else plain filename). */
export function movePayloadFromDrop(e: DragEvent): MovePayload | null {
  const raw = e.dataTransfer?.getData(MOVE_MIME);
  if (raw) { try { return JSON.parse(raw) as MovePayload; } catch { /* fall through */ } }
  const file = e.dataTransfer?.getData(FILE_MIME);
  return file ? { filename: file } : null;
}

/** The appearance fields a MOVED image keeps (everything but placement). */
export type CarriedAppearance = Partial<Pick<PageImage,
  'eraseMask' | 'effects' | 'border' | 'shadow' | 'maskId' | 'opacity' | 'caption' | 'captionStyle' | 'overrides'>>
  & { flipX?: boolean; flipY?: boolean };

/**
 * Snapshot the look of an existing page image so a move to another page (or a
 * re-drop on the canvas) doesn't silently drop its erasing / effects / border…
 * Deep-copied through JSON (store objects are reactive proxies, which
 * structuredClone rejects) so the new image never shares nested objects with
 * the old one. Placement (position/slot/clip/fit/zIndex/visible) is NOT carried.
 */
export function carriedAppearance(src: PageImage): CarriedAppearance {
  const copy = <T>(v: T): T => (v == null ? v : JSON.parse(JSON.stringify(v)) as T);
  const out: CarriedAppearance = {
    effects: copy(src.effects), border: copy(src.border), shadow: copy(src.shadow),
    opacity: src.opacity, overrides: copy(src.overrides),
    flipX: !!src.position?.flipX, flipY: !!src.position?.flipY,
  };
  if (src.eraseMask) out.eraseMask = src.eraseMask;
  if (src.maskId) out.maskId = src.maskId;
  if (src.caption) out.caption = src.caption;
  if (src.captionStyle) out.captionStyle = copy(src.captionStyle);
  return out;
}

/** Apply a carried appearance onto a freshly built PageImage (mutates + returns it). */
export function applyCarriedAppearance<T extends PageImage>(img: T, look: CarriedAppearance | null | undefined): T {
  if (!look) return img;
  const { flipX, flipY, ...rest } = look;
  Object.assign(img, rest);
  img.position = { ...img.position, flipX: !!flipX, flipY: !!flipY };
  return img;
}

/** Find an image by id on any page. */
function findPageImage(pages: readonly AlbumPage[], pageId: string | undefined, imageId: string): PageImage | undefined {
  const src = pageId ? pages.find((p) => p.id === pageId) : undefined;
  return src?.images.find((i) => i.id === imageId)
    ?? pages.flatMap((p) => p.images).find((i) => i.id === imageId);
}

function makeNotPlaced(filename: string, rec?: ImageRecord): PageImage {
  return {
    id: uuid(),
    filename,
    slotId: 'unplaced',
    position: { x: 0, y: 0, width: rec?.width ?? 1000, height: rec?.height ?? 1000, rotation: 0, scaleX: 1, scaleY: 1, flipX: false, flipY: false },
    fit: 'cover' as const,
    crop: { x: 0, y: 0, width: 1, height: 1 },
    parsedLabels: rec?.parsedLabels ?? {},
    overrides: {},
    effects: defaultEffects(),
    border: null,
    shadow: null,
    opacity: 1,
    zIndex: 1000,
    visible: false,
  };
}

/**
 * Apply an image drop to a target page index. Moves the image off its source
 * page (if any) and adds it to the target as "not placed".
 * @returns a toast message, or null if nothing happened.
 */
export function applyImageDropToPage(project: ProjectStore, move: MovePayload, toIndex: number): string | null {
  const target = project.pages[toIndex];
  if (!target) return null;
  // Remove from source page when this is a true move — snapshotting its look first.
  let look: CarriedAppearance | null = null;
  if (move.fromPageId && move.fromImageId) {
    if (move.fromPageId === target.id) return null; // dropped on same page
    const from = findPageImage(project.pages, move.fromPageId, move.fromImageId);
    if (from) look = carriedAppearance(from);
    const src = project.pages.find((p) => p.id === move.fromPageId);
    if (src) src.images = src.images.filter((i) => i.id !== move.fromImageId);
  }
  const rec = project.images.find((r) => r.relativePath === move.filename);
  target.images.push(applyCarriedAppearance(makeNotPlaced(move.filename, rec), look));
  if (project.project) project.syncUsage(project.project);
  project.markDirty();
  return `Moved ${move.filename} to page ${toIndex + 1} — open it and place from the right panel.`;
}
