import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

type PdfjsModule = typeof import('pdfjs-dist');
let pdfjsPromise: Promise<PdfjsModule> | null = null;

/** pdf.js dimuat malas + worker di-bundle (ikut precache PWA => jalan offline). */
export function getPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import('pdfjs-dist').then((m) => {
      m.GlobalWorkerOptions.workerSrc = workerUrl;
      return m;
    });
  }
  return pdfjsPromise;
}

export async function openPdf(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  const pdfjs = await getPdfjs();
  try {
    // .slice(): pdf.js memindahkan buffer ke worker, salinan menjaga data asli tetap utuh.
    return await pdfjs.getDocument({ data: bytes.slice() }).promise;
  } catch (e) {
    const name = (e as { name?: string })?.name;
    if (name === 'PasswordException') throw new Error('PDF terkunci kata sandi. Buka kunci dulu sebelum dikonversi.');
    if (name === 'InvalidPDFException') throw new Error('File PDF rusak atau bukan PDF yang valid.');
    throw e;
  }
}

export async function renderPageToCanvas(page: PDFPageProxy, scale: number): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.floor(viewport.width));
  canvas.height = Math.max(1, Math.floor(viewport.height));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport }).promise;
  return canvas;
}

/** Ekstrak teks per halaman, baris dipisah berdasarkan posisi vertikal. */
export async function extractPageLines(page: PDFPageProxy): Promise<string[]> {
  const tc = await page.getTextContent();
  const lines: string[] = [];
  let cur = '';
  let lastY: number | null = null;
  let lastEnd = 0;
  for (const it of tc.items) {
    if (!('str' in it)) continue;
    const x = it.transform[4];
    const y = it.transform[5];
    if (lastY !== null && Math.abs(y - lastY) > Math.max(2, Math.abs(it.height) * 0.5)) {
      lines.push(cur);
      cur = '';
      lastEnd = 0;
    } else if (cur && x - lastEnd > Math.max(1, Math.abs(it.height) * 0.15) && !cur.endsWith(' ') && !it.str.startsWith(' ')) {
      cur += ' ';
    }
    cur += it.str;
    lastY = y;
    lastEnd = x + it.width;
    if (it.hasEOL) {
      lines.push(cur);
      cur = '';
      lastY = null;
      lastEnd = 0;
    }
  }
  if (cur) lines.push(cur);
  return lines.map((l) => l.replace(/\s+$/, ''));
}

export async function extractPdfText(doc: PDFDocumentProxy, onProgress?: (p: number) => void): Promise<string[][]> {
  const pages: string[][] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    pages.push(await extractPageLines(page));
    page.cleanup();
    onProgress?.(Math.round((i / doc.numPages) * 100));
  }
  return pages;
}

/** Render halaman pertama PDF jadi data URL untuk pratinjau (lintas browser, termasuk iOS). */
export async function renderPdfPreview(blob: Blob, width = 720): Promise<{ url: string; pages: number }> {
  const doc = await openPdf(new Uint8Array(await blob.arrayBuffer()));
  try {
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const canvas = await renderPageToCanvas(page, width / vp.width);
    const url = canvas.toDataURL('image/jpeg', 0.85);
    return { url, pages: doc.numPages };
  } finally {
    void doc.loadingTask.destroy();
  }
}
