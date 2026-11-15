/** Primitives d'interface (glass, boutons, segmented control, switch, skeleton, compteur animé). */
import { animate, motion, useReducedMotion, type HTMLMotionProps } from 'framer-motion';
import { useId, useLayoutEffect, useRef, type ButtonHTMLAttributes, type ReactNode } from 'react';

import { cx } from '../lib/cx';

const panelMotion = {
  initial: { opacity: 0, y: 12, scale: 0.985 },
  animate: { opacity: 1, y: 0, scale: 1 },
  exit: { opacity: 0, y: 8, scale: 0.985 },
  transition: { type: 'spring', stiffness: 380, damping: 34, mass: 0.8 },
} as const;

export function GlassPanel({
  className,
  children,
  ...rest
}: HTMLMotionProps<'div'> & { children?: ReactNode }) {
  return (
    <motion.div
      {...panelMotion}
      className={cx('glass rounded-[var(--radius-panel)] text-fg', className)}
      {...rest}
    >
      {children}
    </motion.div>
  );
}

export function Section({
  title,
  icon,
  action,
  children,
  className,
}: {
  title: string;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section aria-labelledby={id} className={cx('px-4 py-3', className)}>
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <h2
          id={id}
          className="flex items-center gap-1.5 text-[11px] font-semibold tracking-[0.08em] text-fg-subtle uppercase"
        >
          {icon}
          {title}
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function IconButton({
  label,
  children,
  className,
  active,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { label: string; active?: boolean }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className={cx(
        'focus-ring inline-flex size-9 shrink-0 items-center justify-center rounded-full text-fg-muted transition-colors',
        'hover:bg-tile-hover hover:text-fg active:scale-95 disabled:pointer-events-none disabled:opacity-40',
        active && 'bg-tile-hover text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Button({
  variant = 'secondary',
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' }) {
  return (
    <button
      type="button"
      className={cx(
        'focus-ring inline-flex items-center justify-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition',
        'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50',
        variant === 'primary' &&
          'bg-gradient-to-r from-accent-from to-accent-to text-white shadow-[var(--shadow-glass-sm)] hover:brightness-110',
        variant === 'secondary' && 'bg-tile text-fg hover:bg-tile-hover border border-line',
        variant === 'ghost' && 'text-fg-muted hover:bg-tile-hover hover:text-fg',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export interface SegOption<T extends string> {
  value: T;
  label: ReactNode;
  title?: string;
}

/** Segmented control accessible (radiogroup, flèches gauche/droite). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  size = 'md',
}: {
  value: T;
  options: SegOption<T>[];
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
}) {
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: React.KeyboardEvent, i: number) => {
    const d =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!d) return;
    e.preventDefault();
    const n = (i + d + options.length) % options.length;
    onChange(options[n].value);
    refs.current[n]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="relative flex rounded-full bg-tile p-1">
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            title={o.title}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              'focus-ring relative z-0 flex-1 rounded-full font-medium whitespace-nowrap transition-colors',
              size === 'sm' ? 'px-2 py-1 text-[11px]' : 'px-2.5 py-1.5 text-xs',
              on ? 'text-fg' : 'text-fg-subtle hover:text-fg',
            )}
          >
            {on && (
              <motion.span
                layoutId={`seg-${id}`}
                className="absolute inset-0 -z-10 rounded-full bg-glass-strong shadow-[var(--shadow-glass-sm)]"
                transition={{ type: 'spring', stiffness: 500, damping: 38 }}
              />
            )}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: string;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3">
      <div>
        <div id={id} className="text-sm text-fg">
          {label}
        </div>
        {description && <div className="text-xs text-fg-subtle">{description}</div>}
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={id}
        onClick={() => onChange(!checked)}
        className={cx(
          'focus-ring relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-colors',
          checked ? 'bg-accent' : 'bg-line',
        )}
      >
        <motion.span
          layout
          transition={{ type: 'spring', stiffness: 600, damping: 35 }}
          className={cx('size-5 rounded-full bg-white shadow', checked ? 'ml-[18px]' : 'ml-0.5')}
        />
      </button>
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx('skeleton', className)} />;
}

/** Compteur animé (respecte prefers-reduced-motion). */
export function AnimatedNumber({
  value,
  format = (v) => String(Math.round(v)),
  duration = 0.7,
}: {
  value: number;
  format?: (v: number) => string;
  duration?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef<number | null>(null);
  const reduce = useReducedMotion();
  const fmt = useRef(format);
  fmt.current = format;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!Number.isFinite(value)) {
      el.textContent = '—';
      return;
    }
    const from = prev.current ?? (reduce ? value : value * 0.6);
    prev.current = value;
    if (reduce || from === value) {
      el.textContent = fmt.current(value);
      return;
    }
    const c = animate(from, value, {
      duration,
      ease: [0.22, 1, 0.36, 1],
      onUpdate: (v) => {
        el.textContent = fmt.current(v);
      },
    });
    return () => c.stop();
  }, [value, duration, reduce]);
  // Contenu écrit directement dans le DOM (pas de re-rendu React à chaque frame).
  return <span ref={ref} className="tabular" />;
}
