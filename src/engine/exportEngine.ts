/**
 * exportEngine.ts
 * -----------------------------------------------------------------------------
 * Renderer-side export orchestration. Each page is rendered to a full-DPI PNG
 * data URL (via a render callback supplied by the canvas layer) and then handed
 * to the main process over IPC for PDF / JPEG / PNG output.
 *
 * The actual Fabric.js → dataURL rendering lives in the canvas component; this
 * module is the glue + validation layer so it stays testable.
 */
import type { PebbleProject, AlbumPage } from '@shared/pebble.types';
import type { ExportPageData, PDFExportOptions, ImageExportOptions } from '@shared/ipc.types';

export type ExportFormat = 'pdf' | 'jpeg' | 'png';

export interface ExportRequest {
  format: ExportFormat;
  quality: number;        // 1..100 (jpeg)
  dpiOverride?: number;
  includeBleedMarks: boolean;
  includePageNumbers: boolean;
  range: 'all' | 'current' | 'custom';
  rangeStart?: number;    // 1-based inclusive
  rangeEnd?: number;
  outputDir: string;
  openAfter: boolean;
}

/** A function the canvas layer provides: render page index → full-DPI PNG. */
export type PageRenderer = (page: AlbumPage, dpi: number) => Promise<string>;

/** Resolve which page indices to export based on the request. */
export function resolveRange(req: ExportRequest, total: number, currentIndex: number): number[] {
  if (req.range === 'current') return [currentIndex];
  if (req.range === 'custom') {
    const s = Math.max(1, req.rangeStart ?? 1) - 1;
    const e = Math.min(total, req.rangeEnd ?? total);
    const out: number[] = [];
    for (let i = s; i < e; i += 1) out.push(i);
    return out;
  }
  return Array.from({ length: total }, (_, i) => i);
}

export interface PrintWarning { page: number; kind: string; message: string }

/**
 * Pre-export print checklist. Flags low-resolution images (below ~150 effective
 * DPI at print size) and missing source images.
 */
export function runPrintChecklist(
  project: PebbleProject,
  records: { filename: string; width: number; height: number; missing?: boolean }[],
): PrintWarning[] {
  const warns: PrintWarning[] = [];
  const byName = new Map(records.map((r) => [r.filename, r]));
  const targetDpi = project.meta.dpi;
  project.pages.forEach((page, pi) => {
    page.images.forEach((img) => {
      const rec = byName.get(img.filename);
      if (!rec || rec.missing) {
        warns.push({ page: pi + 1, kind: 'missing', message: `Missing source image: ${img.filename}` });
        return;
      }
      // Effective DPI = source pixels / printed inches.
      const printedInchesW = img.position.width / targetDpi;
      const effDpi = printedInchesW > 0 ? rec.width / printedInchesW : targetDpi;
      if (effDpi < 150) {
        warns.push({ page: pi + 1, kind: 'lowres', message: `${img.filename} ~${Math.round(effDpi)} DPI (below 150).` });
      }
    });
  });
  return warns;
}

/**
 * Drive the export. Renders each page to a data URL, then dispatches to the
 * appropriate IPC channel.
 * @returns the output path(s) reported by the main process.
 */
export async function runExport(
  project: PebbleProject,
  req: ExportRequest,
  currentIndex: number,
  renderPage: PageRenderer,
  onProgress?: (pct: number, step: string) => void,
): Promise<string | string[]> {
  const dpi = req.dpiOverride ?? project.meta.dpi;
  const indices = resolveRange(req, project.pages.length, currentIndex);

  const pageData: ExportPageData[] = [];
  for (let i = 0; i < indices.length; i += 1) {
    const page = project.pages[indices[i]];
    onProgress?.(Math.round((i / indices.length) * 70), `Rendering page ${i + 1}/${indices.length}`);
    // eslint-disable-next-line no-await-in-loop
    const dataUrl = await renderPage(page, dpi);
    pageData.push({ index: indices[i], dataUrl });
  }

  onProgress?.(80, 'Writing output');
  const name = project.meta.name || 'PebbleAlbum';

  if (req.format === 'pdf') {
    const opts: PDFExportOptions = {
      outputDir: req.outputDir, projectName: name, dpi,
      includeBleedMarks: req.includeBleedMarks, includePageNumbers: req.includePageNumbers,
      widthPx: project.meta.albumWidth, heightPx: project.meta.albumHeight,
    };
    const path = await window.pebble.exportToPDF(pageData, opts);
    onProgress?.(100, 'Done');
    return path;
  }

  const opts: ImageExportOptions = {
    outputDir: req.outputDir, projectName: name,
    quality: req.quality, format: req.format,
  };
  const paths = req.format === 'jpeg'
    ? await window.pebble.exportToJPEG(pageData, opts)
    : await window.pebble.exportToPNG(pageData, opts);
  onProgress?.(100, 'Done');
  return paths;
}
