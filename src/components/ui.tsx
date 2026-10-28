import { useEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { X } from 'lucide-react';

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(' ');

type Variant = 'primary' | 'secondary' | 'success' | 'danger' | 'ghost';
const VARIANT: Record<Variant, string> = {
  primary:
    'bg-gradient-to-br from-indigo-600 via-violet-600 to-fuchsia-600 text-white shadow-lg shadow-indigo-500/30 hover:brightness-110',
  secondary:
    'glass-chip text-slate-700 hover:bg-white dark:text-slate-100 dark:hover:bg-white/15',
  success: 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/25 hover:bg-emerald-500',
  danger: 'text-red-600 hover:bg-red-500/10 dark:text-red-400',
  ghost: 'text-slate-600 hover:bg-slate-500/10 dark:text-slate-300'
};

interface BtnProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: 'sm' | 'md';
  icon?: LucideIcon;
  iconOnly?: boolean;
}

export function Button({ variant = 'secondary', size = 'md', icon: Icon, iconOnly, className, children, type = 'button', ...rest }: BtnProps) {
  return (
    <button
      type={type}
      {...rest}
      className={cx(
        'inline-flex shrink-0 select-none items-center justify-center gap-1.5 rounded-xl text-xs font-semibold transition active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40',
        size === 'md' ? (iconOnly ? 'h-10 w-10' : 'h-10 px-4') : iconOnly ? 'h-9 w-9' : 'h-9 px-3',
        VARIANT[variant],
        className
      )}
    >
      {Icon && <Icon className="h-4 w-4 shrink-0" aria-hidden />}
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  options,
  className
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: ReactNode }[];
  className?: string;
}) {
  return (
    <div role="radiogroup" className={cx('glass-chip inline-flex rounded-xl p-1', className)}>
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'flex-1 whitespace-nowrap rounded-lg px-3 py-1.5 text-[11px] font-bold transition',
            value === o.value ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:bg-slate-500/10 dark:text-slate-300'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Field({ label, value, children }: { label: string; value?: ReactNode; children: ReactNode }) {
  return (
    <div>
      <div className="mb-1.5 flex items-center justify-between">
        <label className="text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</label>
        {value !== undefined && <span className="text-xs font-bold text-indigo-600 dark:text-indigo-400">{value}</span>}
      </div>
      {children}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    ref.current?.focus();
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener('keydown', onKey);
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center p-0 sm:items-center sm:p-4" role="presentation">
      <div className="absolute inset-0 animate-fade-in bg-slate-950/50 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        className={cx(
          'glass-strong relative flex max-h-[92dvh] w-full animate-slide-up flex-col rounded-t-3xl outline-none sm:rounded-3xl',
          wide ? 'sm:max-w-3xl' : 'sm:max-w-md'
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200/60 px-5 py-4 dark:border-white/10">
          <div className="min-w-0">
            <h3 className="truncate text-base font-bold">{title}</h3>
            {subtitle && <p className="mt-0.5 truncate text-xs text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          <Button variant="ghost" size="sm" iconOnly icon={X} onClick={onClose} aria-label="Tutup" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-slate-200/60 px-5 py-3 pb-safe dark:border-white/10">{footer}</div>}
      </div>
    </div>
  );
}

export function Background() {
  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div className="absolute inset-0 bg-gradient-to-b from-[#eef2ff] via-[#f5f3ff] to-[#fdf2f8] dark:from-[#070b17] dark:via-[#0b1024] dark:to-[#10091f]" />
      <div className="absolute -left-24 -top-24 h-[28rem] w-[28rem] animate-float rounded-full bg-indigo-500/30 blur-3xl will-change-transform dark:bg-indigo-600/25" />
      <div
        className="absolute -right-20 top-1/4 h-[26rem] w-[26rem] animate-float rounded-full bg-fuchsia-400/25 blur-3xl will-change-transform dark:bg-fuchsia-600/20"
        style={{ animationDelay: '-5s' }}
      />
      <div
        className="absolute -bottom-32 left-1/3 h-[30rem] w-[30rem] animate-float rounded-full bg-sky-400/20 blur-3xl will-change-transform dark:bg-sky-600/15"
        style={{ animationDelay: '-9s' }}
      />
    </div>
  );
}
