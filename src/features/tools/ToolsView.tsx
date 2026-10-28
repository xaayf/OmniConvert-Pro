import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, Combine, Download, FilePlus2, FileText, Image as ImageIcon, Loader2, Scissors, Share2, Trash2, Undo2 } from 'lucide-react';

import { Button, Segmented, cx } from '../../components/ui';
import { useToast } from '../../hooks/useToast';
import { canvasToBlob, loadImage } from '../../lib/converters/image';
import { openPdf, renderPageToCanvas } from '../../lib/converters/pdfjs';
import { blobToBytes, bytesToBlob, canShareFile, saveBlob, shareBlob, zipEntries } from '../../lib/download';
import { baseName, formatBytes, isImageExt, getExt } from '../../lib/formats';
import { extractPages, invertSelection, mergeParts, parseRanges, loadPdf, type MergePart } from '../../lib/pdfTools';

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '_') || 'dokumen';

type Mode = 'merge' | 'split';

interface Item {
  id: string;
  name: string;
  size: number;
  part: MergePart;
  pages: number;
  thumb?: string;
}

async function imageToPart(file: File): Promise<MergePart & { kind: 'image' }> {
  const li = await loadImage(file);
  try {
    const k = Math.min(1, 2400 / Math.max(li.width, li.height));
    const c = document.createElement('canvas');
    c.width = Math.round(li.width * k);
    c.height = Math.round(li.height * k);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(li.img, 0, 0, c.width, c.height);
    const blob = await canvasToBlob(c, 'image/jpeg', 0.9);
    const part = { kind: 'image' as const, name: file.name, bytes: await blobToBytes(blob), mime: 'jpeg' as const, width: c.width, height: c.height };
    c.width = c.height = 0;
    return part;
  } finally {
    li.dispose();
  }
}

async function thumbOf(bytes: Uint8Array): Promise<string | undefined> {
  const doc = await openPdf(bytes);
  try {
    const page = await doc.getPage(1);
    const vp = page.getViewport({ scale: 1 });
    const canvas = await renderPageToCanvas(page, 120 / vp.width);
    const blob = await canvasToBlob(canvas, 'image/jpeg', 0.7);
    canvas.width = canvas.height = 0;
    return URL.createObjectURL(blob);
  } finally {
    void doc.loadingTask.destroy();
  }
}

export default function ToolsView({ onWorkChange }: { active: boolean; onWorkChange: (n: number) => void }) {
  const toast = useToast();
  const [mode, setMode] = useState<Mode>('merge');
  return (
    <section className="space-y-5">
      <div className="glass rounded-3xl p-5 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="rounded-full bg-indigo-500/15 px-2.5 py-1 text-[11px] font-bold text-indigo-600 dark:text-indigo-300">Alat PDF offline</span>
            <h2 className="mt-2 text-xl font-extrabold">Gabung & Pisah PDF</h2>
            <p className="mt-1 max-w-xl text-xs text-slate-500 dark:text-slate-400">Satukan beberapa PDF/gambar jadi satu file, atau ambil/pecah halaman tertentu. Rotasi dan ukuran halaman asli tetap terjaga.</p>
          </div>
          <Segmented
            value={mode}
            onChange={setMode}
            options={[
              { value: 'merge', label: 'Gabung' },
              { value: 'split', label: 'Pisah' }
            ]}
          />
        </div>
      </div>
      <div hidden={mode !== 'merge'}>
        <MergePanel toast={toast} onWorkChange={mode === 'merge' ? onWorkChange : () => {}} />
      </div>
      <div hidden={mode !== 'split'}>
        <SplitPanel toast={toast} />
      </div>
    </section>
  );
}

type Toast = ReturnType<typeof useToast>;

function MergePanel({ toast, onWorkChange }: { toast: Toast; onWorkChange: (n: number) => void }) {
  const [items, setItems] = useState<Item[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [title, setTitle] = useState('Gabungan');
  const [last, setLast] = useState<{ blob: Blob; name: string } | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;

  useEffect(() => onWorkChange(items.length), [items.length, onWorkChange]);
  useEffect(() => () => itemsRef.current.forEach((i) => i.thumb && URL.revokeObjectURL(i.thumb)), []);

  const add = async (files: FileList | File[]) => {
    const list = Array.from(files);
    if (!list.length) return;
    setBusy('Membaca file…');
    const added: Item[] = [];
    for (const f of list) {
      try {
        const ext = getExt(f.name);
        if (ext === 'pdf') {
          const bytes = new Uint8Array(await f.arrayBuffer());
          const d = await loadPdf(bytes, f.name);
          added.push({ id: uid(), name: f.name, size: f.size, part: { kind: 'pdf', name: f.name, bytes }, pages: d.getPageCount(), thumb: await thumbOf(bytes).catch(() => undefined) });
        } else if (isImageExt(ext)) {
          const part = await imageToPart(f);
          added.push({ id: uid(), name: f.name, size: f.size, part, pages: 1, thumb: URL.createObjectURL(bytesToBlob(part.bytes, 'image/jpeg')) });
        } else toast(`${f.name}: hanya PDF atau gambar.`, 'error');
      } catch (e) {
        toast(e instanceof Error ? e.message : `${f.name}: gagal dibaca`, 'error');
      }
    }
    setItems((p) => [...p, ...added]);
    setBusy(null);
  };

  const move = (i: number, d: -1 | 1) =>
    setItems((p) => {
      const a = [...p];
      const j = i + d;
      if (j < 0 || j >= a.length) return p;
      [a[i], a[j]] = [a[j], a[i]];
      return a;
    });
  const remove = (id: string) =>
    setItems((p) => {
      const it = p.find((x) => x.id === id);
      if (it?.thumb) URL.revokeObjectURL(it.thumb);
      return p.filter((x) => x.id !== id);
    });

  const totalPages = items.reduce((n, i) => n + i.pages, 0);

  const run = async () => {
    if (items.length < 1) return;
    setBusy('Menggabungkan…');
    try {
      const bytes = await mergeParts(items.map((i) => i.part), title);
      const name = `${safe(title)}.pdf`;
      const blob = bytesToBlob(bytes, 'application/pdf');
      setLast({ blob, name });
      saveBlob(blob, name);
      toast(`${totalPages} halaman digabung`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal menggabungkan', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="space-y-4">
      <input ref={ref} type="file" hidden multiple accept="application/pdf,.pdf,image/*,.heic,.heif" onChange={(e) => { if (e.target.files) void add(e.target.files); e.target.value = ''; }} />
      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => { e.preventDefault(); void add(e.dataTransfer.files); }}
        className="glass flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-indigo-400/40 p-6 text-center"
      >
        <Button variant="primary" icon={busy ? Loader2 : FilePlus2} disabled={!!busy} onClick={() => ref.current?.click()}>
          {busy ?? 'Tambah PDF / gambar'}
        </Button>
        <p className="text-[11px] text-slate-500">Bisa banyak file sekaligus, atau seret ke sini. Urutkan dengan tombol panah.</p>
      </div>

      {items.length > 0 && (
        <>
          <div className="glass sticky top-[var(--header-h)] z-30 flex flex-wrap items-center gap-2 rounded-2xl p-3">
            <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Nama file hasil" className="glass-input h-10 min-w-0 flex-1 px-3 sm:max-w-xs" />
            <span className="text-[11px] font-semibold text-slate-500">{items.length} file · {totalPages} halaman</span>
            <div className="ml-auto flex gap-2">
              {last && canShareFile(last.blob, last.name) && <Button iconOnly icon={Share2} onClick={() => shareBlob(last.blob, last.name)} aria-label="Bagikan" />}
              <Button variant="success" icon={busy ? Loader2 : Combine} disabled={!!busy} onClick={run}>Gabung jadi PDF</Button>
            </div>
          </div>
          <ul className="grid gap-3 sm:grid-cols-2">
            {items.map((it, i) => (
              <li key={it.id} className="glass flex items-center gap-3 rounded-2xl p-3">
                <div className="grid h-16 w-12 shrink-0 place-items-center overflow-hidden rounded-lg bg-white shadow">
                  {it.thumb ? <img src={it.thumb} alt="" className="h-full w-full object-contain" /> : <FileText className="h-5 w-5 text-slate-400" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold">{it.name}</p>
                  <p className="flex items-center gap-1 text-[11px] text-slate-500">
                    {it.part.kind === 'image' ? <ImageIcon className="h-3 w-3" /> : <FileText className="h-3 w-3" />}
                    {it.pages} hal. · {formatBytes(it.size)}
                  </p>
                </div>
                <div className="flex shrink-0">
                  <Button size="sm" variant="ghost" iconOnly icon={ArrowUp} disabled={i === 0} onClick={() => move(i, -1)} aria-label="Naik" />
                  <Button size="sm" variant="ghost" iconOnly icon={ArrowDown} disabled={i === items.length - 1} onClick={() => move(i, 1)} aria-label="Turun" />
                  <Button size="sm" variant="danger" iconOnly icon={Trash2} onClick={() => remove(it.id)} aria-label="Hapus" />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function SplitPanel({ toast }: { toast: Toast }) {
  const [file, setFile] = useState<{ name: string; bytes: Uint8Array; pages: number } | null>(null);
  const [thumbs, setThumbs] = useState<(string | null)[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [ranges, setRanges] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const ref = useRef<HTMLInputElement>(null);
  const urls = useRef<string[]>([]);
  const gen = useRef(0);

  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);

  const open = async (f: File) => {
    setBusy('Membuka PDF…');
    const my = ++gen.current;
    try {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const d = await loadPdf(bytes, f.name);
      urls.current.forEach((u) => URL.revokeObjectURL(u));
      urls.current = [];
      const pages = d.getPageCount();
      setFile({ name: f.name, bytes, pages });
      setThumbs(Array(pages).fill(null));
      setSel(new Set());
      setRanges('');
      setBusy(null);
      // thumbnail dibuat bertahap di latar belakang
      const doc = await openPdf(bytes);
      try {
        for (let i = 1; i <= pages && gen.current === my; i++) {
          const page = await doc.getPage(i);
          const vp = page.getViewport({ scale: 1 });
          const canvas = await renderPageToCanvas(page, 140 / vp.width);
          const blob = await canvasToBlob(canvas, 'image/jpeg', 0.7);
          canvas.width = canvas.height = 0;
          page.cleanup();
          const url = URL.createObjectURL(blob);
          urls.current.push(url);
          setThumbs((t) => (gen.current === my ? t.map((x, k) => (k === i - 1 ? url : x)) : t));
        }
      } finally {
        void doc.loadingTask.destroy();
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal membuka PDF', 'error');
      setBusy(null);
    }
  };

  const toggle = (i: number) =>
    setSel((s) => {
      const n = new Set(s);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });

  const sorted = useMemo(() => [...sel].sort((a, b) => a - b), [sel]);
  const out = file ? safe(baseName(file.name)) : 'dokumen';

  const run = useCallback(
    async (label: string, job: () => Promise<{ blob: Blob; name: string }>) => {
      setBusy(label);
      try {
        const r = await job();
        saveBlob(r.blob, r.name);
        toast('Selesai');
      } catch (e) {
        toast(e instanceof Error ? e.message : 'Gagal', 'error');
      } finally {
        setBusy(null);
      }
    },
    [toast]
  );

  const pdfBlob = (b: Uint8Array) => bytesToBlob(b, 'application/pdf');

  const extractSel = () =>
    run('Mengekstrak…', async () => ({ blob: pdfBlob(await extractPages(file!.bytes, sorted, `${out} (ekstrak)`)), name: `${out}_halaman.pdf` }));
  const deleteSel = () =>
    run('Memproses…', async () => {
      const keep = invertSelection(file!.pages, sel);
      if (!keep.length) throw new Error('Tidak boleh membuang semua halaman.');
      return { blob: pdfBlob(await extractPages(file!.bytes, keep, out)), name: `${out}_tanpa_halaman.pdf` };
    });
  const eachPage = () =>
    run('Memisah…', async () => {
      const digits = String(file!.pages).length;
      const entries = [];
      for (let i = 0; i < file!.pages; i++) entries.push({ name: `${out}_${String(i + 1).padStart(digits, '0')}.pdf`, data: await extractPages(file!.bytes, [i], out) });
      return { blob: zipEntries(entries), name: `${out}_per_halaman.zip` };
    });
  const byRanges = () =>
    run('Memisah…', async () => {
      const groups = parseRanges(ranges, file!.pages);
      if (!groups.length) throw new Error('Isi rentang dulu, mis. 1-3, 4-6, 7-');
      const entries = [];
      for (const g of groups) {
        const label = g.length === 1 ? `${g[0] + 1}` : `${g[0] + 1}-${g[g.length - 1] + 1}`;
        entries.push({ name: `${out}_hal_${label}.pdf`, data: await extractPages(file!.bytes, g, out) });
      }
      return entries.length === 1 ? { blob: pdfBlob(entries[0].data), name: entries[0].name } : { blob: zipEntries(entries), name: `${out}_rentang.zip` };
    });
  const applyRanges = () => {
    try {
      const g = parseRanges(ranges, file!.pages);
      setSel(new Set(g.flat()));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Rentang tidak valid', 'error');
    }
  };

  return (
    <div className="space-y-4">
      <input ref={ref} type="file" hidden accept="application/pdf,.pdf" onChange={(e) => { const f = e.target.files?.[0]; if (f) void open(f); e.target.value = ''; }} />
      {!file ? (
        <div onDragOver={(e) => e.preventDefault()} onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) void open(f); }} className="glass flex flex-col items-center gap-3 rounded-3xl border-2 border-dashed border-indigo-400/40 p-8 text-center">
          <Button variant="primary" icon={busy ? Loader2 : Scissors} disabled={!!busy} onClick={() => ref.current?.click()}>{busy ?? 'Pilih PDF'}</Button>
          <p className="text-[11px] text-slate-500">Satu PDF per sesi. Tidak mendukung PDF berkata sandi.</p>
        </div>
      ) : (
        <>
          <div className="glass sticky top-[var(--header-h)] z-30 space-y-2 rounded-2xl p-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 basis-full truncate text-sm font-bold">{file.name} <span className="text-[11px] font-medium text-slate-500">· {file.pages} hal. · {sel.size} dipilih</span></span>
              <Button size="sm" icon={Undo2} onClick={() => ref.current?.click()} disabled={!!busy}>Ganti PDF</Button>
              <Button size="sm" onClick={() => setSel(new Set(Array.from({ length: file.pages }, (_, i) => i)))}>Pilih semua</Button>
              <Button size="sm" variant="ghost" onClick={() => setSel(new Set())}>Kosongkan</Button>
            </div>
            <div className="no-scrollbar flex items-center gap-2 overflow-x-auto">
              <Button size="sm" variant="primary" icon={busy ? Loader2 : Download} disabled={!sel.size || !!busy} onClick={extractSel}>Ekstrak terpilih ({sel.size})</Button>
              <Button size="sm" icon={Trash2} disabled={!sel.size || !!busy} onClick={deleteSel}>Buang terpilih</Button>
              <Button size="sm" icon={Scissors} disabled={!!busy} onClick={eachPage}>Tiap halaman → ZIP</Button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input value={ranges} onChange={(e) => setRanges(e.target.value)} placeholder="Rentang: 1-3, 5, 8-" aria-label="Rentang halaman" className="glass-input h-10 min-w-0 flex-1 px-3 sm:max-w-xs" />
              <Button size="sm" onClick={applyRanges} disabled={!ranges.trim()}>Pilih rentang</Button>
              <Button size="sm" icon={Scissors} onClick={byRanges} disabled={!ranges.trim() || !!busy}>Pisah per rentang</Button>
            </div>
            {busy && <p className="flex items-center gap-1.5 text-[11px] font-semibold text-indigo-600"><Loader2 className="h-3 w-3 animate-spin" />{busy}</p>}
          </div>

          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8">
            {Array.from({ length: file.pages }, (_, i) => (
              <li key={i}>
                <button onClick={() => toggle(i)} aria-pressed={sel.has(i)} aria-label={`Halaman ${i + 1}`} className={cx('relative block w-full overflow-hidden rounded-xl bg-white shadow ring-2 transition', sel.has(i) ? 'ring-indigo-500' : 'ring-transparent hover:ring-indigo-300')} style={{ aspectRatio: '3 / 4' }}>
                  {thumbs[i] ? <img src={thumbs[i]!} alt="" draggable={false} className="h-full w-full object-contain" /> : <span className="absolute inset-0 grid place-items-center"><Loader2 className="h-4 w-4 animate-spin text-slate-300" /></span>}
                  {sel.has(i) && <span className="absolute right-1 top-1 grid h-5 w-5 place-items-center rounded-full bg-indigo-600 text-white"><Check className="h-3 w-3" /></span>}
                </button>
                <p className="mt-1 text-center text-[11px] font-bold tabular-nums text-slate-500">{i + 1}</p>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

