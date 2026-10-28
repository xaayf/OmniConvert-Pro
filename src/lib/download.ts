import { zipSync } from 'fflate';

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

export async function blobToBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** Zip tanpa kompresi ulang (PNG/JPG sudah terkompres) => cepat. */
export function zipEntries(entries: ZipEntry[], level: 0 | 6 = 0): Blob {
  const obj: Record<string, Uint8Array> = {};
  const used = new Set<string>();
  for (const e of entries) {
    let name = e.name;
    let n = 1;
    while (used.has(name)) {
      const dot = e.name.lastIndexOf('.');
      name = dot > 0 ? `${e.name.slice(0, dot)}_${n}${e.name.slice(dot)}` : `${e.name}_${n}`;
      n++;
    }
    used.add(name);
    obj[name] = e.data;
  }
  const zipped = zipSync(obj, { level });
  // Salin ke ArrayBuffer murni agar kompatibel dengan tipe Blob.
  const copy = new Uint8Array(zipped.length);
  copy.set(zipped);
  return new Blob([copy.buffer], { type: 'application/zip' });
}

export function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Beri waktu browser (terutama iOS) memulai unduhan sebelum URL dicabut.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

export function canShareFile(blob: Blob, fileName: string): boolean {
  try {
    if (typeof navigator === 'undefined' || !navigator.canShare) return false;
    return navigator.canShare({ files: [new File([blob], fileName, { type: blob.type })] });
  } catch {
    return false;
  }
}

export async function shareBlob(blob: Blob, fileName: string): Promise<boolean> {
  try {
    const file = new File([blob], fileName, { type: blob.type });
    await navigator.share({ files: [file], title: fileName });
    return true;
  } catch (e) {
    if ((e as DOMException)?.name === 'AbortError') return false;
    throw e;
  }
}

export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  return copy.buffer;
}

export function bytesToBlob(bytes: Uint8Array, type: string): Blob {
  return new Blob([toArrayBuffer(bytes)], { type });
}
