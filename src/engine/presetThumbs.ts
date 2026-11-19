/**
 * presetThumbs.ts
 * -----------------------------------------------------------------------------
 * Generates the small "this preset on YOUR photo" thumbnails the Filters panel
 * shows (the PicsArt/Instagram pattern). One offscreen Fabric StaticCanvas is
 * reused; results are cached per source image so switching selection is instant.
 */
import { StaticCanvas, FabricImage } from 'fabric';
import { buildFilterStack } from './fabricFilters';
import { applyFiltersSafe } from './pageRenderer';

const SIZE = 84;
const cache = new Map<string, Record<string, string>>();

/**
 * Render every preset id over the given (small!) image data URL.
 * @param cacheKey usually the image filename
 * @param dataUrl  a SMALL thumbnail data URL (≤200px) — never the original
 */
export async function generatePresetThumbs(cacheKey: string, dataUrl: string, ids: string[]): Promise<Record<string, string>> {
  const hit = cache.get(cacheKey);
  if (hit && ids.every((id) => hit[id])) return hit;

  const out: Record<string, string> = {};
  const canvas = new StaticCanvas(undefined, { width: SIZE, height: SIZE, backgroundColor: '#111' });
  try {
    const img = await FabricImage.fromURL(dataUrl);
    const iw = img.width || 1; const ih = img.height || 1;
    const scale = Math.max(SIZE / iw, SIZE / ih); // cover-crop into the square
    img.set({
      left: SIZE / 2 - (iw * scale) / 2, top: SIZE / 2 - (ih * scale) / 2,
      scaleX: scale, scaleY: scale, originX: 'left', originY: 'top',
    });
    canvas.add(img);
    for (const id of ids) {
      // @ts-expect-error fabric filter typing is loose across the union
      img.filters = buildFilterStack(id);
      applyFiltersSafe(img);
      (img as unknown as { dirty?: boolean }).dirty = true;
      canvas.renderAll();
      out[id] = canvas.toDataURL({ format: 'jpeg', quality: 0.75, multiplier: 1 });
    }
  } finally {
    canvas.dispose();
  }
  cache.set(cacheKey, out);
  return out;
}

export function clearPresetThumbCache(): void { cache.clear(); }
