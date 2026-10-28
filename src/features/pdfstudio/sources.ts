import { PDFDocument } from 'pdf-lib';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import { openPdf, renderPageToCanvas } from '../../lib/converters/pdfjs';
import type { StudioPage } from '../../lib/studio';

const MAX_W = 2400;

/** Registri PDF sumber + cache raster halaman (pdf.js) untuk kanvas editor & thumbnail. */
export class StudioSources {
  readonly bytes = new Map<string, Uint8Array>();
  private docs = new Map<string, PDFDocumentProxy>();
  private cache = new Map<string, Promise<string>>();
  private urls: string[] = [];
  private seq = 0;

  async addPdf(file: File): Promise<{ docId: string; sizes: { w: number; h: number }[] }> {
    const bytes = new Uint8Array(await file.arrayBuffer());
    try {
      await PDFDocument.load(bytes); // gagal untuk PDF terenkripsi/rusak: lebih baik gagal di sini daripada saat ekspor
    } catch {
      throw new Error(`${file.name}: PDF rusak atau terenkripsi (kata sandi) — tidak bisa diedit.`);
    }
    const doc = await openPdf(bytes);
    const docId = `d${++this.seq}`;
    const sizes: { w: number; h: number }[] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const p = await doc.getPage(i);
      const vp = p.getViewport({ scale: 1 });
      sizes.push({ w: vp.width, h: vp.height });
      p.cleanup();
    }
    this.bytes.set(docId, bytes);
    this.docs.set(docId, doc);
    return { docId, sizes };
  }

  /** URL gambar halaman untuk ditampilkan; null = halaman putih polos. */
  async raster(page: StudioPage, width: number): Promise<string | null> {
    if (!page.source) return page.bgDataUrl ?? null;
    const bucket = Math.min(MAX_W, Math.ceil(width / 256) * 256);
    const key = `${page.source.docId}:${page.source.index}:${bucket}`;
    let p = this.cache.get(key);
    if (!p) {
      p = this.render(page.source.docId, page.source.index, bucket);
      this.cache.set(key, p);
      p.catch(() => this.cache.delete(key));
    }
    return p;
  }

  private async render(docId: string, index: number, width: number): Promise<string> {
    const doc = this.docs.get(docId);
    if (!doc) throw new Error('Sumber PDF tidak tersedia.');
    const page = await doc.getPage(index + 1);
    const vp = page.getViewport({ scale: 1 });
    const canvas = await renderPageToCanvas(page, width / vp.width);
    const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Gagal render halaman.'))), 'image/jpeg', 0.9));
    canvas.width = canvas.height = 0;
    page.cleanup();
    const url = URL.createObjectURL(blob);
    this.urls.push(url);
    return url;
  }

  dispose() {
    this.urls.forEach((u) => URL.revokeObjectURL(u));
    this.urls = [];
    this.cache.clear();
    this.docs.forEach((d) => void d.loadingTask.destroy());
    this.docs.clear();
    this.bytes.clear();
  }
}
