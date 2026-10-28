// Menyalin worker, inti WASM, dan data bahasa Tesseract ke public/ocr agar OCR berjalan lokal/offline (tanpa CDN).
import { cpSync, mkdirSync, readdirSync, existsSync } from 'node:fs';

const out = 'public/ocr';
mkdirSync(out, { recursive: true });
cpSync('node_modules/tesseract.js/dist/worker.min.js', `${out}/worker.min.js`);
for (const f of readdirSync('node_modules/tesseract.js-core')) {
  if (/-lstm\.wasm\.js$/.test(f) || f === 'tesseract-core-lstm.wasm.js') cpSync(`node_modules/tesseract.js-core/${f}`, `${out}/${f}`);
}
for (const lang of ['eng', 'ind']) {
  const dir = `node_modules/@tesseract.js-data/${lang}/4.0.0_best_int`;
  if (!existsSync(dir)) throw new Error(`Data bahasa ${lang} tidak ditemukan`);
  cpSync(`${dir}/${lang}.traineddata.gz`, `${out}/${lang}.traineddata.gz`);
}
console.log('OCR assets disalin ke', out);
