/**
 * music.ipc.ts
 * -----------------------------------------------------------------------------
 * Slideshow music + video-export file plumbing:
 *  • music:list — bundled tracks (assets/music, generated originals) + the
 *    user's library (~/PebbleAlbum/music).
 *  • music:add — copy user-chosen audio files into the library (file dialog).
 *  • music:readBase64 — read a track as a data URL for WebAudio playback
 *    (reads are confined to the two music folders).
 *  • video:save — write the recorded slideshow video via a Save dialog.
 */
import { ipcMain, dialog, shell, app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import ffmpegStatic from 'ffmpeg-static';

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.flac']);
const AUDIO_MIME: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.m4a': 'audio/mp4', '.aac': 'audio/aac',
  '.wav': 'audio/wav', '.ogg': 'audio/ogg', '.flac': 'audio/flac',
};

function bundledMusicDir(): string {
  // Dev: <appRoot>/assets/music. Packaged: resources/assets/music (extraResources).
  const dev = path.join(app.getAppPath(), 'assets', 'music');
  const packaged = path.join(process.resourcesPath ?? '', 'assets', 'music');
  return app.isPackaged ? packaged : dev;
}
function userMusicDir(): string {
  return path.join(app.getPath('home'), 'PebbleAlbum', 'music');
}

export interface MusicTrack { path: string; name: string; source: 'bundled' | 'library' }

async function listDir(dir: string, source: MusicTrack['source']): Promise<MusicTrack[]> {
  let files: string[] = [];
  try { files = await fs.readdir(dir); } catch { return []; }
  return files
    .filter((f) => AUDIO_EXT.has(path.extname(f).toLowerCase()))
    .sort()
    .map((f) => ({ path: path.join(dir, f), name: path.basename(f, path.extname(f)).replace(/_/g, ' '), source }));
}

export async function listMusic(): Promise<MusicTrack[]> {
  return [...await listDir(bundledMusicDir(), 'bundled'), ...await listDir(userMusicDir(), 'library')];
}

/** Copy user-picked audio files into ~/PebbleAlbum/music. Returns new tracks. */
export async function addMusic(): Promise<MusicTrack[]> {
  const res = await dialog.showOpenDialog({
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'wav', 'ogg', 'flac'] }],
  });
  if (res.canceled || !res.filePaths.length) return [];
  const dir = userMusicDir();
  await fs.mkdir(dir, { recursive: true });
  const added: MusicTrack[] = [];
  for (const src of res.filePaths) {
    let dest = path.join(dir, path.basename(src));
    const ext = path.extname(dest); const stem = path.basename(dest, ext);
    let i = 1;
    // eslint-disable-next-line no-await-in-loop
    while (await fs.access(dest).then(() => true, () => false)) { dest = path.join(dir, `${stem}_${i}${ext}`); i += 1; }
    // eslint-disable-next-line no-await-in-loop
    await fs.copyFile(src, dest);
    added.push({ path: dest, name: path.basename(dest, ext).replace(/_/g, ' '), source: 'library' });
  }
  return added;
}

/** Read a track as a data URL — only from the two music folders. */
export async function readMusicBase64(p: string): Promise<string> {
  const full = path.resolve(p);
  const allowed = [path.resolve(bundledMusicDir()), path.resolve(userMusicDir())];
  if (!allowed.some((d) => full.startsWith(d + path.sep))) throw new Error('Not a music-library file.');
  const ext = path.extname(full).toLowerCase();
  if (!AUDIO_EXT.has(ext)) throw new Error('Not an audio file.');
  const buf = await fs.readFile(full);
  return `data:${AUDIO_MIME[ext] ?? 'application/octet-stream'};base64,${buf.toString('base64')}`;
}

/** Resolve the bundled ffmpeg binary path (works in dev and packaged app). */
function ffmpegPath(): string | null {
  if (!ffmpegStatic) return null;
  // In a packaged app the binary is unpacked from asar.
  return app.isPackaged ? ffmpegStatic.replace('app.asar', 'app.asar.unpacked') : ffmpegStatic;
}

/**
 * Re-encode the recorder's output into a standard, progressive MP4
 * (H.264 + AAC, `+faststart`). Chromium's MediaRecorder emits a FRAGMENTED
 * MP4 whose sample layout QuickTime/AVFoundation and many players can't parse
 * (audio plays, video is black). A full ffmpeg re-encode rewrites clean sample
 * tables + a single front-loaded `moov`, so the file plays everywhere.
 * Returns true on success; on any failure the caller keeps the raw file.
 */
function transcodeToStandardMp4(input: string, output: string): Promise<boolean> {
  const ff = ffmpegPath();
  if (!ff) return Promise.resolve(false);
  return new Promise((resolve) => {
    execFile(ff, [
      '-y', '-i', input,
      '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '192k',
      '-movflags', '+faststart',
      output,
    ], { timeout: 10 * 60 * 1000, maxBuffer: 1 << 24 }, (err) => resolve(!err));
  });
}

/**
 * Save the recorded slideshow video into `~/Documents/Pebble/exports`, re-encoded
 * to a standard progressive MP4 so it opens in QuickTime / Chrome / any player
 * (no blocking dialog), then reveal it. Returns the written path.
 */
export async function saveVideo(data: ArrayBuffer, defaultName: string): Promise<string | null> {
  const dir = path.join(app.getPath('documents'), 'Pebble', 'exports');
  await fs.mkdir(dir, { recursive: true });
  const wantMp4 = path.extname(defaultName).toLowerCase() === '.mp4';
  const stem = path.basename(defaultName, path.extname(defaultName)).replace(/[^a-z0-9_\- ]/gi, '') || 'slideshow';

  const pick = async (ext: string) => {
    let out = path.join(dir, `${stem}${ext}`); let i = 1;
    // eslint-disable-next-line no-await-in-loop
    while (await fs.access(out).then(() => true, () => false)) { out = path.join(dir, `${stem}_${i}${ext}`); i += 1; }
    return out;
  };

  // Write the raw recorder output to a temp file first.
  const tmp = path.join(dir, `.${stem}.recording${path.extname(defaultName) || '.mp4'}`);
  await fs.writeFile(tmp, Buffer.from(data));

  if (wantMp4) {
    const out = await pick('.mp4');
    const ok = await transcodeToStandardMp4(tmp, out);
    if (ok) {
      await fs.rm(tmp, { force: true });
      shell.showItemInFolder(out);
      return out;
    }
    // ffmpeg unavailable/failed → keep the raw recording rather than nothing.
    await fs.rename(tmp, out).catch(async () => { await fs.copyFile(tmp, out); await fs.rm(tmp, { force: true }); });
    shell.showItemInFolder(out);
    return out;
  }

  // Non-mp4 (webm fallback path): just place the raw file.
  const out = await pick(path.extname(defaultName) || '.webm');
  await fs.rename(tmp, out).catch(async () => { await fs.copyFile(tmp, out); await fs.rm(tmp, { force: true }); });
  shell.showItemInFolder(out);
  return out;
}

export function registerMusicIpc(): void {
  ipcMain.handle('music:list', () => listMusic());
  ipcMain.handle('music:add', () => addMusic());
  ipcMain.handle('music:readBase64', (_e, p: string) => readMusicBase64(p));
  ipcMain.handle('video:save', (_e, data: ArrayBuffer, name: string) => saveVideo(data, name));
}
