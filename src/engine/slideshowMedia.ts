/**
 * slideshowMedia.ts
 * -----------------------------------------------------------------------------
 * Slideshow sound + video export (the Movavi/Icecream model):
 *  • SlideshowPlaylist — WebAudio playlist player for the selected music
 *    tracks. Plays them in order and LOOPS back to the first when the show is
 *    longer than the music; fades out on stop. Can also expose a MediaStream
 *    so the exact same audio is muxed into the exported video.
 *  • recordSlideshow — records the live Three.js preview canvas from the first
 *    page to the last (per-page durations + the selected transition), muxed
 *    with the playlist audio. Prefers real MP4 (H.264/AAC via Chromium's
 *    MediaRecorder muxer); falls back to WebM when unavailable.
 */
import type { AlbumPage, AlbumMeta } from '@shared/pebble.types';

const DEFAULT_PAGE_SEC = 4;

export function pageDuration(page: AlbumPage | undefined, meta: AlbumMeta | null): number {
  return Math.max(1, page?.durationSec ?? meta?.slideshowInterval ?? DEFAULT_PAGE_SEC);
}

export function slideshowTotalSec(pages: AlbumPage[], meta: AlbumMeta | null): number {
  return pages.reduce((a, p) => a + pageDuration(p, meta), 0);
}

function dataUrlToArrayBuffer(dataUrl: string): ArrayBuffer {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) buf[i] = bin.charCodeAt(i);
  return buf.buffer;
}

/** Ordered, looping playlist player over the selected library tracks. */
export class SlideshowPlaylist {
  private ctx: AudioContext;
  private gain: GainNode;
  private streamDest: MediaStreamAudioDestinationNode | null = null;
  private buffers: AudioBuffer[] = [];
  private source: AudioBufferSourceNode | null = null;
  private idx = 0;
  private playing = false;

  constructor(private audible = true) {
    this.ctx = new AudioContext();
    this.gain = this.ctx.createGain();
    if (this.audible) this.gain.connect(this.ctx.destination);
  }

  /** Decode all selected tracks (silently skips ones that fail to load). */
  async load(paths: string[]): Promise<number> {
    const out: AudioBuffer[] = [];
    for (const p of paths) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const dataUrl = await window.pebble.readMusicBase64(p);
        // eslint-disable-next-line no-await-in-loop
        out.push(await this.ctx.decodeAudioData(dataUrlToArrayBuffer(dataUrl)));
      } catch { /* unreadable/undecodable track — skip */ }
    }
    this.buffers = out;
    return out.length;
  }

  /** A stream carrying the playlist audio (for the video recorder). */
  stream(): MediaStream {
    if (!this.streamDest) {
      this.streamDest = this.ctx.createMediaStreamDestination();
      this.gain.connect(this.streamDest);
    }
    return this.streamDest.stream;
  }

  get hasTracks(): boolean { return this.buffers.length > 0; }

  /** Resume the context; true when audio can actually run (else skip audio). */
  async ensureRunning(): Promise<boolean> {
    try {
      await Promise.race([this.ctx.resume(), new Promise((r) => setTimeout(r, 1500))]);
    } catch { /* resume rejected */ }
    return this.ctx.state === 'running';
  }

  start(): void {
    if (!this.buffers.length || this.playing) return;
    this.playing = true;
    this.idx = 0;
    this.gain.gain.setValueAtTime(1, this.ctx.currentTime);
    void this.ctx.resume();
    this.playNext();
  }

  private playNext(): void {
    if (!this.playing || !this.buffers.length) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffers[this.idx % this.buffers.length];
    src.connect(this.gain);
    src.onended = () => {
      if (!this.playing) return;
      this.idx += 1; // playlist exhausted → loop back to the first track
      this.playNext();
    };
    this.source = src;
    src.start();
  }

  /** Fade out (default 1s) and stop. Safe to call repeatedly. */
  stop(fadeSec = 1): void {
    if (!this.playing) return;
    this.playing = false;
    const t = this.ctx.currentTime;
    try {
      this.gain.gain.setValueAtTime(this.gain.gain.value, t);
      this.gain.gain.linearRampToValueAtTime(0, t + fadeSec);
      const src = this.source;
      setTimeout(() => { try { src?.stop(); } catch { /* already stopped */ } }, fadeSec * 1000 + 50);
    } catch { try { this.source?.stop(); } catch { /* noop */ } }
  }

  dispose(): void {
    this.stop(0.01);
    setTimeout(() => { void this.ctx.close().catch(() => {}); }, 200);
  }
}

/** The subset of PageTurnScene the recorder drives. */
export interface SceneHandle {
  jumpTo: (i: number) => Promise<void>;
  turnAndWait: (dir: 1 | -1) => Promise<void>;
  canvasEl: () => HTMLCanvasElement | null;
  setExportSize: (w: number, h: number) => void;
  resetSize: () => void;
}

export interface RecordProgress { page: number; total: number; sec: number; totalSec: number }
export interface RecordResult { blob: Blob; ext: 'mp4' | 'webm'; mime: string }

/** Best supported container: real MP4 (H.264/AAC) when Chromium offers it. */
export function pickRecorderMime(): { mime: string; ext: 'mp4' | 'webm' } {
  const candidates: { mime: string; ext: 'mp4' | 'webm' }[] = [
    { mime: 'video/mp4;codecs="avc1.640028,mp4a.40.2"', ext: 'mp4' },
    { mime: 'video/mp4', ext: 'mp4' },
    { mime: 'video/webm;codecs="vp9,opus"', ext: 'webm' },
    { mime: 'video/webm', ext: 'webm' },
  ];
  for (const c of candidates) if (MediaRecorder.isTypeSupported(c.mime)) return c;
  return { mime: '', ext: 'webm' };
}

let cancelFlag = false;
export function cancelRecording(): void { cancelFlag = true; }

/**
 * Record the slideshow start → end in real time at ~1080p, with music.
 * The result is EXACTLY what the play button shows: same transitions, same
 * per-page durations, same playlist (looped if short, faded out at the end).
 */
export async function recordSlideshow(
  scene: SceneHandle, pages: AlbumPage[], meta: AlbumMeta,
  musicPaths: string[], onProgress: (p: RecordProgress) => void,
): Promise<RecordResult | null> {
  cancelFlag = false;
  const aspect = (meta.albumWidth || 3) / (meta.albumHeight || 2);
  const W = 1920;
  const H = Math.round(W / aspect / 2) * 2;
  const totalSec = slideshowTotalSec(pages, meta);

  scene.setExportSize(W, H);
  await scene.jumpTo(0);
  await new Promise((r) => setTimeout(r, 300)); // let the first page settle

  const canvas = scene.canvasEl();
  if (!canvas) { scene.resetSize(); return null; }
  const stream = canvas.captureStream(30);

  const playlist = new SlideshowPlaylist(false); // silent while exporting
  await playlist.load(musicPaths);
  // Only mux audio when the context actually runs — a suspended context feeds
  // MediaRecorder no frames and stalls the whole recording forever.
  const audioOk = playlist.hasTracks && (await playlist.ensureRunning());
  if (audioOk) {
    for (const t of playlist.stream().getAudioTracks()) stream.addTrack(t);
  }

  const { mime, ext } = pickRecorderMime();
  const rec = new MediaRecorder(stream, {
    ...(mime ? { mimeType: mime } : {}),
    videoBitsPerSecond: 12_000_000,
    audioBitsPerSecond: 192_000,
  });
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  const done = new Promise<void>((res) => { rec.onstop = () => res(); });

  rec.start(250);
  playlist.start();

  let played = 0;
  try {
    for (let i = 0; i < pages.length; i += 1) {
      const dur = pageDuration(pages[i], meta);
      onProgress({ page: i + 1, total: pages.length, sec: played, totalSec });
      const t0 = performance.now();
      while (performance.now() - t0 < dur * 1000) {
        if (cancelFlag) throw new Error('cancelled');
        // eslint-disable-next-line no-await-in-loop
        await new Promise((r) => setTimeout(r, 100));
      }
      played += dur;
      if (i < pages.length - 1) {
        // eslint-disable-next-line no-await-in-loop
        await scene.turnAndWait(1);
        if (cancelFlag) throw new Error('cancelled');
      }
    }
    playlist.stop(1.2); // musical fade-out at the very end
    await new Promise((r) => setTimeout(r, 1300));
  } catch {
    playlist.dispose();
    try { rec.stop(); } catch { /* noop */ }
    await done.catch(() => {});
    scene.resetSize();
    return null; // cancelled
  }

  try { rec.requestData(); } catch { /* noop */ }
  rec.stop();
  // Watchdog: never hang on a recorder that won't finalize — the chunks we
  // already collected still form a playable file.
  await Promise.race([done, new Promise((r) => setTimeout(r, 8000))]);
  playlist.dispose();
  scene.resetSize();
  return { blob: new Blob(chunks, { type: rec.mimeType || mime || 'video/webm' }), ext, mime: rec.mimeType };
}
