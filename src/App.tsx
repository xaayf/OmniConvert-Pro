import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import Header, { type Workspace } from './components/Header';
import UpdateBanner from './components/UpdateBanner';
import { Background } from './components/ui';
import { ToastProvider, useToast } from './hooks/useToast';
import { useTheme } from './hooks/useTheme';
import { useOnline, usePwaInstall, usePwaUpdate } from './hooks/usePwa';

const ConverterView = lazy(() => import('./features/converter/ConverterView'));
const ScannerView = lazy(() => import('./features/scanner/ScannerView'));
const StudioView = lazy(() => import('./features/pdfstudio/StudioView'));
const ToolsView = lazy(() => import('./features/tools/ToolsView'));

const OFFLINE_KEY = 'omni-offline-ready';
const readFlag = () => {
  try {
    return localStorage.getItem(OFFLINE_KEY) === '1';
  } catch {
    return false;
  }
};

function Fallback() {
  return (
    <div className="grid place-items-center py-24 text-slate-500">
      <Loader2 className="h-6 w-6 animate-spin" aria-label="Memuat" />
    </div>
  );
}

function Shell() {
  const toast = useToast();
  const { theme, toggle } = useTheme();
  const online = useOnline();
  const pwa = usePwaUpdate();
  const install = usePwaInstall();
  const [tab, setTab] = useState<Workspace>('converter');
  const [mounted, setMounted] = useState<Set<Workspace>>(() => new Set(['converter']));
  const [work, setWork] = useState<Record<Workspace, number>>({ converter: 0, scanner: 0, studio: 0, tools: 0 });
  const [offlineFlag, setOfflineFlag] = useState(readFlag);

  useEffect(() => {
    if (!pwa.offlineReady) return;
    setOfflineFlag(true);
    try {
      localStorage.setItem(OFFLINE_KEY, '1');
    } catch {
      /* abaikan */
    }
  }, [pwa.offlineReady]);

  const change = useCallback((w: Workspace) => {
    setTab(w);
    setMounted((m) => (m.has(w) ? m : new Set(m).add(w)));
    window.scrollTo({ top: 0 });
  }, []);

  const setCounter = useMemo(
    () => ({
      converter: (n: number) => setWork((p) => (p.converter === n ? p : { ...p, converter: n })),
      scanner: (n: number) => setWork((p) => (p.scanner === n ? p : { ...p, scanner: n })),
      studio: (n: number) => setWork((p) => (p.studio === n ? p : { ...p, studio: n })),
      tools: (n: number) => setWork((p) => (p.tools === n ? p : { ...p, tools: n }))
    }),
    []
  );

  const total = work.converter + work.scanner + work.studio + work.tools;
  useEffect(() => {
    if (!total) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [total]);

  const checkUpdate = async () => {
    const r = await pwa.checkNow();
    if (r === 'found') {
      pwa.reopenUpdate();
      toast('Versi baru ditemukan', 'info');
    } else if (r === 'latest') toast('Kamu sudah memakai versi terbaru');
    else toast('Pemeriksaan tidak tersedia (mode offline atau belum terpasang)', 'info');
  };

  const view = (id: Workspace, node: React.ReactNode) =>
    mounted.has(id) && (
      <div key={id} hidden={tab !== id}>
        <Suspense fallback={<Fallback />}>{node}</Suspense>
      </div>
    );

  return (
    <div className="min-h-dvh">
      <Background />
      <Header
        active={tab}
        onChange={change}
        badges={work}
        theme={theme}
        onToggleTheme={toggle}
        online={online}
        offlineReady={offlineFlag}
        updateAvailable={pwa.needRefresh}
        onUpdateClick={pwa.reopenUpdate}
        canInstall={install.canInstall}
        onInstall={install.install}
      />

      <main className="mx-auto w-full max-w-6xl px-safe px-4 pb-24 pt-4">
        {view('converter', <ConverterView active={tab === 'converter'} onWorkChange={setCounter.converter} />)}
        {view('scanner', <ScannerView active={tab === 'scanner'} onWorkChange={setCounter.scanner} />)}
        {view('tools', <ToolsView active={tab === 'tools'} onWorkChange={setCounter.tools} />)}
        {view('studio', <StudioView active={tab === 'studio'} onWorkChange={setCounter.studio} />)}

        <footer className="mt-10 flex flex-col items-center gap-2 text-center text-[11px] text-slate-500 dark:text-slate-400">
          <p>
            OmniConvert Pro v{__APP_VERSION__} · build {new Date(__BUILD_TIME__).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' })} · semua proses berjalan di perangkatmu, file tidak diunggah.
          </p>
          <button onClick={checkUpdate} disabled={pwa.checking} className="glass-chip inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-semibold transition hover:text-indigo-600 disabled:opacity-60">
            <RefreshCw className={pwa.checking ? 'h-3.5 w-3.5 animate-spin' : 'h-3.5 w-3.5'} />
            Periksa pembaruan
          </button>
        </footer>
      </main>

      <UpdateBanner
        needRefresh={pwa.needRefresh}
        dismissed={pwa.dismissed}
        hasWork={total > 0}
        offlineReady={pwa.offlineReady}
        onApply={pwa.applyUpdate}
        onDismiss={pwa.dismissUpdate}
        onCloseOffline={pwa.clearOfflineReady}
      />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <Shell />
    </ToastProvider>
  );
}
