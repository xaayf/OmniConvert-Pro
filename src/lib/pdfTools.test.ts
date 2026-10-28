import { describe, expect, it } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { extractPages, invertSelection, mergeParts, parseRanges } from './pdfTools';

async function makePdf(n: number, w = 300) {
  const d = await PDFDocument.create();
  for (let i = 0; i < n; i++) d.addPage([w + i, 400]);
  return new Uint8Array(await d.save());
}

describe('parseRanges', () => {
  it('parses lists and open ranges', () => {
    expect(parseRanges('1-3, 5, 8-', 9)).toEqual([[0, 1, 2], [4], [7, 8]]);
    expect(parseRanges('2', 3)).toEqual([[1]]);
  });
  it('rejects bad input', () => {
    expect(() => parseRanges('0', 3)).toThrow();
    expect(() => parseRanges('4', 3)).toThrow();
    expect(() => parseRanges('3-1', 3)).toThrow();
    expect(() => parseRanges('a', 3)).toThrow();
  });
});

describe('pdf tools', () => {
  it('merges pdfs and an image in order', async () => {
    const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg=='), (c) => c.charCodeAt(0));
    const out = await mergeParts([
      { kind: 'pdf', name: 'a', bytes: await makePdf(2) },
      { kind: 'image', name: 'i', bytes: png, mime: 'png', width: 1, height: 1 },
      { kind: 'pdf', name: 'b', bytes: await makePdf(1, 500) }
    ]);
    const d = await PDFDocument.load(out);
    expect(d.getPageCount()).toBe(4);
    expect(d.getPage(3).getWidth()).toBe(500);
  });
  it('extracts selected pages in order', async () => {
    const out = await extractPages(await makePdf(5), [3, 0]);
    const d = await PDFDocument.load(out);
    expect(d.getPageCount()).toBe(2);
    expect(d.getPage(0).getWidth()).toBe(303);
    expect(d.getPage(1).getWidth()).toBe(300);
  });
  it('inverts selection', () => {
    expect(invertSelection(4, new Set([1, 2]))).toEqual([0, 3]);
  });
});
