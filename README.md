# OmniConvert Pro

Konverter file, scanner dokumen → PDF, dan editor PDF (teks, tanda tangan, stempel, watermark) dalam satu PWA.
**Semua diproses di perangkat** — file tidak pernah diunggah ke server. Bisa dipasang ke layar utama (iPhone/Android/desktop) dan jalan offline.

## Fitur
- **Konverter**: gambar (PNG/JPG/WEBP/BMP/ICO/SVG/HEIC/GIF/AVIF → PDF), PDF → PNG/JPG/TXT/MD/HTML/DOCX, DOCX/TXT/MD/HTML → PDF/…, XLSX/CSV/TSV/JSON ↔ XLSX/CSV/JSON/HTML/MD/XML/PDF. Batch + unduh ZIP.
- **OCR offline** (Indonesia + Inggris, Tesseract): PDF hasil scan → TXT/MD/HTML/DOCX, gambar → TXT/DOCX. Data OCR (~8 MB) diunduh sekali saat pertama dipakai lalu tersimpan untuk offline.
- **Gabung & Pisah PDF**: gabungkan PDF + gambar jadi satu, ekstrak/buang halaman terpilih, pisah per halaman atau per rentang (ZIP).
- **Scanner**: kamera/galeri, koreksi perspektif 4 titik, filter Dokumen/Warna/Abu/Asli, urut ulang, ekspor PDF.
- **PDF Studio**: teks, TTD, stempel, gambar, sorotan, watermark, susun/hapus halaman, undo/redo; hasil tetap vektor. Opsi "Ratakan jadi gambar" agar tutupan benar-benar menyembunyikan isi.
- **PWA**: notifikasi update (Perbarui sekarang / Nanti), cek otomatis tiap 30 menit dan saat app dibuka kembali, status siap-offline.
- UI glassmorphism, header lengket, mode gelap/terang, aman untuk notch iOS.

## Pengembangan
```bash
npm install
npm run dev          # http://localhost:5173
npm test             # vitest
npm run build        # typecheck + build + service worker
npm run icons        # buat ulang logo & ikon PWA (scripts/generate-icons.mjs)
```

## Deploy (Cloudflare Workers assets)
`wrangler.jsonc` sudah mengarah ke `./dist` dengan fallback SPA. Hubungkan repo ke Cloudflare dengan build command `npm run build` — setiap push ke `main` akan terdeploy otomatis. Pengguna PWA akan melihat notifikasi "Versi baru tersedia".

## Batasan (jujur)
- OCR bisa salah baca (terutama foto miring/buram, tulisan tangan); PDF hasil scan di Scanner tetap berupa gambar (belum searchable).
- DOCX → PDF memakai tata letak sederhana; PDF → DOCX hanya teks.
- Teks yang dibuat memakai font standar PDF: hanya aksara Latin (emoji/non-Latin jadi `?`).
- Teks asli di dalam PDF tidak bisa diedit, hanya ditimpa/ditambah.
- PDF berkata sandi tidak didukung; format lama .doc/.xls/.ppt tidak didukung.
- Scanner belum mendeteksi tepi otomatis (atur 4 sudut manual).
