/**
 * imageLoader.ts — Renderer-only shared image loader with a global cache.
 *
 * Returns a base64 data URL for a (downscaled) source image. base64/data: URLs
 * load reliably in the renderer, whereas file:// URLs are blocked from the dev
 * server's http origin. The cache is shared across the canvas, page-strip
 * thumbnails and the images filmstrip so each file is read at most once per size.
 */
const cache = new Map<string, string>();

/**
 * @param sourceFolder absolute album source folder
 * @param filename     project-relative filename
 * @param size         max thumbnail dimension (px) to request from Sharp
 */
export async function loadImageDataUrl(sourceFolder: string, filename: string, size = 1600): Promise<string> {
  const key = `${filename}@${size}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const abs = `${sourceFolder}/${filename}`;
  let url: string;
  try {
    const thumb = await window.pebble.generateThumbnail(abs, size);
    url = await window.pebble.readImageBase64(thumb);
  } catch {
    url = await window.pebble.readImageBase64(abs);
  }
  cache.set(key, url);
  return url;
}

export function clearImageCache(): void { cache.clear(); }
