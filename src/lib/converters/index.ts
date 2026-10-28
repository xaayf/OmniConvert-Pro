import { getFileKind } from '../formats';
import { convertData, convertDocx, convertPdf, convertText } from './documents';
import { convertImage, loadImage } from './image';
import { imageToOcrCanvas, ocrCanvases } from './ocr';
import { baseName } from '../formats';
import { blocksToDocx } from './office';
import { reflowLines } from '../textfmt';
import type { ConvertResult, ConvertSettings, ProgressFn } from './types';

export * from './types';

/** Router konversi: semua pemrosesan terjadi lokal di browser. */
export async function convertFile(file: File, target: string, settings: ConvertSettings, onProgress?: ProgressFn): Promise<ConvertResult> {
  const kind = getFileKind(file.name);
  if (!kind.supported) throw new Error(kind.reason ?? 'Format tidak didukung.');
  if (!kind.targets.includes(target)) throw new Error(`Konversi .${kind.ext} → ${target} tidak tersedia.`);

  if (kind.category === 'IMAGE' && (target === 'TXT' || target === 'DOCX')) {
    const li = await loadImage(file);
    let lines: string[];
    try {
      [lines] = await ocrCanvases([imageToOcrCanvas(li.img, li.width, li.height)], 1, onProgress);
    } finally {
      li.dispose();
    }
    if (!lines.some((l) => l.trim())) throw new Error('OCR tidak menemukan teks pada gambar ini.');
    const name = baseName(file.name);
    const note = 'Teks dibaca dengan OCR (Indonesia + Inggris) — periksa kembali, bisa ada salah baca.';
    if (target === 'TXT') {
      const text = lines.join('\n').trim() + '\n';
      return { blob: new Blob([text], { type: 'text/plain;charset=utf-8' }), fileName: `${name}.txt`, previewText: text.slice(0, 6000), note };
    }
    const blocks = reflowLines(lines).map((t) => ({ kind: 'p' as const, text: t }));
    return { blob: await blocksToDocx([blocks], name), fileName: `${name}.docx`, note };
  }
  if (kind.category === 'IMAGE') return convertImage(file, target, settings);
  if (kind.category === 'DATA') return convertData(file, target, settings);
  if (kind.ext === 'pdf') return convertPdf(file, target, settings, onProgress);
  if (kind.ext === 'docx') return convertDocx(file, target, settings);
  return convertText(file, target, settings);
}
