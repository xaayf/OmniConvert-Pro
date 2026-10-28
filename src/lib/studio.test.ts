import { describe, expect, it } from 'vitest';
import { PDFDocument, degrees } from 'pdf-lib';
import { writeFileSync } from 'node:fs';
import { blocksToPdf, textToBlocks } from './pdfBuild';
import { exportStudioPdf, getMetricsFonts, textLayout, type StudioPage, type TextEl } from './studio';

const PNG_RED = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0)
);
const dataUrl = 'data:image/png;base64,' + Buffer.from(PNG_RED).toString('base64');

async function sample(rotation = 0) {
  const bytes = await blocksToPdf(textToBlocks('Dokumen contoh\nBaris dua\nBaris tiga'), { pageSize: 'A4', orientation: 'portrait', title: 'Contoh' });
  if (!rotation) return bytes;
  const d = await PDFDocument.load(bytes);
  d.getPage(0).setRotation(degrees(rotation));
  return d.save();
}

const page = (w: number, h: number): StudioPage => ({
  id: 'p',
  source: { docId: 'd', index: 0 },
  width: w,
  height: h,
  watermark: 'RAHASIA',
  showWatermark: true,
  elements: [
    { id: 't', type: 'text', x: 60, y: 120, w: 200, text: 'Teks overlay yang cukup panjang supaya terpecah menjadi beberapa baris', fontSize: 14, color: '#dc2626', bold: true },
    { id: 's', type: 'stamp', x: 300, y: 300, text: 'DISETUJUI', fontSize: 16, color: '#059669' },
    { id: 'r', type: 'rect', x: 60, y: 400, w: 120, h: 40, color: '#facc15', opacity: 0.5 },
    { id: 'i', type: 'signature', x: 300, y: 450, w: 100, h: 60, dataUrl }
  ]
});

describe('ekspor PDF Studio', () => {
  for (const rot of [0, 90, 180, 270]) {
    it(`mengekspor overlay di atas PDF asli (rotasi ${rot})`, async () => {
      const src = await sample(rot);
      const landscape = rot % 180 !== 0;
      const out = await exportStudioPdf([page(landscape ? 841.89 : 595.28, landscape ? 595.28 : 841.89)], new Map([['d', src]]));
      const doc = await PDFDocument.load(out);
      expect(doc.getPageCount()).toBe(1);
      expect(doc.getPage(0).getRotation().angle).toBe(rot);
      if (process.env.STUDIO_OUT) writeFileSync(`${process.env.STUDIO_OUT}/studio_r${rot}.pdf`, out);
    });
  }

  it('gabungkan beberapa sumber + halaman kosong + atur ulang', async () => {
    const a = await sample();
    const b = await blocksToPdf(textToBlocks('B'), { pageSize: 'Letter', orientation: 'portrait' });
    const pages: StudioPage[] = [
      { ...page(612, 792), source: { docId: 'b', index: 0 }, elements: [] },
      { id: 'blank', source: null, width: 595.28, height: 841.89, elements: [], watermark: '', showWatermark: false },
      { ...page(595.28, 841.89), source: { docId: 'a', index: 0 }, elements: [] }
    ];
    const out = await exportStudioPdf(pages, new Map([['a', a], ['b', b]]));
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(3);
    expect(Math.round(doc.getPage(0).getWidth())).toBe(612);
  });

  it('teks overlay dipenggal konsisten dengan metrik font', async () => {
    const fonts = await getMetricsFonts();
    const el: TextEl = { id: 'x', type: 'text', x: 0, y: 0, w: 120, text: 'satu dua tiga empat lima enam tujuh', fontSize: 12, color: '#000000', bold: false };
    const l = textLayout(el, fonts);
    expect(l.lines.length).toBeGreaterThanOrEqual(2);
    for (const ln of l.lines) expect(fonts.regular.widthOfTextAtSize(ln, 12)).toBeLessThanOrEqual(120.01);
  });
});
