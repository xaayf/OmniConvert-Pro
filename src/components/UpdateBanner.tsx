import { ArrowUpCircle, CheckCircle2, X } from 'lucide-react';
import { Button } from './ui';

interface Props {
  needRefresh: boolean;
  dismissed: boolean;
  hasWork: boolean;
  offlineReady: boolean;
  onApply: () => void;
  onDismiss: () => void;
  onCloseOffline: () => void;
}

/** Kartu notifikasi mengambang (kaca) untuk update versi & status siap-offline. */
export default function UpdateBanner(p: Props) {
  const showUpdate = p.needRefresh && !p.dismissed;
  if (!showUpdate && !p.offlineReady) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[70] flex justify-center px-4 pb-safe">
      <div className="pointer-events-auto mb-4 w-full max-w-md animate-slide-up">
        {showUpdate ? (
          <div role="alertdialog" aria-label="Pembaruan tersedia" className="glass-strong rounded-3xl p-4">
            <div className="flex items-start gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 text-slate-950 shadow-lg shadow-amber-500/30">
                <ArrowUpCircle className="h-5 w-5" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold">Versi baru tersedia</p>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
                  Muat ulang untuk memakai perbaikan & fitur terbaru.
                  {p.hasWork && <span className="mt-1 block font-semibold text-amber-700 dark:text-amber-300">Ada pekerjaan yang belum diunduh — simpan dulu, memperbarui akan menghapusnya.</span>}
                </p>
              </div>
            </div>
            <div className="mt-3 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={p.onDismiss}>
                Nanti
              </Button>
              <Button size="sm" variant="primary" onClick={p.onApply}>
                Perbarui sekarang
              </Button>
            </div>
          </div>
        ) : (
          <div role="status" className="glass-strong flex items-center gap-3 rounded-2xl p-3.5">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-500" />
            <p className="flex-1 text-xs font-semibold">Siap dipakai offline — semua fitur tersimpan di perangkat ini.</p>
            <Button size="sm" variant="ghost" iconOnly icon={X} onClick={p.onCloseOffline} aria-label="Tutup" />
          </div>
        )}
      </div>
    </div>
  );
}
