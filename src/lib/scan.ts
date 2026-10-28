/**
 * Mesin pemindai dokumen (100% lokal): koreksi perspektif, rotasi, dan filter dokumen.
 * Bagian numerik memakai Uint8ClampedArray murni agar bisa diuji tanpa DOM.
 */

export interface Pt {
  x: number;
  y: number;
}
/** Urutan sudut: kiri-atas, kanan-atas, kanan-bawah, kiri-bawah (dalam piksel sumber). */
export type Quad = [Pt, Pt, Pt, Pt];
export type ScanFilter = 'bw' | 'magic' | 'gray' | 'original';
export type Rotation = 0 | 90 | 180 | 270;

export function defaultQuad(w: number, h: number, inset = 0.04): Quad {
  const ix = w * inset;
  const iy = h * inset;
  return [
    { x: ix, y: iy },
    { x: w - ix, y: iy },
    { x: w - ix, y: h - iy },
    { x: ix, y: h - iy }
  ];
}

export function isFullQuad(q: Quad, w: number, h: number, tol = 0.5): boolean {
  const full = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h]
  ];
  return q.every((p, i) => Math.abs(p.x - full[i][0]) <= tol && Math.abs(p.y - full[i][1]) <= tol);
}

const dist = (a: Pt, b: Pt) => Math.hypot(a.x - b.x, a.y - b.y);

/** Ukuran hasil luruskan: sisi terpanjang tiap pasangan, dibatasi maxDim. */
export function warpSize(q: Quad, maxDim: number): { w: number; h: number } {
  let w = Math.max(dist(q[0], q[1]), dist(q[3], q[2]));
  let h = Math.max(dist(q[0], q[3]), dist(q[1], q[2]));
  const k = Math.min(1, maxDim / Math.max(w, h, 1));
  w = Math.max(1, Math.round(w * k));
  h = Math.max(1, Math.round(h * k));
  return { w, h };
}

/** Pemetaan proyektif kotak satuan -> segiempat (Heckbert). */
export function squareToQuad(q: Quad): ((u: number, v: number) => Pt) | null {
  const [p0, p1, p2, p3] = q;
  const dx1 = p1.x - p2.x;
  const dx2 = p3.x - p2.x;
  const dx3 = p0.x - p1.x + p2.x - p3.x;
  const dy1 = p1.y - p2.y;
  const dy2 = p3.y - p2.y;
  const dy3 = p0.y - p1.y + p2.y - p3.y;
  const den = dx1 * dy2 - dx2 * dy1;
  let g = 0;
  let h = 0;
  if (Math.abs(dx3) > 1e-9 || Math.abs(dy3) > 1e-9) {
    if (Math.abs(den) < 1e-9) return null; // segiempat degenerat
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
  }
  const a = p1.x - p0.x + g * p1.x;
  const b = p3.x - p0.x + h * p3.x;
  const d = p1.y - p0.y + g * p1.y;
  const e = p3.y - p0.y + h * p3.y;
  return (u, v) => {
    const w = g * u + h * v + 1;
    return { x: (a * u + b * v + p0.x) / w, y: (d * u + e * v + p0.y) / w };
  };
}

/** Luruskan segiempat dari `src` (RGBA) ke persegi panjang w x h dengan interpolasi bilinear. */
export function warpPixels(src: Uint8ClampedArray, sw: number, sh: number, q: Quad, ow: number, oh: number): Uint8ClampedArray<ArrayBuffer> {
  const map = squareToQuad(q);
  const out = new Uint8ClampedArray(ow * oh * 4);
  if (!map) return out;
  for (let j = 0; j < oh; j++) {
    const v = (j + 0.5) / oh;
    for (let i = 0; i < ow; i++) {
      const p = map((i + 0.5) / ow, v);
      const x = Math.min(sw - 1, Math.max(0, p.x - 0.5));
      const y = Math.min(sh - 1, Math.max(0, p.y - 0.5));
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      const x1 = Math.min(sw - 1, x0 + 1);
      const y1 = Math.min(sh - 1, y0 + 1);
      const fx = x - x0;
      const fy = y - y0;
      const o = (j * ow + i) * 4;
      for (let c = 0; c < 4; c++) {
        const top = src[(y0 * sw + x0) * 4 + c] * (1 - fx) + src[(y0 * sw + x1) * 4 + c] * fx;
        const bot = src[(y1 * sw + x0) * 4 + c] * (1 - fx) + src[(y1 * sw + x1) * 4 + c] * fx;
        out[o + c] = top * (1 - fy) + bot * fy;
      }
    }
  }
  return out;
}

// ───────────────────────── filter ─────────────────────────

interface MeanMap {
  mw: number;
  mh: number;
  block: number;
  ch: number;
  data: Float32Array;
}

/** Peta rata-rata lokal beresolusi rendah (blok + box blur terpisah) — hemat memori dibanding integral image. */
function buildMeanMap(px: Uint8ClampedArray, w: number, h: number, ch: 1 | 3, block: number, radius: number): MeanMap {
  const mw = Math.ceil(w / block);
  const mh = Math.ceil(h / block);
  const sum = new Float32Array(mw * mh * ch);
  const cnt = new Float32Array(mw * mh);
  for (let y = 0; y < h; y++) {
    const my = Math.floor(y / block);
    for (let x = 0; x < w; x++) {
      const mi = my * mw + Math.floor(x / block);
      const i = (y * w + x) * 4;
      cnt[mi]++;
      if (ch === 1) sum[mi] += 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      else {
        sum[mi * 3] += px[i];
        sum[mi * 3 + 1] += px[i + 1];
        sum[mi * 3 + 2] += px[i + 2];
      }
    }
  }
  for (let m = 0; m < mw * mh; m++) for (let c = 0; c < ch; c++) sum[m * ch + c] /= cnt[m] || 1;

  const tmp = new Float32Array(sum.length);
  for (let c = 0; c < ch; c++) {
    for (let y = 0; y < mh; y++) {
      for (let x = 0; x < mw; x++) {
        let s = 0;
        let n = 0;
        for (let k = Math.max(0, x - radius); k <= Math.min(mw - 1, x + radius); k++) {
          s += sum[(y * mw + k) * ch + c];
          n++;
        }
        tmp[(y * mw + x) * ch + c] = s / n;
      }
    }
    for (let x = 0; x < mw; x++) {
      for (let y = 0; y < mh; y++) {
        let s = 0;
        let n = 0;
        for (let k = Math.max(0, y - radius); k <= Math.min(mh - 1, y + radius); k++) {
          s += tmp[(k * mw + x) * ch + c];
          n++;
        }
        sum[(y * mw + x) * ch + c] = s / n;
      }
    }
  }
  return { mw, mh, block, ch, data: sum };
}

function sampleMean(m: MeanMap, x: number, y: number, c: number): number {
  const fx = Math.min(m.mw - 1, Math.max(0, (x + 0.5) / m.block - 0.5));
  const fy = Math.min(m.mh - 1, Math.max(0, (y + 0.5) / m.block - 0.5));
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(m.mw - 1, x0 + 1);
  const y1 = Math.min(m.mh - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const g = (xx: number, yy: number) => m.data[(yy * m.mw + xx) * m.ch + c];
  return (g(x0, y0) * (1 - tx) + g(x1, y0) * tx) * (1 - ty) + (g(x0, y1) * (1 - tx) + g(x1, y1) * tx) * ty;
}

const clamp255 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);

/** Hitam-putih adaptif: bandingkan tiap piksel dengan rata-rata lingkungannya (tahan bayangan & pencahayaan miring). */
export function applyBlackWhite(px: Uint8ClampedArray, w: number, h: number) {
  const block = 8;
  const radius = Math.max(3, Math.round(w / block / 14));
  const mm = buildMeanMap(px, w, h, 1, block, radius);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const lum = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
      const t = sampleMean(mm, x, y, 0) * 0.9;
      const v = clamp255((lum - t) * 7 + 200); // lompatan halus -> tepi huruf tidak bergerigi
      px[i] = px[i + 1] = px[i + 2] = v;
      px[i + 3] = 255;
    }
  }
}

/** Warna ajaib: ratakan pencahayaan (kertas -> putih) dengan menjaga warna tinta/gambar. */
export function applyMagicColor(px: Uint8ClampedArray, w: number, h: number) {
  const block = 8;
  const radius = Math.max(3, Math.round(w / block / 10));
  const mm = buildMeanMap(px, w, h, 3, block, radius);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      for (let c = 0; c < 3; c++) {
        const bg = Math.max(30, sampleMean(mm, x, y, c));
        const r = clamp255((px[i + c] / bg) * 240);
        px[i + c] = 255 * Math.pow(r / 255, 1.35); // sedikit menggelapkan tengah agar teks tegas
      }
      px[i + 3] = 255;
    }
  }
}

export function applyGray(px: Uint8ClampedArray) {
  for (let i = 0; i < px.length; i += 4) {
    const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
    px[i] = px[i + 1] = px[i + 2] = l;
    px[i + 3] = 255;
  }
}

export function applyFilter(px: Uint8ClampedArray, w: number, h: number, f: ScanFilter) {
  if (f === 'bw') applyBlackWhite(px, w, h);
  else if (f === 'magic') applyMagicColor(px, w, h);
  else if (f === 'gray') applyGray(px);
}

// ───────────────────────── pipeline browser ─────────────────────────

/** Gambar -> canvas mentah dengan sisi terpanjang dibatasi (menjaga memori iOS). */
export function drawToRaw(img: CanvasImageSource, w: number, h: number, maxDim = 2400): HTMLCanvasElement {
  const k = Math.min(1, maxDim / Math.max(w, h));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w * k));
  c.height = Math.max(1, Math.round(h * k));
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, c.width, c.height);
  return c;
}

export interface ScanOptions {
  quad: Quad | null;
  rotation: Rotation;
  filter: ScanFilter;
  maxDim?: number;
}

export function renderScan(raw: HTMLCanvasElement, o: ScanOptions): HTMLCanvasElement {
  const maxDim = o.maxDim ?? 2000;
  let base: HTMLCanvasElement;

  if (o.quad && !isFullQuad(o.quad, raw.width, raw.height)) {
    const { w, h } = warpSize(o.quad, maxDim);
    const sctx = raw.getContext('2d', { willReadFrequently: true })!;
    const src = sctx.getImageData(0, 0, raw.width, raw.height);
    const out = warpPixels(src.data, raw.width, raw.height, o.quad, w, h);
    base = document.createElement('canvas');
    base.width = w;
    base.height = h;
    base.getContext('2d')!.putImageData(new ImageData(out, w, h), 0, 0);
  } else {
    const k = Math.min(1, maxDim / Math.max(raw.width, raw.height));
    base = document.createElement('canvas');
    base.width = Math.max(1, Math.round(raw.width * k));
    base.height = Math.max(1, Math.round(raw.height * k));
    const bctx = base.getContext('2d')!;
    bctx.imageSmoothingQuality = 'high';
    bctx.drawImage(raw, 0, 0, base.width, base.height);
  }

  const swap = o.rotation === 90 || o.rotation === 270;
  const out = document.createElement('canvas');
  out.width = swap ? base.height : base.width;
  out.height = swap ? base.width : base.height;
  const ctx = out.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.translate(out.width / 2, out.height / 2);
  ctx.rotate((o.rotation * Math.PI) / 180);
  ctx.drawImage(base, -base.width / 2, -base.height / 2);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  if (o.filter !== 'original') {
    const data = ctx.getImageData(0, 0, out.width, out.height);
    applyFilter(data.data, out.width, out.height, o.filter);
    ctx.putImageData(data, 0, 0);
  }
  return out;
}
