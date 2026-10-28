import { getFileKind } from '../formats';
import { convertData, convertDocx, convertPdf, convertText } from './documents';
import { convertImage } from './image';
import type { ConvertResult, ConvertSettings, ProgressFn } from './types';

export * from './types';

/** Router konversi: semua pemrosesan terjadi lokal di browser. */
export async function convertFile(file: File, target: string, settings: ConvertSettings, onProgress?: ProgressFn): Promise<ConvertResult> {
  const kind = getFileKind(file.name);
  if (!kind.supported) throw new Error(kind.reason ?? 'Format tidak didukung.');
  if (!kind.targets.includes(target)) throw new Error(`Konversi .${kind.ext} → ${target} tidak tersedia.`);

  if (kind.category === 'IMAGE') return convertImage(file, target, settings);
  if (kind.category === 'DATA') return convertData(file, target, settings);
  if (kind.ext === 'pdf') return convertPdf(file, target, settings, onProgress);
  if (kind.ext === 'docx') return convertDocx(file, target, settings);
  return convertText(file, target, settings);
}
