/** Encoder BMP 24-bit (tanpa kompresi) dan ICO (payload PNG) murni TypeScript. */

export function encodeBmp(width: number, height: number, rgba: Uint8ClampedArray): Uint8Array {
  const rowSize = Math.ceil((width * 3) / 4) * 4; // tiap baris dipad kelipatan 4 byte
  const pixelBytes = rowSize * height;
  const fileSize = 54 + pixelBytes;
  const out = new Uint8Array(fileSize);
  const v = new DataView(out.buffer);

  out[0] = 0x42; // 'B'
  out[1] = 0x4d; // 'M'
  v.setUint32(2, fileSize, true);
  v.setUint32(10, 54, true); // offset data piksel
  v.setUint32(14, 40, true); // BITMAPINFOHEADER
  v.setInt32(18, width, true);
  v.setInt32(22, height, true); // positif = baris dari bawah ke atas
  v.setUint16(26, 1, true);
  v.setUint16(28, 24, true);
  v.setUint32(34, pixelBytes, true);
  v.setInt32(38, 2835, true); // ~72 DPI
  v.setInt32(42, 2835, true);

  for (let y = 0; y < height; y++) {
    const src = (height - 1 - y) * width * 4;
    let dst = 54 + y * rowSize;
    for (let x = 0; x < width; x++) {
      const i = src + x * 4;
      const a = rgba[i + 3] / 255;
      // BMP 24-bit tidak punya alpha: gabungkan ke latar putih.
      out[dst++] = Math.round(rgba[i + 2] * a + 255 * (1 - a));
      out[dst++] = Math.round(rgba[i + 1] * a + 255 * (1 - a));
      out[dst++] = Math.round(rgba[i] * a + 255 * (1 - a));
    }
  }
  return out;
}

/** ICO satu gambar dengan payload PNG (didukung Windows Vista+, macOS, semua browser). */
export function encodeIco(png: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(22 + png.length);
  const v = new DataView(out.buffer);
  v.setUint16(0, 0, true); // reserved
  v.setUint16(2, 1, true); // type: icon
  v.setUint16(4, 1, true); // jumlah gambar
  out[6] = size >= 256 ? 0 : size; // 0 = 256
  out[7] = size >= 256 ? 0 : size;
  out[8] = 0;
  out[9] = 0;
  v.setUint16(10, 1, true); // planes
  v.setUint16(12, 32, true); // bpp
  v.setUint32(14, png.length, true);
  v.setUint32(18, 22, true); // offset
  out.set(png, 22);
  return out;
}
