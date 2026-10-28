import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Camera, Crop, Download, FilePlus2, ImagePlus, Loader2, RotateCw, ScanLine, Share2, Sparkles, Trash2, Wand2 } from 'lucide-react';
import { Button, Field, Modal, Segmented, cx } from '../../components/ui';
import { useToast } from '../../hooks/useToast';
import { canvasToBlob, loadImage } from '../../lib/converters/image';
import { blobToBytes, bytesToBlob, canShareFile, saveBlob, shareBlob } from '../../lib/download';
import { formatBytes } from '../../lib/formats';
import { imagesToPdf, type PageSizeName } from '../../lib/pdfBuild';
import { defaultQuad, drawToRaw, isFullQuad, renderScan, squareToQuad, type Quad, type Rotation, type ScanFilter } from '../../lib/scan';

interface ScanPage {
  id: string;
  name: string;
  raw: HTMLCanvasElement;
  quad: Quad | null;
  rotation: Rotation;
  filter: ScanFilter;
  blob: Blob;
  url: string;
  busy: boolean;
}

const FILTERS: { value: ScanFilter; label: string }[] = [
  { value: 'bw', label: 'Dokumen' },
  { value: 'magic', label: 'Warna' },
  { value: 'gray', label: 'Abu' },
  { value: 'original', label: 'Asli' }
];

const nextFrame = () => new Promise<void>((r) => setTimeout(r, 16));
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

async function buildPage(raw: HTMLCanvasElement, quad: Quad | null, rotation: Rotation, filter: ScanFilter) {
  await nextFrame(); // beri UI kesempatan menampilkan spinner sebelum kerja piksel berat
  const canvas = renderScan(raw, { quad, rotation, filter });
  const blob = await canvasToBlob(canvas, 'image/jpeg', 0.88);
  const out = { blob, url: URL.createObjectURL(blob) };
  canvas.width = canvas.height = 0;
  return out;
}

export default function ScannerView({ onWorkChange }: { active: boolean; onWorkChange: (n: number) => void }) {
  const toast = useToast();
  const [pages, setPages] = useState<ScanPage[]>([]);
  const pagesRef = useRef<ScanPage[]>([]);
  pagesRef.current = pages;
  const [defFilter, setDefFilter] = useState<ScanFilter>('bw');
  const [paper, setPaper] = useState<PageSizeName>('A4');
  const [title, setTitle] = useState(() => `Scan_${new Date().toISOString().slice(0, 10)}`);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cropId, setCropId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState<string | null>(null);
  const [last, setLast] = useState<{ blob: Blob; name: string } | null>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const captureRef = useRef<HTMLInputElement>(null);

  useEffect(() => onWorkChange(pages.length), [pages.length, onWorkChange]);
  useEffect(() => () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.url)), []);

  const addRaws = useCallback(
    async (raws: { raw: HTMLCanvasElement; name: string }[]) => {
      for (let i = 0; i < raws.length; i++) {
        setImporting(`Memproses ${i + 1}/${raws.length}…`);
        const { raw, name } = raws[i];
        try {
          const built = await buildPage(raw, null, 0, defFilter);
          setPages((p) => [...p, { id: uid(), name, raw, quad: null, rotation: 0, filter: defFilter, busy: false, ...built }]);
        } catch (e) {
          toast(e instanceof Error ? e.message : 'Gagal memproses gambar', 'error');
        }
      }
      setImporting(null);
      setLast(null);
    },
    [defFilter, toast]
  );

  const addFiles = useCallback(
    async (files: FileList | File[]) => {
      const list = Array.from(files).filter((f) => f.type.startsWith('image/') || /\.(heic|heif)$/i.test(f.name));
      if (!list.length) return toast('Pilih file gambar (JPG, PNG, HEIC…)', 'info');
      const raws: { raw: HTMLCanvasElement; name: string }[] = [];
      for (const f of list) {
        try {
          const li = await loadImage(f);
          raws.push({ raw: drawToRaw(li.img, li.width, li.height), name: f.name });
          li.dispose();
        } catch (e) {
          toast(`${f.name}: ${e instanceof Error ? e.message : 'gagal dibaca'}`, 'error');
        }
      }
      await addRaws(raws);
    },
    [addRaws, toast]
  );

  const update = async (id: string, p: Partial<Pick<ScanPage, 'quad' | 'rotation' | 'filter'>>) => {
    const cur = pagesRef.current.find((x) => x.id === id);
    if (!cur) return;
    setPages((prev) => prev.map((x) => (x.id === id ? { ...x, ...p, busy: true } : x)));
    const next = { ...cur, ...p };
    try {
      const built = await buildPage(cur.raw, next.quad, next.rotation, next.filter);
      URL.revokeObjectURL(cur.url);
      setPages((prev) => prev.map((x) => (x.id === id ? { ...x, ...p, ...built, busy: false } : x)));
    } catch (e) {
      setPages((prev) => prev.map((x) => (x.id === id ? { ...x, busy: false } : x)));
      toast(e instanceof Error ? e.message : 'Gagal memproses halaman', 'error');
    }
  };

  const applyFilterToAll = async () => {
    for (const p of pagesRef.current) if (p.filter !== defFilter) await update(p.id, { filter: defFilter });
  };

  const move = (i: number, d: -1 | 1) =>
    setPages((p) => {
      const j = i + d;
      if (j < 0 || j >= p.length) return p;
      const c = [...p];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });

  const remove = (id: string) => {
    const p = pagesRef.current.find((x) => x.id === id);
    if (p) URL.revokeObjectURL(p.url);
    setPages((prev) => prev.filter((x) => x.id !== id));
  };

  const loadSample = async () => addRaws([{ raw: makeSampleInvoice(), name: 'Contoh_Invoice.jpg' }]);

  const exportPdf = async () => {
    if (!pages.length) return;
    setExporting(true);
    try {
      const imgs = await Promise.all(
        pages.map(async (p) => {
          const bm = await createImageBitmap(p.blob);
          const dims = { width: bm.width, height: bm.height };
          bm.close();
          return { bytes: await blobToBytes(p.blob), mime: 'jpeg' as const, ...dims };
        })
      );
      const pdf = await imagesToPdf(imgs, { pageSize: paper, orientation: 'auto', margin: 14, title });
      const blob = bytesToBlob(pdf, 'application/pdf');
      const name = `${(title || 'Scan').replace(/[^\w\- ]+/g, '_').trim() || 'Scan'}.pdf`;
      saveBlob(blob, name);
      setLast({ blob, name });
      toast(`PDF ${pages.length} halaman (${formatBytes(blob.size)}) siap`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal membuat PDF', 'error');
    } finally {
      setExporting(false);
    }
  };

  const cropPage = pages.find((p) => p.id === cropId) ?? null;

  return (
    <section className="space-y-5">
      <input ref={galleryRef} type="file" accept="image/*,.heic,.heif" multiple className="hidden" onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />
      <input ref={captureRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { if (e.target.files) void addFiles(e.target.files); e.target.value = ''; }} />

      <div className="glass rounded-3xl p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <span className="rounded-lg bg-indigo-500/15 px-2.5 py-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-300">Scanner offline</span>
            <h2 className="mt-2 text-xl font-extrabold">Scanner Dokumen → PDF</h2>
            <p className="mt-1 max-w-xl text-xs text-slate-500 dark:text-slate-400">
              Foto dokumen, luruskan sudutnya (koreksi perspektif), pilih filter, susun halaman, simpan jadi satu PDF.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="primary" icon={ImagePlus} onClick={() => galleryRef.current?.click()}>
              Galeri / file
            </Button>
            <Button icon={Camera} onClick={() => captureRef.current?.click()}>
              Ambil foto
            </Button>
            <Button icon={ScanLine} onClick={() => setCameraOpen(true)} className="hidden sm:inline-flex">
              Kamera langsung
            </Button>
            <Button icon={Sparkles} onClick={loadSample}>
              Contoh
            </Button>
          </div>
        </div>
      </div>

      {/* Bar lengket */}
      <div className="glass sticky top-[var(--header-h)] z-30 flex flex-col gap-3 rounded-2xl p-3 md:flex-row md:items-center md:justify-between">
        <div className="no-scrollbar flex items-center gap-2 overflow-x-auto">
          <span className="section-title hidden shrink-0 lg:block">Filter</span>
          <Segmented value={defFilter} onChange={setDefFilter} options={FILTERS} />
          <Button size="sm" icon={Wand2} onClick={applyFilterToAll} disabled={!pages.length}>
            Terapkan ke semua
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <select value={paper} onChange={(e) => setPaper(e.target.value as PageSizeName)} aria-label="Ukuran kertas" className="glass-input h-10 px-3 text-xs font-bold">
            <option value="A4">A4</option>
            <option value="Letter">Letter</option>
            <option value="Fit">Sesuai foto</option>
          </select>
          <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Nama file PDF" placeholder="Nama file" className="glass-input h-10 min-w-0 flex-1 px-3 md:w-44 md:flex-none" />
          <Button variant="success" icon={exporting ? Loader2 : Download} disabled={!pages.length || exporting} onClick={exportPdf}>
            PDF ({pages.length})
          </Button>
        </div>
      </div>

      {last && (
        <div className="glass flex flex-wrap items-center justify-between gap-3 rounded-2xl p-4">
          <p className="text-sm font-semibold">✓ {last.name} <span className="font-normal text-slate-500">· {formatBytes(last.blob.size)}</span></p>
          <div className="flex gap-2">
            {canShareFile(last.blob, last.name) && <Button icon={Share2} onClick={() => shareBlob(last.blob, last.name).catch(() => {})}>Bagikan</Button>}
            <Button icon={Download} onClick={() => saveBlob(last.blob, last.name)}>Unduh lagi</Button>
          </div>
        </div>
      )}

      {importing && (
        <p className="flex items-center gap-2 text-xs font-semibold text-indigo-600 dark:text-indigo-300">
          <Loader2 className="h-4 w-4 animate-spin" />
          {importing}
        </p>
      )}

      {pages.length ? (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pages.map((p, i) => (
            <li key={p.id} className="glass animate-slide-up flex flex-col overflow-hidden rounded-2xl">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-xs font-bold text-indigo-600 dark:text-indigo-300">Halaman {i + 1}</span>
                <div className="flex items-center">
                  <Button variant="ghost" size="sm" iconOnly icon={ArrowLeft} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Geser ke depan" />
                  <Button variant="ghost" size="sm" iconOnly icon={ArrowRight} disabled={i === pages.length - 1} onClick={() => move(i, 1)} aria-label="Geser ke belakang" />
                  <Button variant="ghost" size="sm" iconOnly icon={Crop} onClick={() => setCropId(p.id)} aria-label="Potong & luruskan" />
                  <Button variant="ghost" size="sm" iconOnly icon={RotateCw} onClick={() => update(p.id, { rotation: (((p.rotation + 90) % 360) as Rotation) })} aria-label="Putar 90°" />
                  <Button variant="danger" size="sm" iconOnly icon={Trash2} onClick={() => remove(p.id)} aria-label="Hapus halaman" />
                </div>
              </div>
              <div className="relative flex flex-1 items-center justify-center bg-slate-200/50 p-3 dark:bg-black/25">
                <img src={p.url} alt={`Halaman ${i + 1}`} className={cx('max-h-80 w-auto rounded-md border border-slate-300/60 object-contain shadow-md transition dark:border-white/10', p.busy && 'opacity-40')} />
                {p.busy && <Loader2 className="absolute h-7 w-7 animate-spin text-indigo-600" />}
              </div>
              <div className="p-2.5">
                <Segmented value={p.filter} onChange={(f) => update(p.id, { filter: f })} options={FILTERS} className="w-full" />
              </div>
            </li>
          ))}
        </ul>
      ) : (
        !importing && (
          <div className="glass rounded-3xl border-2 border-dashed border-slate-300/70 p-10 text-center dark:border-white/15">
            <FilePlus2 className="mx-auto h-11 w-11 text-indigo-500" />
            <h3 className="mt-3 text-base font-bold">Belum ada halaman</h3>
            <p className="mx-auto mt-1 max-w-sm text-xs text-slate-500 dark:text-slate-400">Ambil foto struk, kontrak, KTP, atau papan tulis. Filter “Dokumen” membuat kertas putih bersih meski pencahayaan miring.</p>
          </div>
        )
      )}

      <CameraModal open={cameraOpen} onClose={() => setCameraOpen(false)} onCapture={(raw) => { setCameraOpen(false); void addRaws([{ raw, name: `Kamera_${pages.length + 1}.jpg` }]); }} />
      <CropModal page={cropPage} onClose={() => setCropId(null)} onApply={(q) => { if (cropPage) void update(cropPage.id, { quad: q }); setCropId(null); }} />
    </section>
  );
}

// ───────────────────────── kamera langsung ─────────────────────────
function CameraModal({ open, onClose, onCapture }: { open: boolean; onClose: () => void; onCapture: (c: HTMLCanvasElement) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErr(null);
    setReady(false);
    let dead = false;
    let stream: MediaStream | undefined;
    (async () => {
      try {
        if (!navigator.mediaDevices?.getUserMedia) throw new Error('Peramban tidak mendukung akses kamera.');
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
        if (dead) return stream.getTracks().forEach((t) => t.stop());
        const v = videoRef.current;
        if (v) {
          v.srcObject = stream; // elemen sudah ter-mount saat effect berjalan (tidak ada race)
          await v.play().catch(() => {});
          setReady(true);
        }
      } catch (e) {
        if (!dead) setErr(e instanceof Error ? e.message : 'Kamera tidak tersedia atau izin ditolak. Gunakan “Ambil foto”.');
      }
    })();
    return () => {
      dead = true;
      stream?.getTracks().forEach((t) => t.stop()); // selalu matikan kamera saat modal ditutup/unmount
    };
  }, [open]);

  const shoot = () => {
    const v = videoRef.current;
    if (!v || !v.videoWidth) return;
    onCapture(drawToRaw(v, v.videoWidth, v.videoHeight));
  };

  return (
    <Modal open={open} onClose={onClose} wide title="Kamera pemindai" subtitle="Posisikan dokumen di dalam bingkai" footer={<Button variant="success" icon={ScanLine} disabled={!ready} onClick={shoot}>Jepret halaman</Button>}>
      {err ? (
        <p className="rounded-xl bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-300">{err}</p>
      ) : (
        <div className="relative mx-auto max-w-xl overflow-hidden rounded-2xl bg-black">
          <video ref={videoRef} autoPlay playsInline muted className="h-auto w-full" />
          <div className="pointer-events-none absolute inset-5 rounded-xl border-2 border-dashed border-emerald-400/80" />
          {!ready && <Loader2 className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 animate-spin text-white" />}
        </div>
      )}
    </Modal>
  );
}

// ───────────────────────── potong & luruskan ─────────────────────────
function CropModal({ page, onClose, onApply }: { page: ScanPage | null; onClose: () => void; onApply: (q: Quad | null) => void }) {
  const [quad, setQuad] = useState<Quad | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  const dragRef = useRef<number | null>(null);
  const raw = page?.raw;

  useEffect(() => {
    if (!page || !raw) return;
    setQuad(page.quad ?? defaultQuad(raw.width, raw.height));
    let url: string | null = null;
    let dead = false;
    canvasToBlob(raw, 'image/jpeg', 0.85).then((b) => {
      if (dead) return;
      url = URL.createObjectURL(b);
      setSrc(url);
    });
    return () => {
      dead = true;
      if (url) URL.revokeObjectURL(url);
      setSrc(null);
    };
  }, [page, raw]);

  const valid = useMemo(() => (quad ? squareToQuad(quad) !== null : false), [quad]);
  if (!page || !raw || !quad) return <Modal open={false} onClose={onClose} title="" children={null} />;

  const move = (e: React.PointerEvent) => {
    const i = dragRef.current;
    const img = imgRef.current;
    if (i === null || !img) return;
    const r = img.getBoundingClientRect();
    const x = Math.min(raw.width, Math.max(0, ((e.clientX - r.left) / r.width) * raw.width));
    const y = Math.min(raw.height, Math.max(0, ((e.clientY - r.top) / r.height) * raw.height));
    setQuad((q) => (q ? (q.map((p, k) => (k === i ? { x, y } : p)) as Quad) : q));
  };

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title="Potong & luruskan"
      subtitle="Seret 4 titik ke sudut dokumen"
      footer={
        <>
          <Button onClick={() => setQuad(defaultQuad(raw.width, raw.height, 0))}>Seluruh gambar</Button>
          <Button variant="primary" disabled={!valid} onClick={() => onApply(isFullQuad(quad, raw.width, raw.height, 2) ? null : quad)}>
            Terapkan
          </Button>
        </>
      }
    >
      <Field label="Tip: tarik titik hingga pas di tepi kertas. Hasilnya diluruskan otomatis.">
        <div className="mt-2 flex justify-center">
          <div className="relative inline-block touch-none select-none" onPointerMove={move} onPointerUp={() => (dragRef.current = null)} onPointerCancel={() => (dragRef.current = null)}>
            {src && <img ref={imgRef} src={src} alt="Dokumen" draggable={false} className="block max-h-[58dvh] max-w-full rounded-lg" />}
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${raw.width} ${raw.height}`} preserveAspectRatio="none">
              <polygon points={quad.map((p) => `${p.x},${p.y}`).join(' ')} fill="rgb(99 102 241 / 0.18)" stroke="#6366f1" strokeWidth={2.5} vectorEffect="non-scaling-stroke" />
            </svg>
            {quad.map((p, i) => (
              <div
                key={i}
                role="slider"
                aria-label={`Sudut ${['kiri-atas', 'kanan-atas', 'kanan-bawah', 'kiri-bawah'][i]}`}
                aria-valuenow={Math.round(p.x)}
                tabIndex={0}
                onPointerDown={(e) => {
                  dragRef.current = i;
                  (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
                }}
                className="absolute grid h-11 w-11 -translate-x-1/2 -translate-y-1/2 cursor-grab place-items-center active:cursor-grabbing"
                style={{ left: `${(p.x / raw.width) * 100}%`, top: `${(p.y / raw.height) * 100}%`, touchAction: 'none' }}
              >
                <span className="h-5 w-5 rounded-full border-[3px] border-white bg-indigo-600 shadow-lg ring-2 ring-indigo-600/40" />
              </div>
            ))}
          </div>
        </div>
      </Field>
    </Modal>
  );
}

// ───────────────────────── contoh dokumen ─────────────────────────
function makeSampleInvoice(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 1200;
  c.height = 1500;
  const ctx = c.getContext('2d')!;
  // meja gelap + cahaya miring
  ctx.fillStyle = '#3b3f4a';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.save();
  ctx.translate(600, 760);
  ctx.rotate((-3.5 * Math.PI) / 180);
  ctx.shadowColor = 'rgba(0,0,0,.5)';
  ctx.shadowBlur = 40;
  ctx.shadowOffsetY = 18;
  ctx.fillStyle = '#f4f0e6';
  ctx.fillRect(-440, -600, 880, 1200);
  ctx.shadowColor = 'transparent';
  ctx.fillStyle = '#1e293b';
  ctx.font = 'bold 44px sans-serif';
  ctx.fillText('FAKTUR / INVOICE', -380, -500);
  ctx.font = '26px monospace';
  ctx.fillStyle = '#334155';
  ['No        : INV-2026/OMNI/0892', `Tanggal   : ${new Date().toLocaleDateString('id-ID')}`, 'Pelanggan : PT Nusantara Digital Solusi'].forEach((t, i) => ctx.fillText(t, -380, -420 + i * 44));
  ctx.fillRect(-380, -270, 760, 3);
  [['1x Lisensi Enterprise', 'Rp 4.500.000'], ['1x Modul Scanner Offline', 'Rp 2.250.000'], ['1x PDF Studio Editor', 'Rp 1.750.000']].forEach((r, i) => {
    ctx.fillText(r[0], -380, -210 + i * 60);
    ctx.fillText(r[1], 140, -210 + i * 60);
  });
  ctx.fillRect(-380, -10, 760, 3);
  ctx.font = 'bold 30px monospace';
  ctx.fillText('TOTAL', -380, 50);
  ctx.fillText('Rp 8.500.000', 100, 50);
  ctx.strokeStyle = '#4f46e5';
  ctx.lineWidth = 6;
  ctx.strokeRect(150, 190, 240, 100);
  ctx.fillStyle = '#4f46e5';
  ctx.font = 'bold 36px sans-serif';
  ctx.fillText('LUNAS / PAID', 168, 252);
  ctx.restore();
  // bayangan gradien (pencahayaan tidak rata)
  const g = ctx.createLinearGradient(0, 0, c.width, 0);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.45)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, c.width, c.height);
  return c;
}
