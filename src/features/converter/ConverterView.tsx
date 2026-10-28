import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Archive,
  ArrowRight,
  Download,
  Eye,
  FileCode,
  FileSpreadsheet,
  FileText,
  Image as ImageIcon,
  Layers,
  Loader2,
  RefreshCw,
  Search,
  Settings2,
  Share2,
  Sparkles,
  Trash2,
  Upload,
  X
} from 'lucide-react';
import { unzipSync } from 'fflate';
import { Button, Field, Modal, Segmented, cx } from '../../components/ui';
import { useToast } from '../../hooks/useToast';
import { convertFile, DEFAULT_SETTINGS, type ConvertResult, type ConvertSettings } from '../../lib/converters';
import { renderPdfPreview } from '../../lib/converters/pdfjs';
import { canShareFile, saveBlob, shareBlob, zipEntries, blobToBytes } from '../../lib/download';
import { CATEGORY_LABEL, formatBytes, getFileKind, type Category, type FileKind } from '../../lib/formats';
import { createSampleFiles } from '../../lib/samples';

type Status = 'idle' | 'converting' | 'done' | 'error';

interface Item {
  id: string;
  file: File;
  kind: FileKind;
  target: string;
  status: Status;
  progress: number | null;
  settings: ConvertSettings;
  result?: ConvertResult;
  resultUrl?: string;
  error?: string;
  thumb?: string;
}

const CAT_STYLE: Record<Category, { icon: typeof FileText; tint: string }> = {
  IMAGE: { icon: ImageIcon, tint: 'bg-pink-500/15 text-pink-600 dark:text-pink-300' },
  DOCUMENT: { icon: FileText, tint: 'bg-sky-500/15 text-sky-600 dark:text-sky-300' },
  DATA: { icon: FileSpreadsheet, tint: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-300' }
};

const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function relevant(it: Pick<Item, 'kind' | 'target'>) {
  const fromImage = it.kind.category === 'IMAGE';
  const pdfToImg = it.kind.ext === 'pdf' && (it.target === 'PNG' || it.target === 'JPG');
  return {
    quality: (fromImage && ['JPG', 'WEBP', 'PDF'].includes(it.target)) || (pdfToImg && it.target === 'JPG'),
    scale: fromImage || pdfToImg,
    gray: fromImage || pdfToImg,
    page: it.target === 'PDF',
    fit: fromImage && it.target === 'PDF'
  };
}

async function pool<T>(items: T[], limit: number, fn: (x: T) => Promise<void>) {
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) await fn(items[i++]);
  });
  await Promise.all(workers);
}

export default function ConverterView({ onWorkChange }: { active: boolean; onWorkChange: (n: number) => void }) {
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const itemsRef = useRef<Item[]>([]);
  itemsRef.current = items;
  const [tab, setTab] = useState<'ALL' | Category>('ALL');
  const [query, setQuery] = useState('');
  const [dragging, setDragging] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => onWorkChange(items.length), [items.length, onWorkChange]);

  const patch = useCallback((id: string, p: Partial<Item>) => setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...p } : it))), []);

  const dropResult = (it: Item) => {
    if (it.resultUrl) URL.revokeObjectURL(it.resultUrl);
  };

  const addFiles = useCallback(
    (list: FileList | File[]) => {
      const files = Array.from(list);
      if (!files.length) return;
      const news: Item[] = files.map((file) => {
        const kind = getFileKind(file.name);
        return {
          id: uid(),
          file,
          kind,
          target: kind.targets[0] ?? '',
          status: kind.supported ? 'idle' : 'error',
          progress: null,
          settings: { ...DEFAULT_SETTINGS },
          error: kind.supported ? undefined : kind.reason,
          thumb: kind.category === 'IMAGE' && kind.ext !== 'heic' && kind.ext !== 'heif' ? URL.createObjectURL(file) : undefined
        };
      });
      setItems((prev) => [...news, ...prev]);
      const bad = news.filter((n) => !n.kind.supported).length;
      toast(`${news.length - bad} file masuk antrean${bad ? `, ${bad} tidak didukung` : ''}`, bad ? 'info' : 'success');
    },
    [toast]
  );

  const remove = (id: string) => {
    const it = itemsRef.current.find((x) => x.id === id);
    if (it) {
      dropResult(it);
      if (it.thumb) URL.revokeObjectURL(it.thumb);
    }
    setItems((p) => p.filter((x) => x.id !== id));
  };

  const clearAll = () => {
    itemsRef.current.forEach((it) => {
      dropResult(it);
      if (it.thumb) URL.revokeObjectURL(it.thumb);
    });
    setItems([]);
  };

  const invalidate = (id: string, p: Partial<Item>) => {
    const it = itemsRef.current.find((x) => x.id === id);
    if (it) dropResult(it);
    patch(id, { status: 'idle', result: undefined, resultUrl: undefined, error: undefined, progress: null, ...p });
  };

  const run = useCallback(
    async (id: string) => {
      const it = itemsRef.current.find((x) => x.id === id);
      if (!it || !it.kind.supported || it.status === 'converting') return;
      dropResult(it);
      patch(id, { status: 'converting', progress: null, error: undefined, result: undefined, resultUrl: undefined });
      try {
        const res = await convertFile(it.file, it.target, it.settings, (p) => patch(id, { progress: p }));
        patch(id, { status: 'done', progress: 100, result: res, resultUrl: URL.createObjectURL(res.blob) });
      } catch (e) {
        console.error(e);
        patch(id, { status: 'error', progress: null, error: e instanceof Error ? e.message : 'Konversi gagal.' });
      }
    },
    [patch]
  );

  const runAll = async () => {
    const todo = itemsRef.current.filter((i) => i.kind.supported && i.status !== 'done' && i.status !== 'converting').map((i) => i.id);
    if (!todo.length) return toast('Semua file sudah dikonversi', 'info');
    await pool(todo, 2, run); // maksimal 2 paralel agar memori ponsel aman
    const failed = itemsRef.current.filter((i) => todo.includes(i.id) && i.status === 'error').length;
    toast(failed ? `${todo.length - failed} berhasil, ${failed} gagal` : `${todo.length} file selesai dikonversi`, failed ? 'error' : 'success');
  };

  const downloadAll = async () => {
    const done = itemsRef.current.filter((i) => i.status === 'done' && i.result);
    if (!done.length) return;
    if (done.length === 1) return saveBlob(done[0].result!.blob, done[0].result!.fileName);
    const entries = await Promise.all(done.map(async (i) => ({ name: i.result!.fileName, data: await blobToBytes(i.result!.blob) })));
    saveBlob(zipEntries(entries), `OmniConvert_hasil_${done.length}_file.zip`);
    toast(`${done.length} file diunduh dalam satu ZIP`);
  };

  const loadSamples = async () => addFiles(await createSampleFiles());

  const setGlobalTarget = (t: string) => {
    if (!t) return;
    let n = 0;
    itemsRef.current.forEach((it) => {
      if (it.kind.targets.includes(t) && it.target !== t) {
        invalidate(it.id, { target: t });
        n++;
      }
    });
    toast(n ? `Target ${t} diterapkan ke ${n} file` : `Tidak ada file yang bisa diubah ke ${t}`, n ? 'success' : 'info');
  };

  const allTargets = useMemo(() => Array.from(new Set(items.flatMap((i) => i.kind.targets))).sort(), [items]);
  const visible = items.filter(
    (i) => (tab === 'ALL' || i.kind.category === tab) && (!query || `${i.file.name} ${i.kind.ext} ${i.target}`.toLowerCase().includes(query.toLowerCase()))
  );
  const stats = {
    total: items.length,
    done: items.filter((i) => i.status === 'done').length,
    busy: items.filter((i) => i.status === 'converting').length,
    bytes: items.reduce((a, b) => a + b.file.size, 0)
  };

  const settingsItem = items.find((i) => i.id === settingsId) ?? null;
  const previewItem = items.find((i) => i.id === previewId) ?? null;

  return (
    <section
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
      }}
      className="space-y-5"
    >
      <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />

      {/* Dropzone */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && inputRef.current?.click()}
        className={cx(
          'glass group cursor-pointer rounded-3xl border-2 border-dashed text-center transition-all',
          items.length ? 'p-5' : 'p-8 sm:p-12',
          dragging ? 'scale-[1.01] border-indigo-500 bg-indigo-500/10' : 'border-slate-300/80 hover:border-indigo-500 dark:border-white/15'
        )}
      >
        <div className={cx('mx-auto flex max-w-xl items-center gap-4', items.length ? 'flex-row text-left' : 'flex-col')}>
          <div className={cx('grid shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-indigo-500/20 to-fuchsia-500/20 transition group-hover:scale-105', items.length ? 'h-12 w-12' : 'h-16 w-16')}>
            <Upload className={cx('text-indigo-600 dark:text-indigo-300', items.length ? 'h-6 w-6' : 'h-8 w-8')} />
          </div>
          <div className="min-w-0">
            <h2 className={cx('font-bold', items.length ? 'text-sm' : 'text-lg sm:text-xl')}>Seret file ke sini, atau ketuk untuk memilih</h2>
            <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
              Batch sekaligus · file tidak pernah diunggah ke server
              {!items.length && (
                <>
                  {' '}·{' '}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      void loadSamples();
                    }}
                    className="inline-flex items-center gap-1 font-semibold text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-300"
                  >
                    <Sparkles className="h-3 w-3" /> coba file contoh
                  </button>
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {items.length > 0 && (
        <>
          {/* Toolbar lengket */}
          <div className="glass sticky top-[var(--header-h)] z-30 -mx-1 flex flex-col gap-3 rounded-2xl p-3 lg:flex-row lg:items-center lg:justify-between">
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto">
              {([['ALL', `Semua (${items.length})`], ['DOCUMENT', 'Dokumen'], ['IMAGE', 'Gambar'], ['DATA', 'Data']] as const).map(([id, label]) => (
                <button
                  key={id}
                  onClick={() => setTab(id)}
                  className={cx('whitespace-nowrap rounded-xl px-3.5 py-2 text-xs font-semibold transition', tab === id ? 'bg-indigo-600 text-white shadow' : 'glass-chip text-slate-600 dark:text-slate-300')}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative min-w-[8rem] flex-1 sm:flex-none">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Cari…" className="glass-input h-10 w-full pl-9 pr-3 sm:w-40" />
              </div>
              <label className="glass-chip flex h-10 items-center gap-2 rounded-xl px-3 text-xs">
                <span className="text-slate-500 dark:text-slate-400">Ubah semua ke</span>
                <select value="" onChange={(e) => setGlobalTarget(e.target.value)} className="bg-transparent font-bold text-indigo-600 outline-none dark:text-indigo-300">
                  <option value="">pilih…</option>
                  {allTargets.map((t) => (
                    <option key={t} value={t} className="text-slate-900">
                      {t}
                    </option>
                  ))}
                </select>
              </label>
              <Button variant="danger" iconOnly icon={Trash2} onClick={clearAll} aria-label="Kosongkan antrean" />
            </div>
          </div>

          {/* Daftar */}
          <ul className="space-y-3">
            {visible.map((it) => (
              <ItemCard key={it.id} it={it} onRun={() => run(it.id)} onRemove={() => remove(it.id)} onSettings={() => setSettingsId(it.id)} onPreview={() => setPreviewId(it.id)} onTarget={(t) => invalidate(it.id, { target: t })} />
            ))}
            {!visible.length && <li className="glass rounded-2xl p-8 text-center text-sm text-slate-500">Tidak ada file yang cocok dengan filter.</li>}
          </ul>

          {/* Aksi massal */}
          <div className="glass-strong sticky bottom-3 z-30 flex flex-col items-stretch justify-between gap-3 rounded-3xl p-4 sm:flex-row sm:items-center">
            <div className="flex items-center gap-3">
              <div className="grid h-11 w-11 place-items-center rounded-2xl bg-indigo-500/15 text-indigo-600 dark:text-indigo-300">
                <Layers className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-bold">
                  {stats.total} file · {formatBytes(stats.bytes)}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {stats.done} selesai · {stats.total - stats.done} menunggu
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 sm:justify-end">
              {stats.done > 0 && (
                <Button variant="success" icon={stats.done > 1 ? Archive : Download} onClick={downloadAll}>
                  {stats.done > 1 ? `Unduh ZIP (${stats.done})` : 'Unduh'}
                </Button>
              )}
              <Button variant="primary" icon={stats.busy ? Loader2 : RefreshCw} disabled={stats.busy > 0} onClick={runAll} className="flex-1 sm:flex-none">
                Konversi semua
              </Button>
            </div>
          </div>
        </>
      )}

      {!items.length && <FormatDirectory />}

      <SettingsModal item={settingsItem} onClose={() => setSettingsId(null)} onChange={(s) => settingsItem && invalidate(settingsItem.id, { settings: s })} />
      <PreviewModal item={previewItem} onClose={() => setPreviewId(null)} />
    </section>
  );
}

// ───────────────────────── kartu file ─────────────────────────
function ItemCard({ it, onRun, onRemove, onSettings, onPreview, onTarget }: { it: Item; onRun: () => void; onRemove: () => void; onSettings: () => void; onPreview: () => void; onTarget: (t: string) => void }) {
  const toast = useToast();
  const style = CAT_STYLE[it.kind.category];
  const Icon = style.icon;
  const canShare = it.result ? canShareFile(it.result.blob, it.result.fileName) : false;
  const delta = it.result ? it.result.blob.size - it.file.size : 0;

  return (
    <li className="glass animate-slide-up rounded-2xl p-4 transition hover:border-indigo-400/50">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-center gap-3.5">
          {it.thumb ? (
            <img src={it.thumb} alt="" className="h-12 w-12 shrink-0 rounded-xl border border-white/40 object-cover dark:border-white/10" />
          ) : (
            <div className={cx('grid h-12 w-12 shrink-0 place-items-center rounded-xl', style.tint)}>
              <Icon className="h-6 w-6" />
            </div>
          )}
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold" title={it.file.name}>
              {it.file.name}
            </p>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="rounded-md bg-slate-500/10 px-1.5 py-0.5 font-bold uppercase text-slate-700 dark:text-slate-200">{it.kind.ext || '?'}</span>
              <span>{formatBytes(it.file.size)}</span>
              {it.result && (
                <>
                  <ArrowRight className="h-3 w-3" />
                  <span className="font-semibold text-emerald-600 dark:text-emerald-400">
                    {formatBytes(it.result.blob.size)}
                    {it.file.size > 0 && ` (${delta <= 0 ? '' : '+'}${Math.round((delta / it.file.size) * 100)}%)`}
                  </span>
                </>
              )}
            </p>
          </div>
        </div>

        {it.kind.supported && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="glass-chip flex h-10 items-center gap-2 rounded-xl px-3 text-xs">
              <span className="text-slate-400">Ke</span>
              <ArrowRight className="h-3.5 w-3.5 text-slate-400" />
              <select value={it.target} disabled={it.status === 'converting'} onChange={(e) => onTarget(e.target.value)} className="bg-transparent font-bold text-indigo-600 outline-none dark:text-indigo-300">
                {it.kind.targets.map((t) => (
                  <option key={t} value={t} className="text-slate-900">
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <Button iconOnly icon={Settings2} onClick={onSettings} aria-label="Pengaturan konversi" />

            {it.status === 'idle' && (
              <Button variant="primary" icon={RefreshCw} onClick={onRun}>
                Konversi
              </Button>
            )}
            {it.status === 'error' && (
              <Button variant="primary" icon={RefreshCw} onClick={onRun}>
                Coba lagi
              </Button>
            )}
            {it.status === 'converting' && (
              <span className="flex h-10 items-center gap-2 rounded-xl bg-indigo-500/10 px-4 text-xs font-semibold text-indigo-600 dark:text-indigo-300">
                <Loader2 className="h-4 w-4 animate-spin" />
                {it.progress !== null && it.progress < 100 ? `${it.progress}%` : 'Memproses…'}
              </span>
            )}
            {it.status === 'done' && it.result && (
              <>
                <Button icon={Eye} onClick={onPreview}>
                  <span className="hidden sm:inline">Pratinjau</span>
                </Button>
                {canShare && (
                  <Button iconOnly icon={Share2} aria-label="Bagikan" onClick={() => shareBlob(it.result!.blob, it.result!.fileName).catch(() => toast('Gagal membuka menu bagikan', 'error'))} />
                )}
                <Button variant="success" icon={Download} onClick={() => saveBlob(it.result!.blob, it.result!.fileName)}>
                  {it.target}
                </Button>
              </>
            )}
          </div>
        )}
        <Button variant="ghost" iconOnly icon={X} onClick={onRemove} aria-label="Hapus dari antrean" className="self-end md:self-center" />
      </div>

      {it.status === 'converting' && it.progress !== null && (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-300/50 dark:bg-white/10" role="progressbar" aria-valuenow={it.progress}>
          <div className="h-full rounded-full bg-gradient-to-r from-indigo-500 via-violet-500 to-fuchsia-500 transition-all" style={{ width: `${it.progress}%` }} />
        </div>
      )}
      {it.status === 'error' && it.error && (
        <p role="alert" className="mt-3 rounded-xl bg-red-500/10 px-3 py-2 text-xs font-medium text-red-700 dark:text-red-300">
          {it.error}
        </p>
      )}
      {it.status === 'done' && it.result?.note && (
        <p className="mt-3 rounded-xl bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-200">ℹ {it.result.note}</p>
      )}
    </li>
  );
}

// ───────────────────────── pengaturan ─────────────────────────
function SettingsModal({ item, onClose, onChange }: { item: Item | null; onClose: () => void; onChange: (s: ConvertSettings) => void }) {
  if (!item) return <Modal open={false} onClose={onClose} title="" children={null} />;
  const s = item.settings;
  const r = relevant(item);
  const set = (p: Partial<ConvertSettings>) => onChange({ ...s, ...p });
  const nothing = !r.quality && !r.scale && !r.gray && !r.page;

  return (
    <Modal open onClose={onClose} title="Pengaturan output" subtitle={`${item.file.name} → ${item.target}`} footer={<Button variant="primary" onClick={onClose}>Selesai</Button>}>
      <div className="space-y-5">
        {r.quality && (
          <Field label="Kualitas" value={`${s.quality}%`}>
            <input type="range" min={20} max={100} value={s.quality} onChange={(e) => set({ quality: Number(e.target.value) })} />
          </Field>
        )}
        {r.scale && (
          <Field label={item.kind.ext === 'pdf' ? 'Resolusi render (100% ≈ 144 DPI)' : 'Skala gambar'} value={`${s.scale}%`}>
            <input type="range" min={25} max={300} step={25} value={s.scale} onChange={(e) => set({ scale: Number(e.target.value) })} />
          </Field>
        )}
        {r.gray && (
          <label className="glass-chip flex cursor-pointer items-center justify-between rounded-xl p-3">
            <span className="text-xs font-semibold">Hitam-putih (grayscale)</span>
            <input type="checkbox" checked={s.grayscale} onChange={(e) => set({ grayscale: e.target.checked })} className="h-4 w-4 accent-indigo-600" />
          </label>
        )}
        {r.page && (
          <>
            <Field label="Ukuran kertas PDF">
              <Segmented
                value={s.pageSize === 'Fit' && !r.fit ? 'A4' : s.pageSize}
                onChange={(v) => set({ pageSize: v })}
                options={[{ value: 'A4', label: 'A4' }, { value: 'Letter', label: 'Letter' }, ...(r.fit ? [{ value: 'Fit' as const, label: 'Sesuai gambar' }] : [])]}
                className="w-full"
              />
            </Field>
            {s.pageSize !== 'Fit' && (
              <Field label="Orientasi">
                <Segmented value={s.orientation} onChange={(v) => set({ orientation: v })} options={[{ value: 'auto', label: 'Otomatis' }, { value: 'portrait', label: 'Potret' }, { value: 'landscape', label: 'Lanskap' }]} className="w-full" />
              </Field>
            )}
          </>
        )}
        {nothing && <p className="text-sm text-slate-500 dark:text-slate-400">Konversi ini tidak punya opsi tambahan — hasilnya sudah optimal secara default.</p>}
      </div>
    </Modal>
  );
}

// ───────────────────────── pratinjau ─────────────────────────
function PreviewModal({ item, onClose }: { item: Item | null; onClose: () => void }) {
  const [pdf, setPdf] = useState<{ url: string; pages: number } | null>(null);
  const [zip, setZip] = useState<{ name: string; size: number }[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const blob = item?.result?.blob;
  const mime = blob?.type ?? '';

  useEffect(() => {
    setPdf(null);
    setZip(null);
    setErr(null);
    if (!blob) return;
    let dead = false;
    (async () => {
      try {
        if (mime === 'application/pdf') {
          const r = await renderPdfPreview(blob);
          if (!dead) setPdf(r);
        } else if (mime === 'application/zip' && blob.size < 80_000_000) {
          const files = unzipSync(await blobToBytes(blob));
          if (!dead) setZip(Object.entries(files).map(([name, d]) => ({ name, size: d.length })));
        }
      } catch (e) {
        if (!dead) setErr(e instanceof Error ? e.message : 'Pratinjau gagal.');
      }
    })();
    return () => {
      dead = true;
    };
  }, [blob, mime]);

  if (!item?.result) return <Modal open={false} onClose={onClose} title="" children={null} />;
  const r = item.result;
  const isImg = mime.startsWith('image/');

  return (
    <Modal
      open
      wide
      onClose={onClose}
      title={`Pratinjau: ${r.fileName}`}
      subtitle={`${item.target} · ${formatBytes(r.blob.size)}`}
      footer={
        <>
          <Button onClick={onClose}>Tutup</Button>
          <Button variant="success" icon={Download} onClick={() => saveBlob(r.blob, r.fileName)}>
            Unduh
          </Button>
        </>
      }
    >
      <div className="flex min-h-[12rem] items-center justify-center rounded-2xl bg-slate-200/50 p-3 dark:bg-black/30">
        {isImg && item.resultUrl && <img src={item.resultUrl} alt="Hasil konversi" className="max-h-[55vh] max-w-full rounded-lg object-contain shadow-lg" style={{ background: 'repeating-conic-gradient(#cbd5e180 0 25%, transparent 0 50%) 50% / 16px 16px' }} />}
        {mime === 'application/pdf' && (pdf ? (
          <div className="text-center">
            <img src={pdf.url} alt="Halaman 1" className="mx-auto max-h-[55vh] rounded shadow-lg" />
            <p className="mt-2 text-xs text-slate-500">{pdf.pages} halaman · pratinjau halaman 1</p>
          </div>
        ) : !err && <Loader2 className="h-6 w-6 animate-spin text-indigo-500" />)}
        {zip && (
          <ul className="max-h-[50vh] w-full divide-y divide-slate-300/40 overflow-y-auto text-xs dark:divide-white/10">
            {zip.map((f) => (
              <li key={f.name} className="flex justify-between gap-3 py-1.5">
                <span className="flex min-w-0 items-center gap-2"><FileCode className="h-3.5 w-3.5 shrink-0" /><span className="truncate">{f.name}</span></span>
                <span className="shrink-0 text-slate-500">{formatBytes(f.size)}</span>
              </li>
            ))}
          </ul>
        )}
        {r.previewText && !isImg && mime !== 'application/pdf' && !zip && <pre className="max-h-[55vh] w-full overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-xs">{r.previewText}</pre>}
        {!isImg && mime !== 'application/pdf' && !zip && !r.previewText && <p className="p-6 text-sm text-slate-500">File {item.target} siap diunduh dan dibuka di aplikasinya.</p>}
        {err && <p className="text-sm text-red-500">{err}</p>}
      </div>
      {r.note && <p className="mt-3 rounded-xl bg-sky-500/10 px-3 py-2 text-xs text-sky-800 dark:text-sky-200">ℹ {r.note}</p>}
    </Modal>
  );
}

// ───────────────────────── direktori format ─────────────────────────
function FormatDirectory() {
  const rows: { cat: Category; from: string; to: string }[] = [
    { cat: 'IMAGE', from: 'PNG, JPG, WEBP, BMP, GIF, SVG, HEIC, AVIF', to: 'PNG, JPG, WEBP, BMP, ICO, SVG, PDF' },
    { cat: 'DOCUMENT', from: 'PDF', to: 'PNG, JPG (ZIP per halaman), TXT, MD, HTML, DOCX' },
    { cat: 'DOCUMENT', from: 'DOCX', to: 'PDF, TXT, MD, HTML' },
    { cat: 'DOCUMENT', from: 'TXT, MD, HTML', to: 'PDF, DOCX, TXT, MD, HTML' },
    { cat: 'DATA', from: 'XLSX, CSV, TSV, JSON', to: 'XLSX, CSV, JSON, HTML, MD, XML, PDF' }
  ];
  return (
    <div className="glass rounded-3xl p-5 sm:p-7">
      <h3 className="text-base font-bold">Konversi yang didukung</h3>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Semua nyata & berjalan lokal. Pembatasan jujur: DOCX→PDF memakai tata letak sederhana; PDF→DOCX hanya teks.</p>
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        {rows.map((r, i) => {
          const Icon = CAT_STYLE[r.cat].icon;
          return (
            <div key={i} className="glass-chip flex items-start gap-3 rounded-2xl p-4">
              <div className={cx('grid h-10 w-10 shrink-0 place-items-center rounded-xl', CAT_STYLE[r.cat].tint)}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0 text-xs">
                <p className="section-title">{CATEGORY_LABEL[r.cat]}</p>
                <p className="mt-1 font-bold">{r.from}</p>
                <p className="mt-0.5 flex items-start gap-1 text-slate-500 dark:text-slate-400"><ArrowRight className="mt-0.5 h-3 w-3 shrink-0" />{r.to}</p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
