export interface ConvertSettings {
  /** kualitas JPG/WEBP/PDF-gambar, 20-100 */
  quality: number;
  /** skala gambar/render PDF dalam persen */
  scale: number;
  grayscale: boolean;
  pageSize: 'A4' | 'Letter' | 'Fit';
  orientation: 'auto' | 'portrait' | 'landscape';
}

export const DEFAULT_SETTINGS: ConvertSettings = {
  quality: 90,
  scale: 100,
  grayscale: false,
  pageSize: 'A4',
  orientation: 'auto'
};

export interface ConvertResult {
  blob: Blob;
  fileName: string;
  /** teks pratinjau untuk keluaran berbasis teks */
  previewText?: string;
  /** catatan jujur tentang batasan hasil (mis. layout disederhanakan) */
  note?: string;
}

export type ProgressFn = (percent: number) => void;
