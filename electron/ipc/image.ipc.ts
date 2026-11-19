/**
 * image.ipc.ts
 * -----------------------------------------------------------------------------
 * Reads source images on demand and extracts EXIF. Images are NEVER copied into
 * the project — only their absolute paths are stored. Reading returns a base64
 * data URL the renderer can assign directly to a Fabric image / <img>.
 */
import { ipcMain } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import type { ExifData } from '../../src/types/pebble.types';

const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.tiff': 'image/tiff', '.bmp': 'image/bmp',
};

export function mimeFor(file: string): string {
  return MIME[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
}

/** Read an image file as a base64 data URL. Throws if the file is missing. */
export async function readImageBase64(absolutePath: string): Promise<string> {
  const buf = await fs.readFile(absolutePath);
  return `data:${mimeFor(absolutePath)};base64,${buf.toString('base64')}`;
}

/** Extract a normalised EXIF subset using Sharp's metadata reader. */
export async function getImageExif(absolutePath: string): Promise<ExifData> {
  try {
    const meta = await sharp(absolutePath).metadata();
    const exif: ExifData = { orientation: meta.orientation };
    // Sharp exposes raw EXIF as a Buffer; parsing it fully is out of scope here,
    // but orientation + dimensions cover the layout-critical needs.
    return exif;
  } catch {
    return {};
  }
}

export function registerImageIpc(): void {
  ipcMain.handle('image:readBase64', (_e, p: string) => readImageBase64(p));
  ipcMain.handle('image:exif', (_e, p: string) => getImageExif(p));
}
