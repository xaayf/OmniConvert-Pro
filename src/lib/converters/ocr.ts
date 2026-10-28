import type { PDFDocumentProxy } from 'pdfjs-dist';
import { renderPageToCanvas } from './pdfjs';

export const OCR_LANGS = ['ind', 'eng'];
const MAX_SIDE = 2600;

type Worker = import('tesseract.js').Worker;

async function createOcrWorker(onStatus?: (p: number) => void): Promise<Worker> {
  const { createWorker } = await import('tesseract.js');
  const base = `${location.origin}/ocr`;
  return createWorker(OCR_LANGS, 1, {
    workerPath: `${base}/worker.min.js`,
    corePath: base,
    langPath: base,
    cacheMethod: 'none', // service worker sudah menyimpan aset ini
    workerBlobURL: false,
    logger: (m) => {
      if (m.status === 'recognizing text') onStatus?.(m.progress);
    }
  });
}

const toLines = (text: string) => text.replace(/\r/g, '').split('\n').map((l) => l.replace(/\s+$/g, ''));

/** OCR gambar tunggal (canvas). Mengembalikan baris teks. */
export async function ocrCanvases(canvases: AsyncIterable<HTMLCanvasElement> | Iterable<HTMLCanvasElement>, total: number, onProgress?: (pct: number) => void): Promise<string[][]> {
  onProgress?.(1);
  const worker = await createOcrWorker();
  const pages: string[][] = [];
  try {
    let i = 0;
    for await (const c of canvases) {
      const { data } = await worker.recognize(c);
      pages.push(toLines(data.text));
      c.width = c.height = 0;
      i++;
      onProgress?.(Math.min(99, Math.round((i / total) * 100)));
    }
  } finally {
    await worker.terminate();
  }
  return pages;
}

export function ocrPdfPages(doc: PDFDocumentProxy, onProgress?: (pct: number) => void): Promise<string[][]> {
  async function* gen() {
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const vp = page.getViewport({ scale: 1 });
      const scale = Math.min(3, MAX_SIDE / Math.max(vp.width, vp.height));
      const canvas = await renderPageToCanvas(page, scale);
      page.cleanup();
      yield canvas;
    }
  }
  return ocrCanvases(gen(), doc.numPages, onProgress);
}

/** Skala gambar ke sisi terpanjang MAX_SIDE agar OCR cepat dan hemat memori. */
export function imageToOcrCanvas(img: HTMLImageElement, w: number, h: number): HTMLCanvasElement {
  const k = Math.min(1, MAX_SIDE / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}
