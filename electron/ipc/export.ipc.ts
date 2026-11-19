/**
 * export.ipc.ts
 * -----------------------------------------------------------------------------
 * Receives full-DPI page PNG data URLs from the renderer and writes:
 *   - a multi-page PDF (PDFKit), optionally with bleed marks + page numbers
 *   - a JPEG sequence (Sharp)
 *   - a PNG sequence (Sharp)
 * Progress is streamed back to the renderer over `export:progress`.
 */
import { ipcMain, BrowserWindow } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import PDFDocument from 'pdfkit';
import { createWriteStream } from 'node:fs';
import type { ExportPageData, PDFExportOptions, ImageExportOptions } from '../../src/types/ipc.types';

function dataUrlToBuffer(dataUrl: string): Buffer {
  const comma = dataUrl.indexOf(',');
  return Buffer.from(dataUrl.slice(comma + 1), 'base64');
}

function emit(sender: Electron.WebContents, pct: number, step: string): void {
  sender.send('export:progress', pct, step);
}

function pad(n: number): string { return String(n + 1).padStart(3, '0'); }

export async function exportToPDF(
  sender: Electron.WebContents, pages: ExportPageData[], opts: PDFExportOptions,
): Promise<string> {
  await fs.mkdir(opts.outputDir, { recursive: true });
  const out = path.join(opts.outputDir, `${opts.projectName}.pdf`);
  const doc = new PDFDocument({ autoFirstPage: false });
  const stream = createWriteStream(out);
  doc.pipe(stream);

  pages.forEach((p, i) => {
    doc.addPage({ size: [opts.widthPx, opts.heightPx], margin: 0 });
    doc.image(dataUrlToBuffer(p.dataUrl), 0, 0, { width: opts.widthPx, height: opts.heightPx });
    if (opts.includeBleedMarks) drawBleedMarks(doc, opts.widthPx, opts.heightPx);
    if (opts.includePageNumbers) {
      doc.fontSize(18).fillColor('#888').text(String(i + 1), 0, opts.heightPx - 40, { width: opts.widthPx, align: 'center' });
    }
    emit(sender, 80 + Math.round((i / pages.length) * 19), `Writing page ${i + 1}`);
  });

  doc.end();
  await new Promise<void>((resolve, reject) => { stream.on('finish', () => resolve()); stream.on('error', reject); });
  emit(sender, 100, 'Done');
  return out;
}

function drawBleedMarks(doc: PDFKit.PDFDocument, w: number, h: number): void {
  const len = 24;
  doc.lineWidth(1).strokeColor('#000');
  const corners: [number, number][] = [[0, 0], [w, 0], [0, h], [w, h]];
  for (const [x, y] of corners) {
    doc.moveTo(x, y).lineTo(x + (x === 0 ? len : -len), y).stroke();
    doc.moveTo(x, y).lineTo(x, y + (y === 0 ? len : -len)).stroke();
  }
}

async function exportSequence(
  sender: Electron.WebContents, pages: ExportPageData[], opts: ImageExportOptions,
): Promise<string[]> {
  await fs.mkdir(opts.outputDir, { recursive: true });
  const paths: string[] = [];
  for (let i = 0; i < pages.length; i += 1) {
    const buf = dataUrlToBuffer(pages[i].dataUrl);
    const ext = opts.format === 'jpeg' ? 'jpg' : 'png';
    const out = path.join(opts.outputDir, `${opts.projectName}_page_${pad(pages[i].index)}.${ext}`);
    const pipe = sharp(buf);
    // eslint-disable-next-line no-await-in-loop
    await (opts.format === 'jpeg' ? pipe.jpeg({ quality: opts.quality }) : pipe.png()).toFile(out);
    paths.push(out);
    emit(sender, 80 + Math.round((i / pages.length) * 19), `Writing page ${i + 1}`);
  }
  emit(sender, 100, 'Done');
  return paths;
}

export function registerExportIpc(): void {
  ipcMain.handle('export:pdf', (e, pages: ExportPageData[], opts: PDFExportOptions) =>
    exportToPDF(e.sender, pages, opts));
  ipcMain.handle('export:jpeg', (e, pages: ExportPageData[], opts: ImageExportOptions) =>
    exportSequence(e.sender, pages, { ...opts, format: 'jpeg' }));
  ipcMain.handle('export:png', (e, pages: ExportPageData[], opts: ImageExportOptions) =>
    exportSequence(e.sender, pages, { ...opts, format: 'png' }));
}

// Re-export for the BrowserWindow type used above.
export type { BrowserWindow };
