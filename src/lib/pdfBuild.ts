import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';

export type PageSizeName = 'A4' | 'Letter' | 'Fit';
export type Orientation = 'auto' | 'portrait' | 'landscape';

export const PAGE_DIMS: Record<'A4' | 'Letter', [number, number]> = {
  A4: [595.28, 841.89],
  Letter: [612, 792]
};

export type BlockKind = 'h1' | 'h2' | 'h3' | 'p' | 'li' | 'pre' | 'hr' | 'br';
export interface Block {
  kind: BlockKind;
  text: string;
  /** penanda daftar, mis. "•" atau "3." */
  marker?: string;
  /** paragraf rapat (tanpa jarak besar), dipakai untuk .txt */
  tight?: boolean;
}

export interface TextPdfOptions {
  title?: string;
  pageSize: 'A4' | 'Letter';
  orientation: 'portrait' | 'landscape';
  margin?: number;
  pageNumbers?: boolean;
}

const charSetCache = new WeakMap<PDFFont, Set<number>>();

/** Ganti karakter yang tidak ada di font standar (WinAnsi) agar pdf-lib tidak melempar error. */
export function sanitizeForFont(text: string, font: PDFFont): string {
  let set = charSetCache.get(font);
  if (!set) {
    set = new Set(font.getCharacterSet());
    charSetCache.set(font, set);
  }
  let out = '';
  for (const ch of text.replace(/\t/g, '    ').replace(/ /g, ' ').replace(/[\r​-‍﻿]/g, '')) {
    const cp = ch.codePointAt(0)!;
    if (set.has(cp)) {
      out += ch;
      continue;
    }
    // Coba buang diakritik (ā -> a), kalau tetap tidak ada pakai '?'
    const base = ch.normalize('NFD').replace(/\p{M}/gu, '');
    out += base && [...base].every((c) => set!.has(c.codePointAt(0)!)) ? base : '?';
  }
  return out;
}

/** Pecah teks jadi baris sesuai lebar maksimum memakai metrik font yang sama dengan hasil PDF. */
export function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const lines: string[] = [];
  for (const para of text.split('\n')) {
    if (para.trim() === '') {
      lines.push('');
      continue;
    }
    let line = '';
    for (const word of para.split(/( +)/)) {
      if (word === '') continue;
      const test = line + word;
      if (font.widthOfTextAtSize(test, size) <= maxWidth || line === '') {
        line = test;
        // kata tunggal lebih panjang dari baris -> potong per karakter
        while (font.widthOfTextAtSize(line, size) > maxWidth && line.length > 1) {
          let cut = line.length - 1;
          while (cut > 1 && font.widthOfTextAtSize(line.slice(0, cut), size) > maxWidth) cut--;
          lines.push(line.slice(0, cut));
          line = line.slice(cut);
        }
      } else {
        lines.push(line.trimEnd());
        line = word.trimStart();
      }
    }
    lines.push(line.trimEnd());
  }
  return lines;
}

function pageDims(size: 'A4' | 'Letter', orientation: 'portrait' | 'landscape'): [number, number] {
  const [w, h] = PAGE_DIMS[size];
  return orientation === 'landscape' ? [h, w] : [w, h];
}

function addPageNumbers(doc: PDFDocument, font: PDFFont) {
  const pages = doc.getPages();
  pages.forEach((p, i) => {
    const label = `${i + 1} / ${pages.length}`;
    const w = font.widthOfTextAtSize(label, 8);
    p.drawText(label, { x: (p.getWidth() - w) / 2, y: 24, size: 8, font, color: rgb(0.55, 0.58, 0.64) });
  });
}

function setMeta(doc: PDFDocument, title?: string) {
  if (title) doc.setTitle(title);
  doc.setProducer('OmniConvert Pro');
  doc.setCreator('OmniConvert Pro');
  doc.setCreationDate(new Date());
}

/** Teks/dokumen terstruktur -> PDF multi-halaman dengan pemenggalan baris & nomor halaman. */
export async function blocksToPdf(blocks: Block[], opts: TextPdfOptions): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  setMeta(doc, opts.title);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const mono = await doc.embedFont(StandardFonts.Courier);

  const [W, H] = pageDims(opts.pageSize, opts.orientation);
  const margin = opts.margin ?? 56;
  const bottom = margin + 8;
  const maxW = W - margin * 2;
  const ink = rgb(0.1, 0.12, 0.18);

  let page: PDFPage = doc.addPage([W, H]);
  let y = H - margin;
  const ensure = (needed: number) => {
    if (y - needed < bottom) {
      page = doc.addPage([W, H]);
      y = H - margin;
    }
  };

  const all: Block[] = opts.title ? [{ kind: 'h1', text: opts.title }, ...blocks] : blocks;

  for (const b of all) {
    if (b.kind === 'br') {
      y -= 8;
      continue;
    }
    if (b.kind === 'hr') {
      ensure(14);
      y -= 6;
      page.drawLine({ start: { x: margin, y }, end: { x: W - margin, y }, thickness: 0.7, color: rgb(0.8, 0.82, 0.86) });
      y -= 8;
      continue;
    }

    const isHeading = b.kind === 'h1' || b.kind === 'h2' || b.kind === 'h3';
    const font = isHeading ? bold : b.kind === 'pre' ? mono : regular;
    const size = b.kind === 'h1' ? 20 : b.kind === 'h2' ? 15.5 : b.kind === 'h3' ? 12.5 : b.kind === 'pre' ? 9 : 10.5;
    const lineH = size * (b.kind === 'pre' ? 1.3 : 1.45);
    const indent = b.kind === 'li' ? 18 : 0;
    const text = sanitizeForFont(b.text, font);
    const lines = wrapText(text, font, size, maxW - indent);

    if (isHeading) {
      y -= b.kind === 'h1' ? 4 : 8; // ruang sebelum judul
      ensure(lineH * 2); // jangan taruh judul sendirian di dasar halaman
    }

    if (b.kind === 'pre') {
      // latar abu-abu untuk blok kode per halaman akan terlalu rumit; cukup font monospace
    }

    lines.forEach((ln, i) => {
      ensure(lineH);
      y -= lineH;
      if (b.kind === 'li' && i === 0 && b.marker) {
        page.drawText(sanitizeForFont(b.marker, regular), { x: margin + 2, y, size, font: regular, color: ink });
      }
      if (ln) page.drawText(ln, { x: margin + indent, y, size, font, color: ink });
    });

    y -= isHeading ? 4 : b.kind === 'li' || b.tight ? 2 : 7;
  }

  if (opts.pageNumbers !== false) addPageNumbers(doc, regular);
  return doc.save();
}

export function textToBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    blocks.push(line.trim() === '' ? { kind: 'br', text: '' } : { kind: 'p', text: line, tight: true });
  }
  return blocks;
}

export interface TableSheet {
  name: string;
  rows: string[][];
}

const NUM_RE = /^-?[\d.,]+%?$/;

/** Tabel -> PDF dengan header berulang di tiap halaman dan lebar kolom otomatis. */
export async function tablesToPdf(
  sheets: TableSheet[],
  opts: { title?: string; pageSize: 'A4' | 'Letter'; orientation: 'auto' | 'portrait' | 'landscape' }
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  setMeta(doc, opts.title);
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const margin = 36;
  const size = 8.5;
  const rowH = 16;
  const pad = 4;

  for (const sheet of sheets) {
    const rows = sheet.rows.map((r) => r.map((c) => sanitizeForFont(String(c ?? ''), regular)));
    const colCount = Math.max(1, ...rows.map((r) => r.length));

    // lebar alami tiap kolom dari 300 baris pertama
    const natural = Array.from({ length: colCount }, (_, c) => {
      let w = 0;
      for (let r = 0; r < Math.min(rows.length, 300); r++) {
        const f = r === 0 ? bold : regular;
        w = Math.max(w, f.widthOfTextAtSize(rows[r][c] ?? '', size));
      }
      return Math.min(Math.max(w + pad * 2, 36), 280);
    });
    const naturalSum = natural.reduce((a, b) => a + b, 0);

    const landscape =
      opts.orientation === 'landscape' || (opts.orientation === 'auto' && (colCount > 5 || naturalSum > PAGE_DIMS[opts.pageSize][0] - margin * 2));
    const [W, H] = pageDims(opts.pageSize, landscape ? 'landscape' : 'portrait');
    const avail = W - margin * 2;
    const scale = naturalSum > avail ? avail / naturalSum : 1;
    const widths = natural.map((w) => Math.max(24, w * scale));

    let page = doc.addPage([W, H]);
    let y = H - margin;
    const title = sanitizeForFont(sheet.name || opts.title || 'Tabel', bold);
    page.drawText(title, { x: margin, y: y - 14, size: 14, font: bold, color: rgb(0.1, 0.12, 0.18) });
    y -= 30;

    const drawRow = (cells: string[], r: number, isHeader: boolean) => {
      let x = margin;
      if (isHeader) {
        page.drawRectangle({ x: margin, y: y - rowH, width: widths.reduce((a, b) => a + b, 0), height: rowH, color: rgb(0.9, 0.92, 0.98) });
      } else if (r % 2 === 0) {
        page.drawRectangle({ x: margin, y: y - rowH, width: widths.reduce((a, b) => a + b, 0), height: rowH, color: rgb(0.97, 0.975, 0.985) });
      }
      for (let c = 0; c < colCount; c++) {
        const f = isHeader ? bold : regular;
        let t = cells[c] ?? '';
        const maxW = widths[c] - pad * 2;
        if (f.widthOfTextAtSize(t, size) > maxW) {
          while (t.length > 1 && f.widthOfTextAtSize(t + '…', size) > maxW) t = t.slice(0, -1);
          t += t.length ? '…' : '';
          // '…' ada di WinAnsi; jika tidak, sanitize sudah menangani saat tampil
          t = sanitizeForFont(t, f);
        }
        const tw = f.widthOfTextAtSize(t, size);
        const right = !isHeader && NUM_RE.test(t.trim()) && t.trim() !== '';
        page.drawText(t, { x: right ? x + widths[c] - pad - tw : x + pad, y: y - rowH + 5, size, font: f, color: rgb(0.12, 0.14, 0.2) });
        x += widths[c];
      }
      y -= rowH;
    };

    rows.forEach((cells, r) => {
      if (y - rowH < margin) {
        page = doc.addPage([W, H]);
        y = H - margin;
        if (r > 0 && rows[0]) drawRow(rows[0], -1, true); // header berulang
      }
      drawRow(cells, r, r === 0);
    });
  }

  addPageNumbers(doc, regular);
  return doc.save();
}

export interface ImagePage {
  bytes: Uint8Array;
  mime: 'jpeg' | 'png';
  width: number;
  height: number;
  /** jika diisi, halaman dibuat persis seukuran ini (poin PDF) dan gambar memenuhi halaman */
  ptWidth?: number;
  ptHeight?: number;
}

/** Gambar -> PDF: satu gambar per halaman, benar-benar tertanam (bukan hanya metadata). */
export async function imagesToPdf(
  images: ImagePage[],
  opts: { pageSize: PageSizeName; orientation: Orientation; margin?: number; title?: string }
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  setMeta(doc, opts.title);

  for (const im of images) {
    const emb = im.mime === 'png' ? await doc.embedPng(im.bytes) : await doc.embedJpg(im.bytes);
    if (im.ptWidth && im.ptHeight) {
      const p = doc.addPage([im.ptWidth, im.ptHeight]);
      p.drawImage(emb, { x: 0, y: 0, width: im.ptWidth, height: im.ptHeight });
      continue;
    }
    if (opts.pageSize === 'Fit') {
      const w = Math.min(14400, im.width * 0.75);
      const h = Math.min(14400, im.height * 0.75);
      const p = doc.addPage([w, h]);
      p.drawImage(emb, { x: 0, y: 0, width: w, height: h });
      continue;
    }
    const orient =
      opts.orientation === 'auto' ? (im.width > im.height ? 'landscape' : 'portrait') : opts.orientation;
    const [W, H] = pageDims(opts.pageSize, orient);
    const m = opts.margin ?? 24;
    const ratio = Math.min((W - m * 2) / im.width, (H - m * 2) / im.height);
    const dw = im.width * ratio;
    const dh = im.height * ratio;
    const p = doc.addPage([W, H]);
    p.drawImage(emb, { x: (W - dw) / 2, y: (H - dh) / 2, width: dw, height: dh });
  }
  return doc.save();
}
