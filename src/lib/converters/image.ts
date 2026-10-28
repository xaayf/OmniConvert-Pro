import { encodeBmp, encodeIco } from '../encoders';
import { baseName, getExt } from '../formats';
import { blobToBytes, bytesToBlob } from '../download';
import { imagesToPdf } from '../pdfBuild';
import type { ConvertResult, ConvertSettings } from './types';

const MAX_PIXELS = 16_000_000; // batas aman canvas iOS Safari (~4096x4096)

export function canvasToBlob(canvas: HTMLCanvasElement, mime: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (!b) return reject(new Error('Gagal membuat gambar (canvas terlalu besar atau memori habis).'));
        // Beberapa browser diam-diam menyimpan PNG saat format tidak didukung. Jangan pura-pura sukses.
        if (b.type !== mime) return reject(new Error(`Browser ini tidak mendukung penyimpanan ${mime.split('/')[1].toUpperCase()}.`));
        resolve(b);
      },
      mime,
      quality
    );
  });
}

async function normalizeSvg(file: Blob): Promise<Blob> {
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root = doc.documentElement;
  if (root.nodeName.toLowerCase() !== 'svg') throw new Error('File SVG tidak valid.');
  if (!root.getAttribute('width') || !root.getAttribute('height')) {
    const vb = (root.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
    const w = vb.length === 4 && vb[2] > 0 ? vb[2] : 1024;
    const h = vb.length === 4 && vb[3] > 0 ? vb[3] : 1024;
    root.setAttribute('width', String(w));
    root.setAttribute('height', String(h));
  }
  if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  return new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' });
}

async function toDecodableBlob(file: File): Promise<Blob> {
  const ext = getExt(file.name);
  if (ext === 'heic' || ext === 'heif') {
    const heic2any = (await import('heic2any')).default;
    const out = await heic2any({ blob: file, toType: 'image/png' });
    return Array.isArray(out) ? out[0] : out;
  }
  if (ext === 'svg') return normalizeSvg(file);
  return file;
}

export interface LoadedImage {
  img: HTMLImageElement;
  width: number;
  height: number;
  dispose: () => void;
}

export async function loadImage(file: File): Promise<LoadedImage> {
  const blob = await toDecodableBlob(file);
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } catch {
    URL.revokeObjectURL(url);
    throw new Error('Gambar tidak bisa dibaca (file rusak atau format tidak didukung browser).');
  }
  return { img, width: img.naturalWidth, height: img.naturalHeight, dispose: () => URL.revokeObjectURL(url) };
}

export function grayscaleCanvas(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d')!;
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = data.data;
  for (let i = 0; i < d.length; i += 4) {
    const l = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
    d[i] = d[i + 1] = d[i + 2] = l;
  }
  ctx.putImageData(data, 0, 0);
}

export async function convertImage(file: File, target: string, s: ConvertSettings): Promise<ConvertResult> {
  const li = await loadImage(file);
  try {
    let scale = s.scale / 100;
    let note: string | undefined;
    const pixels = li.width * li.height * scale * scale;
    if (pixels > MAX_PIXELS) {
      scale = Math.sqrt(MAX_PIXELS / (li.width * li.height));
      note = 'Resolusi dibatasi ±16 MP agar aman di semua perangkat (iPhone/Safari).';
    }
    const w = Math.max(1, Math.round(li.width * scale));
    const h = Math.max(1, Math.round(li.height * scale));

    const needsWhite = target === 'JPG' || target === 'PDF';
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: target === 'BMP' || s.grayscale });
    if (!ctx) throw new Error('Canvas tidak tersedia.');
    if (needsWhite) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(li.img, 0, 0, w, h);
    if (s.grayscale) grayscaleCanvas(canvas); // manual, karena ctx.filter tidak ada di Safari

    const q = s.quality / 100;
    const name = baseName(file.name);

    switch (target) {
      case 'PNG':
        return { blob: await canvasToBlob(canvas, 'image/png'), fileName: `${name}.png`, note };
      case 'JPG':
        return { blob: await canvasToBlob(canvas, 'image/jpeg', q), fileName: `${name}.jpg`, note };
      case 'WEBP':
        return { blob: await canvasToBlob(canvas, 'image/webp', q), fileName: `${name}.webp`, note };
      case 'BMP': {
        const data = ctx.getImageData(0, 0, w, h);
        return { blob: bytesToBlob(encodeBmp(w, h, data.data), 'image/bmp'), fileName: `${name}.bmp`, note };
      }
      case 'ICO': {
        const size = Math.min(256, Math.max(w, h));
        const sq = document.createElement('canvas');
        sq.width = sq.height = size;
        const sctx = sq.getContext('2d')!;
        sctx.imageSmoothingQuality = 'high';
        const r = Math.min(size / w, size / h);
        sctx.drawImage(canvas, (size - w * r) / 2, (size - h * r) / 2, w * r, h * r);
        const png = await blobToBytes(await canvasToBlob(sq, 'image/png'));
        return {
          blob: bytesToBlob(encodeIco(png, size), 'image/x-icon'),
          fileName: `${name}.ico`,
          note: `Ikon ${size}×${size} px (gambar disesuaikan ke kotak).`
        };
      }
      case 'SVG': {
        const dataUrl = canvas.toDataURL('image/png');
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><image width="${w}" height="${h}" href="${dataUrl}" xlink:href="${dataUrl}"/></svg>`;
        return {
          blob: new Blob([svg], { type: 'image/svg+xml' }),
          fileName: `${name}.svg`,
          note: 'SVG berisi gambar raster yang dibungkus (bukan vektorisasi/trace).'
        };
      }
      case 'PDF': {
        const jpeg = await blobToBytes(await canvasToBlob(canvas, 'image/jpeg', q));
        const bytes = await imagesToPdf([{ bytes: jpeg, mime: 'jpeg', width: w, height: h }], {
          pageSize: s.pageSize,
          orientation: s.orientation,
          title: name
        });
        return { blob: bytesToBlob(bytes, 'application/pdf'), fileName: `${name}.pdf`, note };
      }
      default:
        throw new Error(`Target ${target} tidak didukung untuk gambar.`);
    }
  } finally {
    li.dispose();
  }
}
