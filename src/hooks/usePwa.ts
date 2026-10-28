import { useCallback, useEffect, useRef, useState } from 'react';
import { useRegisterSW } from 'virtual:pwa-register/react';

const CHECK_EVERY_MS = 30 * 60 * 1000;

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/** Notifikasi update: SW baru TIDAK langsung menimpa; user diberi pilihan Perbarui / Nanti. */
export function usePwaUpdate() {
  const regRef = useRef<ServiceWorkerRegistration | undefined>(undefined);
  const [checking, setChecking] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const {
    needRefresh: [needRefresh, setNeedRefresh],
    offlineReady: [offlineReady, setOfflineReady],
    updateServiceWorker
  } = useRegisterSW({
    onRegisteredSW(_url, reg) {
      regRef.current = reg;
      if (reg) setInterval(() => reg.update().catch(() => {}), CHECK_EVERY_MS);
    },
    onRegisterError(err) {
      console.error('Gagal mendaftarkan service worker', err);
    }
  });

  // PWA iOS jarang memeriksa update sendiri: periksa tiap aplikasi kembali ke layar depan.
  useEffect(() => {
    const onVisible = () => {
      if (!document.hidden) regRef.current?.update().catch(() => {});
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('online', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
    };
  }, []);

  useEffect(() => {
    if (needRefresh) setDismissed(false);
  }, [needRefresh]);

  /** Periksa manual. Mengembalikan 'found' | 'latest' | 'unavailable'. */
  const checkNow = useCallback(async (): Promise<'found' | 'latest' | 'unavailable'> => {
    const reg = regRef.current;
    if (!reg) return 'unavailable';
    setChecking(true);
    try {
      await reg.update();
      // beri waktu event 'waiting' dari workbox
      await new Promise((r) => setTimeout(r, 1200));
      return reg.waiting || reg.installing ? 'found' : 'latest';
    } catch {
      return 'unavailable';
    } finally {
      setChecking(false);
    }
  }, []);

  const applyUpdate = useCallback(() => updateServiceWorker(true), [updateServiceWorker]);

  return {
    needRefresh,
    offlineReady,
    dismissed,
    checking,
    checkNow,
    applyUpdate,
    dismissUpdate: () => setDismissed(true),
    reopenUpdate: () => setDismissed(false),
    clearOfflineReady: () => setOfflineReady(false),
    dropUpdate: () => setNeedRefresh(false)
  };
}

export function usePwaInstall() {
  const [evt, setEvt] = useState<InstallPromptEvent | null>(null);
  useEffect(() => {
    const onPrompt = (e: Event) => {
      e.preventDefault();
      setEvt(e as InstallPromptEvent);
    };
    const onInstalled = () => setEvt(null);
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = useCallback(async () => {
    if (!evt) return;
    await evt.prompt();
    await evt.userChoice;
    setEvt(null);
  }, [evt]);

  return { canInstall: !!evt, install };
}

export function useOnline() {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}
