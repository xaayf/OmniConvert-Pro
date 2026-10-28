import { useEffect, useRef } from 'react';
import { ArrowUpCircle, Combine, Download, FileSignature, Moon, RefreshCw, ScanLine, ShieldCheck, Sun, WifiOff } from 'lucide-react';
import { Button, cx } from './ui';

export type Workspace = 'converter' | 'scanner' | 'studio' | 'tools';

const TABS: { id: Workspace; label: string; short: string; icon: typeof RefreshCw }[] = [
  { id: 'converter', label: 'Konverter File', short: 'Konversi', icon: RefreshCw },
  { id: 'scanner', label: 'Scanner → PDF', short: 'Scanner', icon: ScanLine },
  { id: 'studio', label: 'PDF Studio', short: 'Studio', icon: FileSignature },
  { id: 'tools', label: 'Gabung & Pisah', short: 'Alat', icon: Combine }
];

interface Props {
  active: Workspace;
  onChange: (w: Workspace) => void;
  badges: Partial<Record<Workspace, number>>;
  theme: 'light' | 'dark';
  onToggleTheme: () => void;
  online: boolean;
  offlineReady: boolean;
  updateAvailable: boolean;
  onUpdateClick: () => void;
  canInstall: boolean;
  onInstall: () => void;
}

/** Header lengket (sticky) bergaya kaca; tinggi aslinya dipublikasikan ke --header-h untuk toolbar turunan. */
export default function Header(p: Props) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const set = () => document.documentElement.style.setProperty('--header-h', `${el.offsetHeight}px`);
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const status = !p.online
    ? { icon: WifiOff, text: 'Offline', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30' }
    : p.offlineReady
      ? { icon: ShieldCheck, text: 'Siap offline', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' }
      : { icon: ShieldCheck, text: 'Diproses lokal', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30' };
  const StatusIcon = status.icon;

  return (
    <header ref={ref} className="glass-bar sticky top-0 z-40 pt-safe">
      <div className="mx-auto flex h-14 max-w-7xl items-center justify-between gap-3 px-4 px-safe sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <img src="/logo.svg" alt="" width={36} height={36} className="h-9 w-9 shrink-0 rounded-[10px] shadow-lg shadow-indigo-500/30" />
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="truncate bg-gradient-to-r from-indigo-600 via-violet-600 to-fuchsia-600 bg-clip-text text-base font-extrabold tracking-tight text-transparent dark:from-indigo-300 dark:via-violet-300 dark:to-fuchsia-300">
                OmniConvert Pro
              </h1>
              <span className="hidden rounded-full border border-indigo-500/25 bg-indigo-500/10 px-2 py-0.5 text-[10px] font-bold text-indigo-600 sm:inline dark:text-indigo-300">
                v{__APP_VERSION__}
              </span>
            </div>
            <p className="hidden truncate text-[11px] text-slate-500 sm:block dark:text-slate-400">
              Konversi · Scan · Edit & tanda tangan PDF — semua di perangkatmu
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {p.updateAvailable && (
            <button
              onClick={p.onUpdateClick}
              className="flex h-9 animate-pulse items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-3 text-[11px] font-bold text-slate-950 shadow-lg shadow-amber-500/30"
            >
              <ArrowUpCircle className="h-4 w-4" />
              <span>Update</span>
            </button>
          )}
          {p.canInstall && (
            <Button size="sm" icon={Download} onClick={p.onInstall}>
              <span className="hidden sm:inline">Pasang</span>
            </Button>
          )}
          <span className={cx('hidden items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-[11px] font-semibold md:flex', status.cls)}>
            <StatusIcon className="h-3.5 w-3.5" />
            {status.text}
          </span>
          <Button size="sm" iconOnly variant="secondary" onClick={p.onToggleTheme} aria-label="Ganti tema" icon={p.theme === 'dark' ? Sun : Moon} />
        </div>
      </div>

      <nav className="mx-auto max-w-7xl px-3 px-safe pb-2 sm:px-5" aria-label="Fitur utama">
        <div className="no-scrollbar flex gap-1.5 overflow-x-auto rounded-2xl p-1">
          {TABS.map((t) => {
            const Icon = t.icon;
            const on = p.active === t.id;
            const count = p.badges[t.id];
            return (
              <button
                key={t.id}
                onClick={() => p.onChange(t.id)}
                aria-current={on ? 'page' : undefined}
                className={cx(
                  'flex min-w-0 flex-1 items-center justify-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-bold transition sm:flex-none sm:px-5',
                  on
                    ? 'bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/30'
                    : 'text-slate-600 hover:bg-white/60 dark:text-slate-300 dark:hover:bg-white/10'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className="hidden sm:inline">{t.label}</span>
                <span className="sm:hidden">{t.short}</span>
                {!!count && <span className={cx('rounded-full px-1.5 py-0.5 text-[10px]', on ? 'bg-white/25' : 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300')}>{count}</span>}
              </button>
            );
          })}
        </div>
      </nav>
    </header>
  );
}
