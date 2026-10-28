import { PDFDocument, StandardFonts, degrees, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import { sanitizeForFont, wrapText } from './pdfBuild';

/** Semua koordinat dalam poin PDF (1/72 inci), titik asal kiri-atas halaman yang TAMPIL. */
interface Base {
  id: string;
  x: number;
  y: number;
}
export interface TextEl extends Base {
  type: 'text';
  /** lebar kotak teks (batas pemenggalan baris) */
  w: number;
  text: string;
  fontSize: number;
  color: string;
  bold: boolean;
}
export interface StampEl extends Base {
  type: 'stamp';
  text: string;
  fontSize: number;
  color: string;
}
export interface ImageEl extends Base {
  type: 'image' | 'signature';
  w: number;
  h: number;
  dataUrl: string;
}
export interface RectEl extends Base {
  type: 'rect';
  w: number;
  h: number;
  color: string;
  opacity: number;
}
export type StudioElement = TextEl | StampEl | ImageEl | RectEl;

export interface StudioPage {
  id: string;
  /** null = halaman kosong baru */
  source: { docId: string; index: number } | null;
  width: number;
  height: number;
  elements: StudioElement[];
  /** gambar latar (untuk halaman dari gambar atau latar kustom) */
  bgDataUrl?: string;
  watermark: string;
  showWatermark: boolean;
}

export const LINE_HEIGHT = 1.25;
/** posisi baseline dalam baris (× fontSize) — dipakai sama persis oleh pratinjau & ekspor */
export const BASELINE = 0.97;
export const STAMP_PAD = 12;
export const STAMP_BORDER = 2.5;
export const WATERMARK_SIZE = 54;

export interface MetricsFonts {
  regular: PDFFont;
  bold: PDFFont;
}

let metricsPromise: Promise<MetricsFonts> | null = null;
/** Font standar PDF dipakai juga untuk mengukur teks di editor, sehingga pratinjau = hasil ekspor. */
export function getMetricsFonts(): Promise<MetricsFonts> {
  if (!metricsPromise) {
    metricsPromise = (async () => {
      const doc = await PDFDocument.create();
      return { regular: await doc.embedFont(StandardFonts.Helvetica), bold: await doc.embedFont(StandardFonts.HelveticaBold) };
    })();
  }
  return metricsPromise;
}

export function textLayout(el: TextEl, fonts: MetricsFonts) {
  const font = el.bold ? fonts.bold : fonts.regular;
  const lines = wrapText(sanitizeForFont(el.text, font), font, el.fontSize, Math.max(10, el.w));
  const lh = el.fontSize * LINE_HEIGHT;
  return { lines, lh, height: Math.max(1, lines.length) * lh };
}

export function stampLayout(el: StampEl, fonts: MetricsFonts) {
  const text = sanitizeForFont(el.text, fonts.bold);
  const tw = fonts.bold.widthOfTextAtSize(text, el.fontSize);
  const w = tw + STAMP_PAD * 2;
  const h = el.fontSize * 1.75;
  return { text, w, h, baseline: h / 2 + el.fontSize * 0.35 };
}

export function elementBox(el: StudioElement, fonts: MetricsFonts): { w: number; h: number } {
  switch (el.type) {
    case 'text': {
      const l = textLayout(el, fonts);
      return { w: el.w, h: l.height };
    }
    case 'stamp': {
      const l = stampLayout(el, fonts);
      return { w: l.w, h: l.h };
    }
    default:
      return { w: el.w, h: el.h };
  }
}

export function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0;
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

export function dataUrlToBytes(url: string): { bytes: Uint8Array; mime: string } {
  const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
  if (!m) throw new Error('Data gambar tidak valid.');
  const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return { bytes, mime: m[1] };
}

type Mapper = (xd: number, yd: number) => { x: number; y: number };

/** Peta koordinat tampil (kiri-atas, y ke bawah) -> ruang pengguna PDF, memperhitungkan /Rotate dan CropBox. */
function makeMapper(R: number, box: { x0: number; y0: number; w: number; h: number }): Mapper {
  return (xd, yd) => {
    let x: number;
    let y: number;
    switch (R) {
      case 90: x = yd; y = xd; break;
      case 180: x = box.w - xd; y = yd; break;
      case 270: x = box.w - yd; y = box.h - xd; break;
      default: x = xd; y = box.h - yd;
    }
    return { x: x + box.x0, y: y + box.y0 };
  };
}

export async function exportStudioPdf(pages: StudioPage[], sources: Map<string, Uint8Array>, title = 'Dokumen'): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  out.setTitle(title);
  out.setProducer('OmniConvert Pro');
  out.setCreator('OmniConvert Pro');
  out.setModificationDate(new Date());
  const regular = await out.embedFont(StandardFonts.Helvetica);
  const bold = await out.embedFont(StandardFonts.HelveticaBold);
  const fonts: MetricsFonts = { regular, bold };
  const srcDocs = new Map<string, PDFDocument>();
  const imgCache = new Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>>();

  const embed = async (dataUrl: string) => {
    let im = imgCache.get(dataUrl);
    if (!im) {
      const { bytes, mime } = dataUrlToBytes(dataUrl);
      im = mime === 'image/png' ? await out.embedPng(bytes) : await out.embedJpg(bytes);
      imgCache.set(dataUrl, im);
    }
    return im;
  };

  for (const pg of pages) {
    let page: PDFPage;
    let R = 0;
    let box = { x0: 0, y0: 0, w: pg.width, h: pg.height };

    if (pg.source) {
      let sd = srcDocs.get(pg.source.docId);
      if (!sd) {
        const bytes = sources.get(pg.source.docId);
        if (!bytes) throw new Error('Sumber PDF tidak ditemukan.');
        sd = await PDFDocument.load(bytes);
        srcDocs.set(pg.source.docId, sd);
      }
      const [copied] = await out.copyPages(sd, [pg.source.index]);
      page = out.addPage(copied);
      R = ((page.getRotation().angle % 360) + 360) % 360;
      const cb = page.getCropBox();
      box = { x0: cb.x, y0: cb.y, w: cb.width, h: cb.height };
    } else {
      page = out.addPage([pg.width, pg.height]);
    }
    const map = makeMapper(R, box);
    const rot = degrees(R);
    const dispW = R % 180 === 0 ? box.w : box.h;
    const dispH = R % 180 === 0 ? box.h : box.w;

    if (pg.bgDataUrl) {
      const im = await embed(pg.bgDataUrl);
      const p = map(0, dispH);
      page.drawImage(im, { x: p.x, y: p.y, width: dispW, height: dispH, rotate: rot });
    }

    if (pg.showWatermark && pg.watermark.trim()) {
      const text = sanitizeForFont(pg.watermark, bold);
      const tw = bold.widthOfTextAtSize(text, WATERMARK_SIZE);
      const th = (45 * Math.PI) / 180;
      const dir = { x: Math.cos(th), y: -Math.sin(th) };
      const down = { x: Math.sin(th), y: Math.cos(th) };
      const sx = dispW / 2 - (tw / 2) * dir.x + WATERMARK_SIZE * 0.35 * down.x;
      const sy = dispH / 2 - (tw / 2) * dir.y + WATERMARK_SIZE * 0.35 * down.y;
      const p = map(sx, sy);
      page.drawText(text, {
        x: p.x,
        y: p.y,
        size: WATERMARK_SIZE,
        font: bold,
        color: rgb(0.58, 0.64, 0.72),
        opacity: 0.3,
        rotate: degrees(R + 45)
      });
    }

    for (const el of pg.elements) {
      switch (el.type) {
        case 'text': {
          const font = el.bold ? bold : regular;
          const lay = textLayout(el, fonts);
          lay.lines.forEach((ln, i) => {
            if (!ln) return;
            const p = map(el.x, el.y + i * lay.lh + el.fontSize * BASELINE);
            page.drawText(ln, { x: p.x, y: p.y, size: el.fontSize, font, color: hexToRgb(el.color), rotate: rot });
          });
          break;
        }
        case 'stamp': {
          const lay = stampLayout(el, fonts);
          const c = hexToRgb(el.color);
          const bl = map(el.x, el.y + lay.h);
          page.drawRectangle({ x: bl.x, y: bl.y, width: lay.w, height: lay.h, borderColor: c, borderWidth: STAMP_BORDER, rotate: rot });
          const tp = map(el.x + STAMP_PAD, el.y + lay.baseline);
          page.drawText(lay.text, { x: tp.x, y: tp.y, size: el.fontSize, font: bold, color: c, rotate: rot });
          break;
        }
        case 'image':
        case 'signature': {
          const im = await embed(el.dataUrl);
          const p = map(el.x, el.y + el.h);
          page.drawImage(im, { x: p.x, y: p.y, width: el.w, height: el.h, rotate: rot });
          break;
        }
        case 'rect': {
          const p = map(el.x, el.y + el.h);
          page.drawRectangle({ x: p.x, y: p.y, width: el.w, height: el.h, color: hexToRgb(el.color), opacity: el.opacity, rotate: rot });
          break;
        }
      }
    }
  }
  return out.save();
}
