import Papa from 'papaparse';
import { escapeHtml, wrapHtmlDoc } from './textfmt';

export type Cell = string | number | boolean | Date | null;
export interface Sheet {
  name: string;
  rows: Cell[][];
}

export function cellToString(c: Cell): string {
  if (c === null || c === undefined) return '';
  if (c instanceof Date) {
    if (Number.isNaN(c.getTime())) return '';
    const iso = c.toISOString();
    return iso.endsWith('T00:00:00.000Z') ? iso.slice(0, 10) : iso.replace('.000Z', 'Z');
  }
  if (typeof c === 'boolean') return c ? 'TRUE' : 'FALSE';
  return String(c);
}

/** Ubah teks CSV jadi angka hanya bila aman (tidak merusak ID bernol di depan, no. HP, dsb). */
export function inferCell(s: string): Cell {
  const t = s.trim();
  if (t === '') return '';
  if (/^-?(0|[1-9]\d{0,14})(\.\d+)?$/.test(t)) return Number(t);
  return s;
}

function finishRows(rows: Cell[][]): Cell[][] {
  // buang baris kosong di akhir dan kolom kosong di akhir
  let end = rows.length;
  while (end > 0 && rows[end - 1].every((c) => cellToString(c) === '')) end--;
  const trimmed = rows.slice(0, end);
  let cols = 0;
  for (const r of trimmed) {
    for (let i = r.length - 1; i >= 0; i--) {
      if (cellToString(r[i]) !== '') {
        cols = Math.max(cols, i + 1);
        break;
      }
    }
  }
  return trimmed.map((r) => {
    const out = r.slice(0, cols);
    while (out.length < cols) out.push('');
    return out;
  });
}

export function parseCsv(text: string, delimiter?: string): Sheet[] {
  const res = Papa.parse<string[]>(text, { delimiter: delimiter ?? '', skipEmptyLines: 'greedy' });
  const rows = res.data.map((r) => r.map((c) => inferCell(c)));
  return [{ name: 'Sheet1', rows: finishRows(rows) }];
}

function jsonScalar(v: unknown): Cell {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return JSON.stringify(v);
}

export function parseJson(text: string): Sheet[] {
  const data: unknown = JSON.parse(text);
  const toSheet = (name: string, v: unknown): Sheet => {
    if (Array.isArray(v)) {
      if (v.length && v.every((x) => x && typeof x === 'object' && !Array.isArray(x))) {
        const headers: string[] = [];
        for (const o of v as Record<string, unknown>[]) for (const k of Object.keys(o)) if (!headers.includes(k)) headers.push(k);
        return { name, rows: [headers, ...(v as Record<string, unknown>[]).map((o) => headers.map((h) => jsonScalar(o[h])))] };
      }
      if (v.length && v.every((x) => Array.isArray(x))) return { name, rows: (v as unknown[][]).map((r) => r.map(jsonScalar)) };
      return { name, rows: [['value'], ...v.map((x) => [jsonScalar(x)])] };
    }
    if (v && typeof v === 'object') {
      const o = v as Record<string, unknown>;
      return { name, rows: [Object.keys(o), Object.values(o).map(jsonScalar)] };
    }
    return { name, rows: [['value'], [jsonScalar(v)]] };
  };

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const entries = Object.entries(data as Record<string, unknown>);
    if (entries.length > 0 && entries.every(([, v]) => Array.isArray(v))) {
      return entries.map(([k, v]) => toSheet(k.slice(0, 31) || 'Sheet', v));
    }
  }
  return [toSheet('Sheet1', data)];
}

type ExcelModule = typeof import('exceljs');

function excelValue(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('result' in o) return excelValue(o.result);
    if (Array.isArray(o.richText)) return (o.richText as { text: string }[]).map((r) => r.text).join('');
    if ('text' in o && o.text !== undefined) return String(o.text);
    if ('error' in o) return String(o.error);
    return JSON.stringify(v);
  }
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  return String(v);
}

export async function parseXlsx(buffer: ArrayBuffer): Promise<Sheet[]> {
  const ExcelJS = ((await import('exceljs')) as unknown as { default: ExcelModule }).default;
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheets: Sheet[] = [];
  wb.eachSheet((ws) => {
    const rows: Cell[][] = [];
    const cols = ws.columnCount;
    ws.eachRow({ includeEmpty: true }, (row) => {
      const arr: Cell[] = [];
      for (let c = 1; c <= cols; c++) arr.push(excelValue(row.getCell(c).value));
      rows.push(arr);
    });
    sheets.push({ name: ws.name, rows: finishRows(rows) });
  });
  if (!sheets.length) throw new Error('Workbook tidak berisi sheet.');
  return sheets;
}

export async function sheetsToXlsx(sheets: Sheet[]): Promise<Blob> {
  const ExcelJS = ((await import('exceljs')) as unknown as { default: ExcelModule }).default;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'OmniConvert Pro';
  wb.created = new Date();
  const used = new Set<string>();

  for (const s of sheets) {
    let name = (s.name || 'Sheet').replace(/[\\/?*[\]:]/g, '_').slice(0, 31) || 'Sheet';
    let n = 2;
    while (used.has(name.toLowerCase())) name = `${name.slice(0, 28)}_${n++}`;
    used.add(name.toLowerCase());

    const ws = wb.addWorksheet(name);
    for (const r of s.rows) ws.addRow(r.map((c) => (c === '' ? null : c)));

    const hasHeader = s.rows.length > 1 && s.rows[0].every((c) => typeof c === 'string' && c !== '');
    if (hasHeader) {
      const head = ws.getRow(1);
      head.font = { bold: true, color: { argb: 'FF1E1B4B' } };
      head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE0E7FF' } };
      head.alignment = { vertical: 'middle' };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: Math.max(1, s.rows[0].length) } };
    }
    const colCount = Math.max(0, ...s.rows.map((r) => r.length));
    for (let c = 0; c < colCount; c++) {
      let w = 8;
      for (const r of s.rows.slice(0, 500)) w = Math.max(w, cellToString(r[c] ?? '').length + 2);
      ws.getColumn(c + 1).width = Math.min(w, 60);
    }
  }
  const buf = await wb.xlsx.writeBuffer();
  return new Blob([buf as ArrayBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function sheetToCsv(sheet: Sheet): string {
  return '﻿' + Papa.unparse(sheet.rows.map((r) => r.map(cellToString)), { newline: '\r\n' });
}

function uniqueHeaders(row: Cell[]): string[] {
  const seen = new Map<string, number>();
  return row.map((c, i) => {
    let h = cellToString(c).trim() || `col_${i + 1}`;
    const count = seen.get(h) ?? 0;
    seen.set(h, count + 1);
    if (count > 0) h = `${h}_${count + 1}`;
    return h;
  });
}

export function sheetsToJson(sheets: Sheet[]): string {
  const conv = (s: Sheet) => {
    if (!s.rows.length) return [];
    const headers = uniqueHeaders(s.rows[0]);
    return s.rows.slice(1).map((r) => {
      const o: Record<string, string | number | boolean | null> = {};
      headers.forEach((h, i) => {
        const v = r[i] ?? null;
        o[h] = v instanceof Date ? cellToString(v) : v === '' ? '' : v;
      });
      return o;
    });
  };
  if (sheets.length === 1) return JSON.stringify(conv(sheets[0]), null, 2);
  const out: Record<string, unknown> = {};
  for (const s of sheets) out[s.name] = conv(s);
  return JSON.stringify(out, null, 2);
}

export function sheetsToHtml(sheets: Sheet[], title: string): string {
  const body = sheets
    .map((s) => {
      const [head, ...rest] = s.rows;
      const th = head ? `<thead><tr>${head.map((c) => `<th>${escapeHtml(cellToString(c))}</th>`).join('')}</tr></thead>` : '';
      const tb = `<tbody>${rest.map((r) => `<tr>${r.map((c) => `<td>${escapeHtml(cellToString(c))}</td>`).join('')}</tr>`).join('')}</tbody>`;
      return `${sheets.length > 1 ? `<h2>${escapeHtml(s.name)}</h2>` : ''}<div style="overflow-x:auto"><table>${th}${tb}</table></div>`;
    })
    .join('\n');
  return wrapHtmlDoc(title, `<h1>${escapeHtml(title)}</h1>\n${body}`);
}

export function sheetsToMarkdown(sheets: Sheet[]): string {
  const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>');
  return (
    sheets
      .map((s) => {
        if (!s.rows.length) return '';
        const cols = Math.max(...s.rows.map((r) => r.length));
        const pad = (r: Cell[]) => Array.from({ length: cols }, (_, i) => esc(cellToString(r[i] ?? '')));
        const [head, ...rest] = s.rows;
        const lines = [`| ${pad(head).join(' | ')} |`, `| ${Array(cols).fill('---').join(' | ')} |`, ...rest.map((r) => `| ${pad(r).join(' | ')} |`)];
        return (sheets.length > 1 ? `## ${s.name}\n\n` : '') + lines.join('\n');
      })
      .join('\n\n') + '\n'
  );
}

function xmlName(h: string): string {
  let n = h.replace(/[^\p{L}\p{N}_.-]/gu, '_');
  if (!/^[\p{L}_]/u.test(n)) n = `_${n}`;
  return n;
}

export function sheetsToXml(sheets: Sheet[]): string {
  const x = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const body = sheets
    .map((s) => {
      if (!s.rows.length) return `  <sheet name="${x(s.name)}"/>`;
      const headers = uniqueHeaders(s.rows[0]).map(xmlName);
      const rows = s.rows
        .slice(1)
        .map((r) => `    <row>${headers.map((h, i) => `<${h}>${x(cellToString(r[i] ?? ''))}</${h}>`).join('')}</row>`)
        .join('\n');
      return `  <sheet name="${x(s.name)}">\n${rows}\n  </sheet>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<workbook>\n${body}\n</workbook>\n`;
}
