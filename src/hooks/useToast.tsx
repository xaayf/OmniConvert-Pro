import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, CheckCircle2, Info } from 'lucide-react';

type Kind = 'success' | 'error' | 'info';
interface ToastItem {
  id: number;
  message: string;
  kind: Kind;
}

const Ctx = createContext<(message: string, kind?: Kind) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const idRef = useRef(0);

  const push = useCallback((message: string, kind: Kind = 'success') => {
    const id = ++idRef.current;
    setItems((p) => [...p.slice(-3), { id, message, kind }]);
    setTimeout(() => setItems((p) => p.filter((t) => t.id !== id)), kind === 'error' ? 6000 : 3200);
  }, []);

  const value = useMemo(() => push, [push]);

  return (
    <Ctx.Provider value={value}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
        style={{ top: 'calc(var(--header-h) + 12px)' }}
        aria-live="polite"
      >
        {items.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className="glass-strong pointer-events-auto flex max-w-md animate-slide-up items-start gap-2.5 rounded-2xl px-4 py-3 text-sm font-medium"
          >
            {t.kind === 'error' ? (
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
            ) : t.kind === 'info' ? (
              <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-500" />
            ) : (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
            )}
            <span className="break-words">{t.message}</span>
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}
