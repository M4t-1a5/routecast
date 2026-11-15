import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import type { MapLayer } from '../../types';
import { useApp } from '../../store/useApp';
import { glass } from './ui';

const OPTIONS: { id: MapLayer; label: string; icon: ReactNode }[] = [
  {
    id: 'wind',
    label: 'Vent',
    icon: (
      <path
        d="M3 8h10a3 3 0 1 0-3-3M3 12h15a3 3 0 1 1-3 3M3 16h7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    id: 'rain',
    label: 'Pluie',
    icon: (
      <path
        d="M7 15a4 4 0 0 1-.5-7.97A5.5 5.5 0 0 1 17 8a3.5 3.5 0 0 1 .5 7M8 18l-1 2M12 18l-1 2M16 18l-1 2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
  {
    id: 'temperature',
    label: 'Température',
    icon: (
      <path
        d="M10 13.5V5a2 2 0 1 1 4 0v8.5a4 4 0 1 1-4 0ZM12 10v6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    ),
  },
];

/** Segmented control Vent / Pluie / Température (radiogroup accessible clavier). */
export default function MapLayerSwitcher({ className = '' }: { className?: string }) {
  const layer = useApp((s) => s.layer);
  const setLayer = useApp((s) => s.setLayer);
  const theme = useApp((s) => s.theme);
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKey = (e: KeyboardEvent) => {
    const i = OPTIONS.findIndex((o) => o.id === layer);
    let n: number;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % OPTIONS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + OPTIONS.length) % OPTIONS.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = OPTIONS.length - 1;
    else return;
    e.preventDefault();
    setLayer(OPTIONS[n].id);
    refs.current[n]?.focus();
  };

  const active = theme === 'dark' ? 'bg-white/20 text-white shadow-sm' : 'bg-white text-slate-900 shadow-sm';
  const idle =
    theme === 'dark'
      ? 'text-white/75 hover:text-white hover:bg-white/10'
      : 'text-slate-600 hover:text-slate-900 hover:bg-black/5';

  return (
    <div
      role="radiogroup"
      aria-label="Couche météo de la carte"
      onKeyDown={onKey}
      className={`${glass(theme)} pointer-events-auto flex gap-1 p-1 ${className}`}
    >
      {OPTIONS.map((o, i) => {
        const checked = o.id === layer;
        return (
          <button
            key={o.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            onClick={() => setLayer(o.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-xl px-3 py-1.5 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${checked ? active : idle}`}
          >
            <svg
              viewBox="0 0 24 24"
              width="16"
              height="16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              aria-hidden="true"
            >
              {o.icon}
            </svg>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
