import * as mammoth from 'mammoth';
import { baseName, getExt } from '../formats';
import { blobToBytes, bytesToBlob, zipEntries } from '../download';
import { blocksToPdf, imagesToPdf, tablesToPdf, textToBlocks, type Block } from '../pdfBuild';
import { blocksToHtml, blocksToText, escapeHtml, htmlToBlocks, mdToBlocks, reflowLines, wrapHtmlDoc } from '../textfmt';
import {
  cellToString,
  parseCsv,
  parseJson,
  parseXlsx,
  sheetsToHtml,
  sheetsToJson,
  sheetsToMarkdown,
  sheetsToXlsx,
  sheetsToXml,
  sheetToCsv,
  type Sheet
} from '../tabular';
import { blocksToDocx, htmlToMarkdown } from './office';
import { canvasToBlob, grayscaleCanvas } from './image';
import { extractPdfText, openPdf, renderPageToCanvas } from './pdfjs';
import type { ConvertResult, ConvertSettings, ProgressFn } from './types';

void imagesToPdf; // diekspor untuk modul lain; hindari peringatan tree-shaking

const PREVIEW_LIMIT = 6000;
const preview = (s: string) => (s.length > PREVIEW_LIMIT ? s.slice(0, PREVIEW_LIMIT) + '\n…' : s);
const MAX_RENDER_PIXELS = 16_000_000;
const pdfSize = (s: ConvertSettings): 'A4' | 'Letter' => (s.pageSize === 'Letter' ? 'Letter' : 'A4');
const pdfOrient = (s: ConvertSettings): 'portrait' | 'landscape' => (s.orientation === 'landscape' ? 'landscape' : 'portrait');

function textResult(text: string, mime: string, fileName: string, note?: string): ConvertResult {
  return { blob: new Blob([text], { type: `${mime};charset=utf-8` }), fileName, previewText: preview(text), note };
}

// ───────────────────────────── PDF ─────────────────────────────
export async function convertPdf(file: File, target: string, s: ConvertSettings, onProgress?: ProgressFn): Promise<ConvertResult> {
  const name = baseName(file.name);
  const doc = await openPdf(new Uint8Array(await file.arrayBuffer()));
  try {
    if (target === 'PNG' || target === 'JPG') {
      const mime = target === 'PNG' ? 'image/png' : 'image/jpeg';
      const ext = target.toLowerCase();
      const entries: { name: string; data: Uint8Array }[] = [];
      const digits = String(doc.numPages).length;
      let note: string | undefined;
      for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const vp = page.getViewport({ scale: 1 });
        let scale = 2 * (s.scale / 100); // 100% ≈ 144 DPI
        if (vp.width * vp.height * scale * scale > MAX_RENDER_PIXELS) {
          scale = Math.sqrt(MAX_RENDER_PIXELS / (vp.width * vp.height));
          note = 'Resolusi halaman dibatasi ±16 MP agar aman di perangkat mobile.';
        }
        const canvas = await renderPageToCanvas(page, scale);
        if (s.grayscale) grayscaleCanvas(canvas);
        const blob = await canvasToBlob(canvas, mime, s.quality / 100);
        entries.push({ name: `${name}_${String(i).padStart(digits, '0')}.${ext}`, data: await blobToBytes(blob) });
        canvas.width = canvas.height = 0; // lepas memori canvas (penting di iOS)
        page.cleanup();
        onProgress?.(Math.round((i / doc.numPages) * 100));
      }
      if (entries.length === 1) return { blob: bytesToBlob(entries[0].data, mime), fileName: entries[0].name, note };
      return { blob: zipEntries(entries), fileName: `${name}_${ext}.zip`, note: `${entries.length} halaman dikemas dalam ZIP.${note ? ' ' + note : ''}` };
    }

    const pages = await extractPdfText(doc, onProgress);
    if (!pages.some((p) => p.some((l) => l.trim()))) {
      throw new Error('PDF ini tidak berisi teks yang bisa dibaca (kemungkinan hasil scan). Konversi ke PNG/JPG, atau gunakan OCR.');
    }
    const note = 'Hanya teks yang diekstrak; tata letak, tabel, dan gambar tidak dipertahankan.';

    switch (target) {
      case 'TXT':
        return textResult(pages.map((p) => p.join('\n')).join('\n\n'), 'text/plain', `${name}.txt`, note);
      case 'MD': {
        const md = pages.map((p) => reflowLines(p).join('\n\n')).join('\n\n---\n\n') + '\n';
        return textResult(md, 'text/markdown', `${name}.md`, note);
      }
      case 'HTML': {
        const blocks: Block[] = [];
        pages.forEach((p, i) => {
          if (i > 0) blocks.push({ kind: 'hr', text: '' });
          reflowLines(p).forEach((t) => blocks.push({ kind: 'p', text: t }));
        });
        return textResult(blocksToHtml(blocks, name), 'text/html', `${name}.html`, note);
      }
      case 'DOCX': {
        const sections = pages.map((p) => reflowLines(p).map<Block>((t) => ({ kind: 'p', text: t })));
        return { blob: await blocksToDocx(sections, name), fileName: `${name}.docx`, note };
      }
      default:
        throw new Error(`Target ${target} tidak didukung untuk PDF.`);
    }
  } finally {
    void doc.loadingTask.destroy();
  }
}

// ───────────────────────────── DOCX ─────────────────────────────
export async function convertDocx(file: File, target: string, s: ConvertSettings): Promise<ConvertResult> {
  const name = baseName(file.name);
  const arrayBuffer = await file.arrayBuffer();

  if (target === 'TXT') {
    const { value } = await mammoth.extractRawText({ arrayBuffer });
    return textResult(value.trim() + '\n', 'text/plain', `${name}.txt`);
  }
  const { value: html } = await mammoth.convertToHtml({ arrayBuffer });
  switch (target) {
    case 'HTML':
      return textResult(wrapHtmlDoc(name, html), 'text/html', `${name}.html`);
    case 'MD':
      return textResult(htmlToMarkdown(html), 'text/markdown', `${name}.md`, 'Gambar diganti penanda teks.');
    case 'PDF': {
      const blocks = htmlToBlocks(html);
      if (!blocks.length) throw new Error('Dokumen kosong atau tidak ada teks yang bisa dibaca.');
      const bytes = await blocksToPdf(blocks, { title: undefined, pageSize: pdfSize(s), orientation: pdfOrient(s) });
      return {
        blob: bytesToBlob(bytes, 'application/pdf'),
        fileName: `${name}.pdf`,
        note: 'Tata letak disederhanakan: gaya teks, tabel visual, dan gambar tidak dibawa. Untuk hasil identik 100% butuh mesin Office/LibreOffice di server.'
      };
    }
    default:
      throw new Error(`Target ${target} tidak didukung untuk DOCX.`);
  }
}

// ───────────────────────────── TXT / MD / HTML / XML ─────────────────────────────
export async function convertText(file: File, target: string, s: ConvertSettings): Promise<ConvertResult> {
  const ext = getExt(file.name);
  const name = baseName(file.name);
  const text = (await file.text()).replace(/^﻿/, '');

  const blocks: Block[] =
    ext === 'md' ? mdToBlocks(text) : ext === 'html' || ext === 'htm' ? htmlToBlocks(text) : ext === 'xml' ? [{ kind: 'pre', text }] : textToBlocks(text);

  switch (target) {
    case 'PDF': {
      const bytes = await blocksToPdf(blocks, { title: undefined, pageSize: pdfSize(s), orientation: pdfOrient(s) });
      return {
        blob: bytesToBlob(bytes, 'application/pdf'),
        fileName: `${name}.pdf`,
        note: 'Font standar PDF: huruf Latin didukung; emoji/aksara non-Latin diganti "?".'
      };
    }
    case 'DOCX':
      return { blob: await blocksToDocx([blocks], name), fileName: `${name}.docx` };
    case 'TXT':
      return textResult(ext === 'xml' ? text : blocksToText(blocks), 'text/plain', `${name}.txt`);
    case 'MD':
      if (ext === 'html' || ext === 'htm') return textResult(htmlToMarkdown(text), 'text/markdown', `${name}.md`);
      return textResult(text, 'text/markdown', `${name}.md`);
    case 'HTML':
      if (ext === 'md') return textResult(blocksToHtml(mdToBlocks(text, true), name, true), 'text/html', `${name}.html`);
      return textResult(blocksToHtml(blocks, name), 'text/html', `${name}.html`);
    default:
      throw new Error(`Target ${target} tidak didukung untuk .${ext}.`);
  }
}

// ───────────────────────────── CSV / XLSX / JSON ─────────────────────────────
export async function readSheets(file: File): Promise<Sheet[]> {
  const ext = getExt(file.name);
  if (ext === 'xlsx') return parseXlsx(await file.arrayBuffer());
  const text = (await file.text()).replace(/^﻿/, '');
  if (ext === 'json') {
    try {
      return parseJson(text);
    } catch (e) {
      throw new Error(`JSON tidak valid: ${(e as Error).message}`);
    }
  }
  return parseCsv(text, ext === 'tsv' ? '\t' : undefined);
}

const PDF_ROW_LIMIT = 5000;

export async function convertData(file: File, target: string, s: ConvertSettings): Promise<ConvertResult> {
  const name = baseName(file.name);
  const sheets = await readSheets(file);
  if (!sheets.some((sh) => sh.rows.length)) throw new Error('File tidak berisi data.');

  switch (target) {
    case 'XLSX':
      return { blob: await sheetsToXlsx(sheets), fileName: `${name}.xlsx`, note: 'Angka dikenali otomatis; ID dengan nol di depan tetap berupa teks.' };
    case 'CSV': {
      if (sheets.length === 1) return textResult(sheetToCsv(sheets[0]), 'text/csv', `${name}.csv`);
      const enc = new TextEncoder();
      const blob = zipEntries(sheets.map((sh) => ({ name: `${name}_${sh.name.replace(/[^\w.-]+/g, '_')}.csv`, data: enc.encode(sheetToCsv(sh)) })), 6);
      return { blob, fileName: `${name}_csv.zip`, note: `${sheets.length} sheet → ${sheets.length} file CSV dalam ZIP.` };
    }
    case 'JSON':
      return textResult(sheetsToJson(sheets), 'application/json', `${name}.json`, 'Baris pertama dipakai sebagai nama kolom.');
    case 'HTML':
      return textResult(sheetsToHtml(sheets, name), 'text/html', `${name}.html`);
    case 'MD':
      return textResult(sheetsToMarkdown(sheets), 'text/markdown', `${name}.md`);
    case 'XML':
      return textResult(sheetsToXml(sheets), 'application/xml', `${name}.xml`);
    case 'PDF': {
      let truncated = false;
      const tables = sheets.map((sh) => {
        let rows = sh.rows.map((r) => r.map(cellToString));
        if (rows.length > PDF_ROW_LIMIT) {
          rows = rows.slice(0, PDF_ROW_LIMIT);
          truncated = true;
        }
        return { name: sh.name, rows };
      });
      const bytes = await tablesToPdf(tables, { title: name, pageSize: pdfSize(s), orientation: s.orientation });
      return {
        blob: bytesToBlob(bytes, 'application/pdf'),
        fileName: `${name}.pdf`,
        note: truncated ? `Tabel dipotong ${PDF_ROW_LIMIT} baris pertama per sheet agar PDF tetap ringan.` : undefined
      };
    }
    default:
      throw new Error(`Target ${target} tidak didukung untuk data tabel.`);
  }
}

export { escapeHtml };
