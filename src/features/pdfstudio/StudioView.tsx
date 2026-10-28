import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Download, FilePlus2, FileSignature, FileUp, Highlighter, ImagePlus, Image as ImageIcon, Loader2, Minus, Plus, Redo2, Share2, Stamp, Trash2, Type, Undo2 } from 'lucide-react';
import { Button, cx } from '../../components/ui';
import { useToast } from '../../hooks/useToast';
import { loadImage } from '../../lib/converters/image';
import { openPdf, renderPageToCanvas } from '../../lib/converters/pdfjs';
import { bytesToBlob, canShareFile, saveBlob, shareBlob } from '../../lib/download';
import { imagesToPdf } from '../../lib/pdfBuild';
import { exportStudioPdf, getMetricsFonts, type MetricsFonts, type StudioElement, type StudioPage } from '../../lib/studio';
import { baseName } from '../../lib/formats';
import Inspector from './Inspector';
import SignatureModal, { type SignatureResult } from './SignatureModal';
import StudioCanvas, { useRaster } from './StudioCanvas';
import { StudioSources } from './sources';
import { useHistory } from './useHistory';

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const A4 = { w: 595.28, h: 841.89 };

interface Doc {
  pages: StudioPage[];
}

const newPage = (over: Partial<StudioPage> = {}): StudioPage => ({ id: uid(), source: null, width: A4.w, height: A4.h, elements: [], watermark: 'DRAFT', showWatermark: false, ...over });

async function fileToPageBg(file: File): Promise<{ dataUrl: string; w: number; h: number }> {
  const li = await loadImage(file);
  try {
    const max = 2000;
    const k = Math.min(1, max / Math.max(li.width, li.height));
    const c = document.createElement('canvas');
    c.width = Math.round(li.width * k);
    c.height = Math.round(li.height * k);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(li.img, 0, 0, c.width, c.height);
    const dataUrl = c.toDataURL('image/jpeg', 0.9);
    c.width = c.height = 0;
    return { dataUrl, w: li.width, h: li.height };
  } finally {
    li.dispose();
  }
}

function Thumb({ page, sources, active, index, total, onClick, onMove, onDelete }: { page: StudioPage; sources: StudioSources; active: boolean; index: number; total: number; onClick: () => void; onMove: (d: -1 | 1) => void; onDelete: () => void }) {
  const w = 92;
  const url = useRaster(sources, page, w * 2);
  const h = (page.height / page.width) * w;
  return (
    <div className="flex shrink-0 flex-col items-center gap-1">
      <button onClick={onClick} aria-label={`Halaman ${index + 1}`} className={cx('relative overflow-hidden rounded-lg bg-white shadow ring-2 transition', active ? 'ring-indigo-500' : 'ring-transparent hover:ring-indigo-300')} style={{ width: w, height: h }}>
        {url && <img src={url} alt="" draggable={false} className="h-full w-full" />}
        {page.elements.length > 0 && <span className="absolute right-1 top-1 rounded-full bg-indigo-600 px-1.5 text-[10px] font-bold text-white">{page.elements.length}</span>}
      </button>
      <div className="flex items-center gap-0.5">
        <Button size="sm" variant="ghost" iconOnly icon={ArrowLeft} className="!h-7 !w-7" disabled={index === 0} onClick={() => onMove(-1)} aria-label="Geser ke kiri" />
        <span className="w-6 text-center text-[11px] font-bold tabular-nums">{index + 1}</span>
        <Button size="sm" variant="ghost" iconOnly icon={ArrowRight} className="!h-7 !w-7" disabled={index === total - 1} onClick={() => onMove(1)} aria-label="Geser ke kanan" />
        <Button size="sm" variant="danger" iconOnly icon={Trash2} className="!h-7 !w-7" onClick={onDelete} aria-label="Hapus halaman" />
      </div>
    </div>
  );
}

export default function StudioView({ active, onWorkChange }: { active: boolean; onWorkChange: (n: number) => void }) {
  const toast = useToast();
  const sources = useMemo(() => new StudioSources(), []);
  const hist = useHistory<Doc>({ pages: [] });
  const { state, set, checkpoint, undo, redo, canUndo, canRedo } = hist;
  const [fonts, setFonts] = useState<MetricsFonts | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const [selId, setSelId] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [title, setTitle] = useState('Dokumen');
  const [sigOpen, setSigOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [flatten, setFlatten] = useState(false);
  const [last, setLast] = useState<{ blob: Blob; name: string } | null>(null);
  const [areaW, setAreaW] = useState(360);
  const [dragOver, setDragOver] = useState(false);
  const pdfRef = useRef<HTMLInputElement>(null);
  const imgPageRef = useRef<HTMLInputElement>(null);
  const imgElRef = useRef<HTMLInputElement>(null);
  const bgRef = useRef<HTMLInputElement>(null);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);

  const pages = state.pages;
  const page = pages[Math.min(pageIdx, pages.length - 1)] ?? null;
  const pIdx = page ? pages.indexOf(page) : 0;
  const selected = page?.elements.find((e) => e.id === selId) ?? null;

  useEffect(() => {
    getMetricsFonts().then(setFonts);
    return () => sources.dispose();
  }, [sources]);

  useEffect(() => onWorkChange(pages.length ? pages.length : 0), [pages.length, onWorkChange]);

  useEffect(() => {
    const el = areaRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setAreaW(el.clientWidth));
    ro.observe(el);
    setAreaW(el.clientWidth);
    return () => ro.disconnect();
  }, [pages.length > 0]);

  const fit = page ? Math.max(0.2, (areaW - 24) / page.width) : 1;
  const scale = fit * zoom;

  const updatePage = useCallback((id: string, fn: (p: StudioPage) => StudioPage, opts?: { transient?: boolean; key?: string }) => {
    set((d) => ({ pages: d.pages.map((p) => (p.id === id ? fn(p) : p)) }), opts);
  }, [set]);

  const patchEl = useCallback((id: string, patch: Partial<StudioElement>, transient: boolean, key?: string) => {
    if (!page) return;
    updatePage(page.id, (p) => ({ ...p, elements: p.elements.map((e) => (e.id === id ? ({ ...e, ...patch } as StudioElement) : e)) }), transient ? { transient: true } : { key });
  }, [page, updatePage]);

  const addEl = (el: StudioElement) => {
    if (!page) return;
    updatePage(page.id, (p) => ({ ...p, elements: [...p.elements, el] }));
    setSelId(el.id);
  };

  const center = (w: number, h: number) => (page ? { x: Math.max(8, (page.width - w) / 2), y: Math.max(8, page.height * 0.35 - h / 2) } : { x: 40, y: 40 });

  const addText = () => {
    if (!page) return;
    const w = Math.min(260, page.width - 60);
    addEl({ id: uid(), type: 'text', text: 'Ketuk dua kali untuk ubah teks', fontSize: 16, color: '#0f172a', bold: false, w, ...center(w, 24) });
    setTimeout(() => textRef.current?.focus(), 60);
  };
  const addStamp = () => {
    if (!page) return;
    addEl({ id: uid(), type: 'stamp', text: 'LUNAS', fontSize: 26, color: '#dc2626', ...center(140, 50) });
  };
  const addRect = () => {
    if (!page) return;
    addEl({ id: uid(), type: 'rect', w: 200, h: 24, color: '#facc15', opacity: 0.4, ...center(200, 24) });
  };
  const addSignature = (r: SignatureResult) => {
    if (!page) return;
    const w = Math.min(170, page.width * 0.4);
    const h = (w / r.w) * r.h;
    addEl({ id: uid(), type: 'signature', dataUrl: r.dataUrl, w, h, ...center(w, h) });
    setSigOpen(false);
  };

  const pickFiles = (input: HTMLInputElement | null) => input?.click();

  const openPdfs = async (files: File[]) => {
    const pdfs = files.filter((f) => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!pdfs.length) return toast('Pilih file PDF.', 'error');
    setBusy('Membuka PDF…');
    try {
      const added: StudioPage[] = [];
      for (const f of pdfs) {
        const { docId, sizes } = await sources.addPdf(f);
        sizes.forEach((s, i) => added.push(newPage({ source: { docId, index: i }, width: s.w, height: s.h })));
      }
      const wasEmpty = pages.length === 0;
      set((d) => ({ pages: [...d.pages, ...added] }));
      if (wasEmpty) {
        setTitle(baseName(pdfs[0].name));
        setPageIdx(0);
      } else setPageIdx(pages.length);
      setSelId(null);
      toast(`${added.length} halaman dimuat`);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal membuka PDF', 'error');
    } finally {
      setBusy(null);
    }
  };

  const addImagePages = async (files: File[]) => {
    if (!files.length) return;
    setBusy('Memuat gambar…');
    try {
      const added: StudioPage[] = [];
      for (const f of files) {
        const { dataUrl, w, h } = await fileToPageBg(f);
        const k = Math.min(1, A4.w / w, A4.h / h) || 1;
        // halaman seukuran gambar (skala ke maks A4), sehingga tidak ada ruang kosong
        const pw = w >= h ? Math.max(A4.w * 0.8, Math.min(A4.h, w * k)) : Math.min(A4.w, w * k);
        added.push(newPage({ width: pw, height: (pw / w) * h, bgDataUrl: dataUrl }));
      }
      const start = pages.length;
      set((d) => ({ pages: [...d.pages, ...added] }));
      setPageIdx(start);
      setSelId(null);
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal memuat gambar', 'error');
    } finally {
      setBusy(null);
    }
  };

  const addImageElement = async (file: File) => {
    if (!page) return;
    try {
      const { dataUrl, w, h } = await fileToPageBg(file);
      const ew = Math.min(200, page.width * 0.5);
      addEl({ id: uid(), type: 'image', dataUrl, w: ew, h: (ew / w) * h, ...center(ew, (ew / w) * h) });
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal memuat gambar', 'error');
    }
  };

  const setBackground = async (file: File) => {
    if (!page) return;
    try {
      const { dataUrl } = await fileToPageBg(file);
      updatePage(page.id, (p) => ({ ...p, bgDataUrl: dataUrl }));
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal memuat gambar', 'error');
    }
  };

  const addBlank = () => {
    const ref = page;
    const p = newPage(ref ? { width: ref.width, height: ref.height } : {});
    const at = pages.length ? pIdx + 1 : 0;
    set((d) => ({ pages: [...d.pages.slice(0, at), p, ...d.pages.slice(at)] }));
    setPageIdx(at);
    setSelId(null);
  };

  const movePage = (i: number, dir: -1 | 1) => {
    set((d) => {
      const a = [...d.pages];
      const j = i + dir;
      if (j < 0 || j >= a.length) return d;
      [a[i], a[j]] = [a[j], a[i]];
      return { pages: a };
    });
    setPageIdx(i + dir);
  };
  const deletePage = (i: number) => {
    set((d) => ({ pages: d.pages.filter((_, k) => k !== i) }));
    setPageIdx(Math.max(0, Math.min(i, pages.length - 2)));
    setSelId(null);
  };

  const deleteEl = useCallback(() => {
    if (!page || !selId) return;
    updatePage(page.id, (p) => ({ ...p, elements: p.elements.filter((e) => e.id !== selId) }));
    setSelId(null);
  }, [page, selId, updatePage]);

  const layer = (dir: 1 | -1) => {
    if (!page || !selId) return;
    updatePage(page.id, (p) => {
      const a = [...p.elements];
      const i = a.findIndex((e) => e.id === selId);
      const j = i + dir;
      if (i < 0 || j < 0 || j >= a.length) return p;
      [a[i], a[j]] = [a[j], a[i]];
      return { ...p, elements: a };
    });
  };

  // pintasan papan ketik hanya saat tab Studio aktif dan fokus tidak di kolom input
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable], [role=dialog]')) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        e.shiftKey ? redo() : undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (selId && (e.key === 'Delete' || e.key === 'Backspace')) {
        e.preventDefault();
        deleteEl();
      } else if (selId && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const el = page?.elements.find((x) => x.id === selId);
        if (el) patchEl(selId, { x: el.x + dx, y: el.y + dy }, false, `nudge-${selId}`);
      } else if (e.key === 'Escape') setSelId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, selId, page, undo, redo, deleteEl, patchEl]);

  const exportPdf = async (share: boolean) => {
    if (!pages.length) return;
    setBusy(flatten ? 'Meratakan halaman…' : 'Menyimpan PDF…');
    try {
      let bytes = await exportStudioPdf(pages, sources.bytes, title || 'Dokumen');
      if (flatten) {
        const doc = await openPdf(bytes);
        const imgs = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const pg = await doc.getPage(i);
          const vp = pg.getViewport({ scale: 1 });
          const k = Math.min(2.5, 2200 / Math.max(vp.width, vp.height));
          const canvas = await renderPageToCanvas(pg, k);
          const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Gagal merender halaman.'))), 'image/jpeg', 0.9));
          imgs.push({ bytes: new Uint8Array(await blob.arrayBuffer()), mime: 'jpeg' as const, width: canvas.width, height: canvas.height, ptWidth: vp.width, ptHeight: vp.height });
          canvas.width = canvas.height = 0;
          pg.cleanup();
        }
        void doc.loadingTask.destroy();
        bytes = await imagesToPdf(imgs, { pageSize: 'Fit', orientation: 'auto', title: title || 'Dokumen' });
      }
      const name = `${(title || 'Dokumen').replace(/[\\/:*?"<>|]+/g, '_')}.pdf`;
      const blob = bytesToBlob(bytes, 'application/pdf');
      setLast({ blob, name });
      if (share && canShareFile(blob, name)) {
        if (!(await shareBlob(blob, name))) saveBlob(blob, name);
      } else saveBlob(blob, name);
      toast('PDF tersimpan');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Gagal menyimpan PDF', 'error');
    } finally {
      setBusy(null);
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    void openPdfs(Array.from(e.dataTransfer.files));
  };

  const hasPages = pages.length > 0;

  return (
    <div className="space-y-4" onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={onDrop}>
      <input ref={pdfRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => { void openPdfs(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      <input ref={imgPageRef} type="file" accept="image/*,.heic,.heif" multiple hidden onChange={(e) => { void addImagePages(Array.from(e.target.files ?? [])); e.target.value = ''; }} />
      <input ref={imgElRef} type="file" accept="image/*,.heic,.heif" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void addImageElement(f); e.target.value = ''; }} />
      <input ref={bgRef} type="file" accept="image/*,.heic,.heif" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void setBackground(f); e.target.value = ''; }} />

      {!hasPages ? (
        <div className={cx('glass rounded-3xl p-6 text-center transition sm:p-10', dragOver && 'ring-2 ring-indigo-500')}>
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-gradient-to-br from-indigo-600 to-fuchsia-600 text-white shadow-lg shadow-indigo-500/30">
            <FileSignature className="h-7 w-7" />
          </div>
          <h2 className="mt-4 text-xl font-extrabold">PDF Studio</h2>
          <p className="mx-auto mt-1 max-w-md text-xs text-slate-500 dark:text-slate-400">
            Tambah teks, tanda tangan, stempel, gambar, sorotan, dan watermark di atas PDF. Halaman asli tetap vektor dan teksnya tetap bisa dipilih. Semua diproses di perangkatmu.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <Button variant="primary" icon={busy ? Loader2 : FileUp} disabled={!!busy} onClick={() => pickFiles(pdfRef.current)}>
              {busy ?? 'Buka PDF'}
            </Button>
            <Button icon={ImagePlus} onClick={() => pickFiles(imgPageRef.current)}>
              Mulai dari gambar
            </Button>
            <Button icon={FilePlus2} onClick={addBlank}>
              Halaman kosong
            </Button>
          </div>
          <p className="mt-4 text-[11px] text-slate-500">Tidak mendukung PDF yang diberi kata sandi. Teks asli di dalam PDF tidak bisa diedit, hanya ditimpa/ditambah.</p>
        </div>
      ) : (
        <>
          <div className="glass sticky top-[var(--header-h)] z-30 space-y-2 rounded-2xl p-3">
            <div className="no-scrollbar flex items-center gap-2 overflow-x-auto">
              <Button size="sm" icon={FileUp} onClick={() => pickFiles(pdfRef.current)} disabled={!!busy}>PDF</Button>
              <Button size="sm" icon={ImagePlus} onClick={() => pickFiles(imgPageRef.current)} disabled={!!busy}>Hal. gambar</Button>
              <Button size="sm" icon={FilePlus2} onClick={addBlank}>Kosong</Button>
              <span className="mx-1 h-5 w-px shrink-0 bg-slate-400/30" />
              <Button size="sm" variant="primary" icon={Type} onClick={addText}>Teks</Button>
              <Button size="sm" icon={FileSignature} onClick={() => setSigOpen(true)}>TTD</Button>
              <Button size="sm" icon={Stamp} onClick={addStamp}>Stempel</Button>
              <Button size="sm" icon={ImageIcon} onClick={() => pickFiles(imgElRef.current)}>Gambar</Button>
              <Button size="sm" icon={Highlighter} onClick={addRect}>Sorot</Button>
              <span className="mx-1 h-5 w-px shrink-0 bg-slate-400/30" />
              <Button size="sm" variant="ghost" iconOnly icon={Undo2} onClick={undo} disabled={!canUndo} aria-label="Urungkan" />
              <Button size="sm" variant="ghost" iconOnly icon={Redo2} onClick={redo} disabled={!canRedo} aria-label="Ulangi" />
              <Button size="sm" variant="ghost" iconOnly icon={Minus} onClick={() => setZoom((z) => Math.max(0.5, +(z - 0.25).toFixed(2)))} aria-label="Perkecil" />
              <span className="w-10 shrink-0 text-center text-[11px] font-bold tabular-nums">{Math.round(zoom * 100)}%</span>
              <Button size="sm" variant="ghost" iconOnly icon={Plus} onClick={() => setZoom((z) => Math.min(3, +(z + 0.25).toFixed(2)))} aria-label="Perbesar" />
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input value={title} onChange={(e) => setTitle(e.target.value)} aria-label="Nama file" className="glass-input h-10 min-w-0 flex-1 px-3 sm:max-w-xs" />
              <label className="flex shrink-0 items-center gap-1.5 text-[11px] font-semibold" title="Mengubah setiap halaman jadi gambar: teks tidak lagi bisa dipilih, tetapi tutupan (mis. kotak hitam) benar-benar menyembunyikan isi di bawahnya.">
                <input type="checkbox" checked={flatten} onChange={(e) => setFlatten(e.target.checked)} className="h-4 w-4 accent-indigo-600" />
                Ratakan jadi gambar
              </label>
              <div className="ml-auto flex gap-2">
                {last && canShareFile(last.blob, last.name) && <Button iconOnly icon={Share2} onClick={() => shareBlob(last.blob, last.name)} aria-label="Bagikan" />}
                <Button variant="success" icon={busy ? Loader2 : Download} disabled={!!busy} onClick={() => exportPdf(false)}>
                  {busy ?? 'Simpan PDF'}
                </Button>
              </div>
            </div>
          </div>

          <div className="flex flex-col gap-4 lg:flex-row">
            <div className="min-w-0 flex-1 space-y-3">
              <div ref={areaRef} className="glass overflow-auto rounded-2xl p-3" style={{ maxHeight: 'calc(100dvh - var(--header-h) - 230px)', minHeight: 320 }}>
                <div className="flex w-max min-w-full justify-center">
                  {page && fonts && (
                    <StudioCanvas
                      key={page.id}
                      page={page}
                      scale={scale}
                      fonts={fonts}
                      sources={sources}
                      selectedId={selId}
                      onSelect={setSelId}
                      onCheckpoint={checkpoint}
                      onPatch={(id, patch, tr) => patchEl(id, patch, tr)}
                      onEditText={(id) => {
                        setSelId(id);
                        setTimeout(() => textRef.current?.focus(), 30);
                      }}
                    />
                  )}
                </div>
              </div>

              <div className="glass no-scrollbar flex gap-3 overflow-x-auto rounded-2xl p-3">
                {pages.map((p, i) => (
                  <Thumb key={p.id} page={p} sources={sources} index={i} total={pages.length} active={i === pIdx} onClick={() => { setPageIdx(i); setSelId(null); }} onMove={(d) => movePage(i, d)} onDelete={() => deletePage(i)} />
                ))}
              </div>
            </div>

            <aside className="glass h-fit rounded-2xl p-4 lg:sticky lg:top-[calc(var(--header-h)+150px)] lg:w-72 lg:shrink-0">
              <Inspector
                el={selected}
                page={page}
                textRef={textRef}
                onPatch={(patch, key) => selected && patchEl(selected.id, patch, false, key)}
                onDelete={deleteEl}
                onLayer={layer}
                onPagePatch={(patch, key) => page && updatePage(page.id, (p) => ({ ...p, ...patch }), { key })}
                onPickBackground={() => pickFiles(bgRef.current)}
              />
            </aside>
          </div>
        </>
      )}

      <SignatureModal open={sigOpen} onClose={() => setSigOpen(false)} onDone={addSignature} />
    </div>
  );
}
