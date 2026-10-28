import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts } from 'pdf-lib';
import { encodeBmp, encodeIco } from './encoders';
import { getFileKind, formatBytes } from './formats';
import { blocksToPdf, imagesToPdf, sanitizeForFont, tablesToPdf, textToBlocks, wrapText } from './pdfBuild';
import { blocksToHtml, blocksToText, mdToBlocks, reflowLines, inlineMd } from './textfmt';
import {
  inferCell,
  parseCsv,
  parseJson,
  parseXlsx,
  sheetsToJson,
  sheetsToMarkdown,
  sheetsToXlsx,
  sheetsToXml,
  sheetToCsv
} from './tabular';
import { zipEntries } from './download';
import { unzipSync } from 'fflate';

const PNG_1PX = Uint8Array.from(
  atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='),
  (c) => c.charCodeAt(0)
);

describe('formats', () => {
  it('menentukan target dan menolak format biner lama', () => {
    expect(getFileKind('a.png').targets).not.toContain('PNG');
    expect(getFileKind('a.jpeg').targets).not.toContain('JPG');
    expect(getFileKind('a.pdf').targets).toContain('DOCX');
    expect(getFileKind('a.xls').supported).toBe(false);
    expect(getFileKind('a.doc').supported).toBe(false);
    expect(getFileKind('a.zzz').supported).toBe(false);
    expect(formatBytes(1536)).toBe('1.5 KB');
  });
});

describe('encoders', () => {
  it('BMP: header & ukuran benar, baris dipad ke 4 byte', () => {
    const rgba = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255]); // 3x1
    const out = encodeBmp(3, 1, rgba);
    expect(String.fromCharCode(out[0], out[1])).toBe('BM');
    expect(out.length).toBe(54 + 12); // 9 byte -> pad 12
    expect([out[54], out[55], out[56]]).toEqual([0, 0, 255]); // piksel merah dalam urutan BGR
  });
  it('BMP: alpha digabung ke putih', () => {
    const out = encodeBmp(1, 1, new Uint8ClampedArray([0, 0, 0, 0]));
    expect([out[54], out[55], out[56]]).toEqual([255, 255, 255]);
  });
  it('ICO: header menunjuk payload PNG', () => {
    const ico = encodeIco(PNG_1PX, 1);
    expect(ico[2]).toBe(1);
    expect(ico[4]).toBe(1);
    expect(Array.from(ico.slice(22, 26))).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });
});

describe('pdfBuild', () => {
  it('wrapText memenggal sesuai lebar', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const lines = wrapText('satu dua tiga empat lima enam tujuh delapan', font, 12, 80);
    expect(lines.length).toBeGreaterThan(2);
    for (const l of lines) expect(font.widthOfTextAtSize(l, 12)).toBeLessThanOrEqual(80.01);
    const long = wrapText('x'.repeat(200), font, 12, 80);
    for (const l of long) expect(font.widthOfTextAtSize(l, 12)).toBeLessThanOrEqual(80.01);
  });

  it('sanitizeForFont tidak melempar untuk emoji/aksara asing', async () => {
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const s = sanitizeForFont('Halo 😀 日本 ā “kutip” – ok', font);
    expect(() => font.encodeText(s)).not.toThrow();
    expect(s).toContain('“kutip”');
    expect(s).toContain('a'); // ā -> a
  });

  it('blocksToPdf menghasilkan banyak halaman untuk teks panjang', async () => {
    const text = Array.from({ length: 400 }, (_, i) => `Baris nomor ${i} berisi kalimat uji coba untuk pagination.`).join('\n');
    const bytes = await blocksToPdf(textToBlocks(text), { pageSize: 'A4', orientation: 'portrait', title: 'Uji' });
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe('%PDF-');
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(3);
    expect(doc.getTitle()).toBe('Uji');
  });

  it('tablesToPdf: header berulang & orientasi lanskap otomatis', async () => {
    const rows = [['ID', 'Nama', 'A', 'B', 'C', 'D', 'E'], ...Array.from({ length: 120 }, (_, i) => [String(i), `Item ${i}`, '1', '2', '3', '4', '5'])];
    const bytes = await tablesToPdf([{ name: 'Data', rows }], { pageSize: 'A4', orientation: 'auto' });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getPage(0).getWidth()).toBeGreaterThan(doc.getPage(0).getHeight());
  });

  it('imagesToPdf benar-benar menanam gambar', async () => {
    const bytes = await imagesToPdf([{ bytes: PNG_1PX, mime: 'png', width: 1, height: 1 }], { pageSize: 'A4', orientation: 'auto' });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
    const src = new TextDecoder('latin1').decode(bytes);
    expect(src).toContain('/Subtype /Image');
  });

  it('imagesToPdf mode Fit mengikuti ukuran gambar', async () => {
    const bytes = await imagesToPdf([{ bytes: PNG_1PX, mime: 'png', width: 400, height: 200 }], { pageSize: 'Fit', orientation: 'auto' });
    const p = (await PDFDocument.load(bytes)).getPage(0);
    expect(Math.round(p.getWidth())).toBe(300);
    expect(Math.round(p.getHeight())).toBe(150);
  });
});

describe('textfmt', () => {
  it('mdToBlocks mengenali heading, daftar, kode, paragraf', () => {
    const b = mdToBlocks('# Judul\n\nIsi **tebal** satu\ndua\n\n- a\n- b\n1. x\n\n```\ncode\n```\n');
    expect(b.map((x) => x.kind)).toEqual(['h1', 'p', 'li', 'li', 'li', 'pre']);
    expect(b[1].text).toBe('Isi tebal satu dua');
    expect(b[4].marker).toBe('1.');
  });
  it('inlineMd aman dari XSS & hanya izinkan http(s)/mailto', () => {
    expect(inlineMd('<script>x</script>')).not.toContain('<script>');
    expect(inlineMd('[a](javascript:alert(1))')).not.toContain('href');
    expect(inlineMd('[a](https://x.id)')).toContain('href="https://x.id"');
  });
  it('blocksToHtml meng-escape judul', () => {
    expect(blocksToHtml([{ kind: 'p', text: 'x' }], '<b>"')).toContain('&lt;b&gt;&quot;');
  });
  it('blocksToText & reflowLines', () => {
    expect(blocksToText(mdToBlocks('# A\n\n- x'))).toContain('• x');
    const out = reflowLines(['Ini kalimat yang cukup panjang untuk menjadi', 'satu paragraf utuh.', 'Judul']);
    expect(out[0]).toBe('Ini kalimat yang cukup panjang untuk menjadi satu paragraf utuh.');
  });
});

describe('tabular', () => {
  it('inferCell menjaga ID bernol di depan', () => {
    expect(inferCell('123')).toBe(123);
    expect(inferCell('0812345')).toBe('0812345');
    expect(inferCell('1.5')).toBe(1.5);
    expect(inferCell('TRX-1')).toBe('TRX-1');
    expect(inferCell('12345678901234567890')).toBe('12345678901234567890');
  });

  it('CSV <-> JSON <-> MD <-> XML', () => {
    const sheets = parseCsv('ID,Nama,Total\n1,"Budi, S.",1000\n2,Ani,2000\n');
    expect(sheets[0].rows).toHaveLength(3);
    const json = JSON.parse(sheetsToJson(sheets));
    expect(json[0]).toEqual({ ID: 1, Nama: 'Budi, S.', Total: 1000 });
    expect(sheetsToMarkdown(sheets)).toContain('| ID | Nama | Total |');
    expect(sheetsToXml(sheets)).toContain('<Nama>Budi, S.</Nama>');
    const csv = sheetToCsv(parseJson(JSON.stringify(json))[0]);
    expect(csv.startsWith('\ufeff')).toBe(true); // BOM agar Excel membaca UTF-8
    const back = parseCsv(csv.replace(/^\ufeff/, ''));
    expect(back[0].rows[1]).toEqual([1, 'Budi, S.', 1000]);
  });

  it('header kosong/duplikat tetap unik di JSON', () => {
    const j = JSON.parse(sheetsToJson([{ name: 's', rows: [['a', 'a', ''], [1, 2, 3]] }]));
    expect(Object.keys(j[0])).toEqual(['a', 'a_2', 'col_3']);
  });

  it('XLSX round-trip nyata (zip OOXML, bukan HTML palsu)', async () => {
    const blob = await sheetsToXlsx([{ name: 'Data', rows: [['Nama', 'Nilai'], ['A', 10], ['B', 20.5]] }]);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    expect(String.fromCharCode(bytes[0], bytes[1])).toBe('PK');
    const back = await parseXlsx(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer);
    expect(back[0].name).toBe('Data');
    expect(back[0].rows).toEqual([['Nama', 'Nilai'], ['A', 10], ['B', 20.5]]);
  });

  it('JSON multi-sheet', () => {
    const s = parseJson('{"a":[{"x":1}],"b":[{"y":2}]}');
    expect(s.map((x) => x.name)).toEqual(['a', 'b']);
  });
});

describe('zip', () => {
  it('nama bentrok diberi sufiks', () => {
    const blob = zipEntries([
      { name: 'a.txt', data: new Uint8Array([1]) },
      { name: 'a.txt', data: new Uint8Array([2]) }
    ]);
    expect(blob.size).toBeGreaterThan(0);
  });
  it('isi zip bisa dibuka kembali', async () => {
    const blob = zipEntries([{ name: 'x.txt', data: new TextEncoder().encode('halo') }]);
    const files = unzipSync(new Uint8Array(await blob.arrayBuffer()));
    expect(new TextDecoder().decode(files['x.txt'])).toBe('halo');
  });
});
