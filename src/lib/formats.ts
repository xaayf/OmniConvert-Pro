export type Category = 'IMAGE' | 'DOCUMENT' | 'DATA';

export const CATEGORY_LABEL: Record<Category, string> = {
  IMAGE: 'Gambar',
  DOCUMENT: 'Dokumen',
  DATA: 'Spreadsheet & Data'
};

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp', 'bmp', 'gif', 'svg', 'heic', 'heif', 'avif'];
const DOC_EXT = ['pdf', 'docx', 'txt', 'md', 'html', 'htm', 'xml'];
const DATA_EXT = ['xlsx', 'csv', 'tsv', 'json'];

/** Format target per jenis input. Semua di sini sudah punya implementasi nyata. */
const IMAGE_TARGETS = ['PNG', 'JPG', 'WEBP', 'BMP', 'ICO', 'SVG', 'PDF', 'TXT', 'DOCX'];
const PDF_TARGETS = ['PNG', 'JPG', 'TXT', 'MD', 'HTML', 'DOCX'];
const DOCX_TARGETS = ['PDF', 'TXT', 'MD', 'HTML'];
const TEXT_TARGETS = ['PDF', 'DOCX', 'TXT', 'MD', 'HTML'];
const DATA_TARGETS = ['XLSX', 'CSV', 'JSON', 'HTML', 'MD', 'XML', 'PDF'];

export interface FileKind {
  ext: string; // lowercase, tanpa titik
  category: Category;
  targets: string[];
  supported: boolean;
  reason?: string;
}

export function getExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i < 0 ? '' : name.slice(i + 1).toLowerCase();
}

export function baseName(name: string): string {
  const i = name.lastIndexOf('.');
  return i <= 0 ? name : name.slice(0, i);
}

const sameFormat = (target: string, ext: string) => {
  const t = target.toLowerCase();
  return t === ext || (t === 'jpg' && ext === 'jpeg') || (t === 'html' && ext === 'htm');
};

export function getFileKind(name: string): FileKind {
  const ext = getExt(name);
  let category: Category;
  let targets: string[];

  if (IMAGE_EXT.includes(ext)) {
    category = 'IMAGE';
    targets = IMAGE_TARGETS;
  } else if (ext === 'pdf') {
    category = 'DOCUMENT';
    targets = PDF_TARGETS;
  } else if (ext === 'docx') {
    category = 'DOCUMENT';
    targets = DOCX_TARGETS;
  } else if (DOC_EXT.includes(ext)) {
    category = 'DOCUMENT';
    targets = ext === 'xml' ? ['PDF', 'TXT'] : TEXT_TARGETS;
  } else if (DATA_EXT.includes(ext)) {
    category = 'DATA';
    targets = DATA_TARGETS;
  } else if (ext === 'doc' || ext === 'xls' || ext === 'ppt' || ext === 'pptx') {
    return {
      ext,
      category: 'DOCUMENT',
      targets: [],
      supported: false,
      reason:
        ext === 'xls' || ext === 'doc' || ext === 'ppt'
          ? `Format biner lama .${ext} tidak bisa dibaca di browser. Simpan dulu sebagai ${ext === 'xls' ? '.xlsx' : '.docx'}.`
          : 'PowerPoint (.pptx) belum didukung.'
    };
  } else {
    return { ext, category: 'DOCUMENT', targets: [], supported: false, reason: `Format .${ext || '?'} belum didukung.` };
  }

  return { ext, category, targets: targets.filter((t) => !sameFormat(t, ext)), supported: true };
}

export function isImageExt(ext: string) {
  return IMAGE_EXT.includes(ext);
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(sizes.length - 1, Math.floor(Math.log(bytes) / Math.log(k)));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(i === 0 ? 0 : 2))} ${sizes[i]}`;
}
