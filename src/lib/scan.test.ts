import { describe, expect, it } from 'vitest';
import { applyBlackWhite, applyMagicColor, defaultQuad, isFullQuad, squareToQuad, warpPixels, warpSize, type Quad } from './scan';

const rgbaImage = (w: number, h: number, fn: (x: number, y: number) => [number, number, number]) => {
  const px = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const [r, g, b] = fn(x, y);
      px.set([r, g, b, 255], (y * w + x) * 4);
    }
  return px;
};

describe('perspektif', () => {
  const q: Quad = [
    { x: 10, y: 20 },
    { x: 210, y: 10 },
    { x: 230, y: 160 },
    { x: 0, y: 150 }
  ];
  it('sudut kotak satuan jatuh tepat di sudut segiempat', () => {
    const m = squareToQuad(q)!;
    const corners = [m(0, 0), m(1, 0), m(1, 1), m(0, 1)];
    corners.forEach((c, i) => {
      expect(c.x).toBeCloseTo(q[i].x, 6);
      expect(c.y).toBeCloseTo(q[i].y, 6);
    });
  });
  it('segiempat sejajar (affine) bekerja', () => {
    const r: Quad = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 0, y: 50 }];
    const m = squareToQuad(r)!;
    expect(m(0.5, 0.5)).toEqual({ x: 50, y: 25 });
  });
  it('segiempat degenerat -> null', () => {
    const d: Quad = [{ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 20, y: 20 }, { x: 30, y: 30 }];
    expect(squareToQuad(d)).toBeNull();
  });
  it('warpPixels meluruskan blok warna ke ukuran target', () => {
    // gambar 100x100: kotak merah di (20..80, 20..80) di latar putih
    const src = rgbaImage(100, 100, (x, y) => (x >= 20 && x < 80 && y >= 20 && y < 80 ? [255, 0, 0] : [255, 255, 255]));
    const quad: Quad = [{ x: 20, y: 20 }, { x: 80, y: 20 }, { x: 80, y: 80 }, { x: 20, y: 80 }];
    const { w, h } = warpSize(quad, 2000);
    expect([w, h]).toEqual([60, 60]);
    const out = warpPixels(src, 100, 100, quad, w, h);
    const mid = (30 * w + 30) * 4;
    expect([out[mid], out[mid + 1], out[mid + 2]]).toEqual([255, 0, 0]);
    expect(out[3]).toBe(255);
  });
  it('warpSize dibatasi maxDim', () => {
    const big: Quad = [{ x: 0, y: 0 }, { x: 5000, y: 0 }, { x: 5000, y: 2500 }, { x: 0, y: 2500 }];
    expect(warpSize(big, 2000)).toEqual({ w: 2000, h: 1000 });
  });
  it('isFullQuad & defaultQuad', () => {
    expect(isFullQuad([{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }], 10, 10)).toBe(true);
    expect(isFullQuad(defaultQuad(100, 100), 100, 100)).toBe(false);
  });
});

describe('filter dokumen', () => {
  it('B&W: tulisan gelap -> hitam, kertas bayangan miring -> putih', () => {
    const w = 160;
    const h = 120;
    // gradien pencahayaan (kertas 150..240) + garis teks gelap
    const px = rgbaImage(w, h, (x, y) => {
      const paper = 150 + (x / w) * 90;
      const ink = y >= 58 && y < 62 && x > 20 && x < 140;
      const v = ink ? paper * 0.25 : paper;
      return [v, v, v];
    });
    applyBlackWhite(px, w, h);
    const at = (x: number, y: number) => px[(y * w + x) * 4];
    expect(at(40, 60)).toBeLessThan(40); // tinta kiri
    expect(at(120, 60)).toBeLessThan(40); // tinta kanan (lebih terang) tetap hitam
    expect(at(10, 20)).toBeGreaterThan(230); // kertas gelap sisi kiri -> putih
    expect(at(150, 100)).toBeGreaterThan(230);
  });
  it('Magic color: kertas jadi putih, warna tinta dipertahankan', () => {
    const w = 120;
    const h = 80;
    const px = rgbaImage(w, h, (x, y) => (y >= 38 && y < 42 && x > 10 && x < 110 ? [30, 60, 200] : [200, 195, 180]));
    applyMagicColor(px, w, h);
    const p = (x: number, y: number) => [px[(y * w + x) * 4], px[(y * w + x) * 4 + 1], px[(y * w + x) * 4 + 2]];
    expect(p(5, 5).every((v) => v > 215)).toBe(true);
    const ink = p(60, 40);
    expect(ink[2]).toBeGreaterThan(ink[0]); // tetap kebiruan
    expect(ink[0]).toBeLessThan(100);
  });
});
