import { PDFDocument } from 'pdf-lib';

/** "1-3, 5, 8-" → [[0,1,2],[4],[7..n-1]] (indeks 0-based). Melempar Error berbahasa Indonesia bila tidak valid. */
export function parseRanges(input: string, total: number): number[][] {
  const out: number[][] = [];
  for (const raw of input.split(/[,;\s]+/).filter(Boolean)) {
    const m = /^(\d*)(?:-(\d*))?$/.exec(raw);
    if (!m || (m[1] === '' && !m[2])) throw new Error(`Rentang "${raw}" tidak valid. Contoh: 1-3, 5, 8-`);
    const a = m[1] === '' ? 1 : Number(m[1]);
    const dash = raw.includes('-');
    const b = dash ? (m[2] ? Number(m[2]) : total) : a;
    if (a < 1 || b < 1 || a > total || b > total) throw new Error(`Halaman "${raw}" di luar jangkauan (1–${total}).`);
    if (a > b) throw new Error(`Rentang "${raw}" terbalik.`);
    out.push(Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i));
  }
  return out;
}

export async function loadPdf(bytes: Uint8Array, label = 'PDF'): Promise<PDFDocument> {
  try {
    return await PDFDocument.load(bytes);
  } catch {
    throw new Error(`${label}: PDF rusak atau terenkripsi (kata sandi).`);
  }
}

function finish(doc: PDFDocument, title?: string) {
  if (title) doc.setTitle(title);
  doc.setProducer('OmniConvert Pro');
  doc.setCreator('OmniConvert Pro');
  doc.setModificationDate(new Date());
  return doc.save();
}

export type MergePart =
  | { kind: 'pdf'; name: string; bytes: Uint8Array }
  | { kind: 'image'; name: string; bytes: Uint8Array; mime: 'jpeg' | 'png'; width: number; height: number };

const A4 = { w: 595.28, h: 841.89 };

/** Gabungkan PDF dan gambar (urut sesuai daftar) menjadi satu PDF. Rotasi & ukuran halaman asli dipertahankan. */
export async function mergeParts(parts: MergePart[], title = 'Gabungan'): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  for (const p of parts) {
    if (p.kind === 'pdf') {
      const src = await loadPdf(p.bytes, p.name);
      const pages = await out.copyPages(src, src.getPageIndices());
      pages.forEach((pg) => out.addPage(pg));
    } else {
      const im = p.mime === 'png' ? await out.embedPng(p.bytes) : await out.embedJpg(p.bytes);
      const k = Math.min(1, A4.w / p.width, A4.h / p.height) || 1;
      // sisi dibatasi A4 tetapi proporsi gambar dipertahankan, tanpa margin kosong
      const w = p.width * k;
      const h = p.height * k;
      out.addPage([w, h]).drawImage(im, { x: 0, y: 0, width: w, height: h });
    }
  }
  return finish(out, title);
}

/** Ambil halaman (0-based, urut sesuai array) menjadi PDF baru. */
export async function extractPages(bytes: Uint8Array, indices: number[], title?: string): Promise<Uint8Array> {
  const src = await loadPdf(bytes);
  const out = await PDFDocument.create();
  const pages = await out.copyPages(src, indices);
  pages.forEach((pg) => out.addPage(pg));
  return finish(out, title);
}

export function invertSelection(total: number, selected: Set<number>): number[] {
  return Array.from({ length: total }, (_, i) => i).filter((i) => !selected.has(i));
}
