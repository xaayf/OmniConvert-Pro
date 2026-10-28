import { useCallback, useReducer, useRef } from 'react';

const LIMIT = 80;

interface SetOpts {
  /** perubahan sementara (mis. saat drag): tidak masuk riwayat */
  transient?: boolean;
  /** perubahan beruntun dengan kunci sama (mis. mengetik) digabung jadi satu langkah undo */
  key?: string;
}

/** Riwayat undo/redo berbasis store mutable (aman dari efek ganda StrictMode). */
export function useHistory<T>(initial: T) {
  const store = useRef({ past: [] as T[], present: initial, future: [] as T[] });
  const last = useRef<{ key: string; t: number } | null>(null);
  const [, bump] = useReducer((x: number) => x + 1, 0);

  const set = useCallback((next: T | ((p: T) => T), opts: SetOpts = {}) => {
    const s = store.current;
    const value = typeof next === 'function' ? (next as (p: T) => T)(s.present) : next;
    if (value === s.present) return;
    if (opts.transient) {
      s.present = value;
      bump();
      return;
    }
    const now = Date.now();
    const merge = !!opts.key && last.current?.key === opts.key && now - last.current.t < 900;
    last.current = opts.key ? { key: opts.key, t: now } : null;
    if (!merge) {
      s.past = [...s.past.slice(-(LIMIT - 1)), s.present];
      s.future = [];
    }
    s.present = value;
    bump();
  }, []);

  /** Simpan keadaan sekarang sebagai titik undo (panggil sekali di awal drag). */
  const checkpoint = useCallback(() => {
    const s = store.current;
    s.past = [...s.past.slice(-(LIMIT - 1)), s.present];
    s.future = [];
    last.current = null;
    bump();
  }, []);

  const undo = useCallback(() => {
    const s = store.current;
    if (!s.past.length) return;
    s.future = [s.present, ...s.future];
    s.present = s.past[s.past.length - 1];
    s.past = s.past.slice(0, -1);
    last.current = null;
    bump();
  }, []);

  const redo = useCallback(() => {
    const s = store.current;
    if (!s.future.length) return;
    s.past = [...s.past, s.present];
    s.present = s.future[0];
    s.future = s.future.slice(1);
    last.current = null;
    bump();
  }, []);

  const reset = useCallback((v: T) => {
    store.current = { past: [], present: v, future: [] };
    last.current = null;
    bump();
  }, []);

  return {
    state: store.current.present,
    set,
    checkpoint,
    undo,
    redo,
    reset,
    canUndo: store.current.past.length > 0,
    canRedo: store.current.future.length > 0
  };
}
