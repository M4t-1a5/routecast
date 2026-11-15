import type { ReactNode } from 'react';
import { useApp } from '../../store/useApp';
import { getMap } from './mapInstance';
import { glass } from './ui';

function IconButton({
  label,
  onClick,
  children,
  pressed,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  pressed?: boolean;
}) {
  const theme = useApp((s) => s.theme);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={`grid h-10 w-10 place-items-center rounded-xl transition-colors outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${
        theme === 'dark' ? 'hover:bg-white/15 active:bg-white/25' : 'hover:bg-black/5 active:bg-black/10'
      } ${pressed ? (theme === 'dark' ? 'bg-white/15' : 'bg-black/5') : ''}`}
    >
      <svg
        viewBox="0 0 24 24"
        width="20"
        height="20"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        {children}
      </svg>
    </button>
  );
}

/** Recentrer, fond vectoriel / topo, zoom +/−. */
export default function MapControls({
  className = '',
  vertical = true,
}: {
  className?: string;
  vertical?: boolean;
}) {
  const theme = useApp((s) => s.theme);
  const baseMap = useApp((s) => s.baseMap);
  const setBaseMap = useApp((s) => s.setBaseMap);
  const recenter = useApp((s) => s.recenter);
  const hasRoute = useApp((s) => !!s.route);
  const sep = theme === 'dark' ? 'bg-white/15' : 'bg-black/10';

  return (
    <div
      className={`${glass(theme)} pointer-events-auto flex ${vertical ? 'flex-col' : 'flex-row'} items-center gap-0.5 p-1 ${className}`}
    >
      {hasRoute && (
        <IconButton label="Recentrer sur la trace" onClick={recenter}>
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
          <circle cx="12" cy="12" r="5.5" />
          <circle cx="12" cy="12" r="1.5" fill="currentColor" />
        </IconButton>
      )}
      <IconButton
        label={baseMap === 'topo' ? 'Fond vectoriel' : 'Fond topographique'}
        pressed={baseMap === 'topo'}
        onClick={() => setBaseMap(baseMap === 'topo' ? 'vector' : 'topo')}
      >
        <path d="m3 18 5-9 4 6 3-4 6 7H3Z" />
        <path d="M8 9 6.5 6.5" />
      </IconButton>
      <div className={`${vertical ? 'my-0.5 h-px w-6' : 'mx-0.5 h-6 w-px'} ${sep}`} aria-hidden="true" />
      <IconButton label="Zoom avant" onClick={() => getMap()?.zoomIn()}>
        <path d="M12 6v12M6 12h12" />
      </IconButton>
      <IconButton label="Zoom arrière" onClick={() => getMap()?.zoomOut()}>
        <path d="M6 12h12" />
      </IconButton>
    </div>
  );
}
