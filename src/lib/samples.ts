/** File contoh untuk mencoba cepat tanpa harus punya file. */
export async function createSampleFiles(): Promise<File[]> {
  const csv = `ID_Transaksi,Nama_Produk,Kategori,Unit_Terjual,Total_Pendapatan_IDR,Status
TRX-1001,Laptop Pro X15,Elektronik,14,210000000,Lunas
TRX-1002,Monitor UltraWide 34,Aksesoris,28,140000000,Lunas
TRX-1003,Mechanical Keyboard RGB,Aksesoris,65,58500000,Proses
TRX-1004,Cloud Server Enterprise,Layanan,8,120000000,Lunas
TRX-1005,Webcam 4K Studio,Elektronik,42,63000000,Lunas`;

  const md = `# Proposal Transformasi Digital

Disusun oleh **Tim Arsitektur Solusi** pada ${new Date().toLocaleDateString('id-ID')}.

## Ringkasan Eksekutif

Integrasi sistem manajemen dokumen berbasis web untuk mempercepat alur kerja lintas divisi.

## Target Utama

- Otomatisasi konversi laporan PDF, Word, dan spreadsheet.
- Pemrosesan di sisi klien: file tidak pernah diunggah ke server.
- Penghematan biaya lisensi perangkat lunak.

## Kesimpulan

Siap diimplementasikan pada kuartal berikutnya.
`;

  const canvas = document.createElement('canvas');
  canvas.width = 800;
  canvas.height = 480;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createLinearGradient(0, 0, 800, 480);
  g.addColorStop(0, '#4f46e5');
  g.addColorStop(0.55, '#7c3aed');
  g.addColorStop(1, '#ec4899');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 800, 480);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.beginPath();
  ctx.arc(660, 90, 170, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(110, 420, 130, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = 'bold 44px system-ui, sans-serif';
  ctx.fillText('OmniConvert Pro', 60, 220);
  ctx.font = '22px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.fillText('Gambar contoh 800 × 480 px — coba ubah ke WEBP, ICO, atau PDF', 60, 270);
  const png = await new Promise<Blob>((r) => canvas.toBlob((b) => r(b!), 'image/png'));

  return [
    new File([csv], 'Laporan_Penjualan_Q4.csv', { type: 'text/csv' }),
    new File([md], 'Proposal_Digital.md', { type: 'text/markdown' }),
    new File([png], 'Banner_Contoh.png', { type: 'image/png' })
  ];
}
