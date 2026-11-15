import { useEffect } from 'react';
import { useApp } from '../../store/useApp';
import { fmtTime } from '../../lib/format';
import type { RainViewerFrames } from '../weather';
import { glass } from './ui';

interface Props {
  frames: RainViewerFrames['frames'];
  index: number;
  onIndex: (i: number) => void;
  playing: boolean;
  onPlaying: (p: boolean) => void;
  className?: string;
}

/** Mini-lecteur des frames radar RainViewer (observé + prévision immédiate). */
export default function RadarPlayer({ frames, index, onIndex, playing, onPlaying, className = '' }: Props) {
  const theme = useApp((s) => s.theme);
  const tz = useApp((s) => s.settings.timezone);
  const n = frames.length;

  useEffect(() => {
    if (!playing || n < 2) return;
    const id = setInterval(() => onIndex((index + 1) % n), index === n - 1 ? 1400 : 600);
    return () => clearInterval(id);
  }, [playing, index, n, onIndex]);

  if (!n) return null;
  const f = frames[Math.min(index, n - 1)];
  const nowcast = f.kind === 'nowcast';
  const track = theme === 'dark' ? 'accent-sky-400' : 'accent-sky-600';

  return (
    <div
      className={`${glass(theme)} pointer-events-auto flex w-full items-center gap-2 px-2 py-1.5 text-xs ${className}`}
    >
      <button
        type="button"
        onClick={() => onPlaying(!playing)}
        aria-label={playing ? 'Pause du radar' : 'Lecture du radar'}
        className={`grid h-8 w-8 shrink-0 place-items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sky-400 ${theme === 'dark' ? 'hover:bg-white/15' : 'hover:bg-black/5'}`}
      >
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
          {playing ? <path d="M7 5h3.5v14H7zM13.5 5H17v14h-3.5z" /> : <path d="M8 5.5v13l10.5-6.5z" />}
        </svg>
      </button>
      <input
        type="range"
        min={0}
        max={n - 1}
        step={1}
        value={index}
        onChange={(e) => {
          onPlaying(false);
          onIndex(Number(e.target.value));
        }}
        aria-label="Instant du radar"
        aria-valuetext={`${fmtTime(f.time, tz)} ${nowcast ? 'prévision' : 'observé'}`}
        className={`min-w-0 flex-1 ${track}`}
      />
      <div className="w-16 shrink-0 text-right leading-tight">
        <div className="font-medium tabular-nums">{fmtTime(f.time, tz)}</div>
        <div
          className={
            nowcast
              ? theme === 'dark'
                ? 'text-amber-300'
                : 'text-amber-700'
              : theme === 'dark'
                ? 'text-white/65'
                : 'text-slate-500'
          }
        >
          {nowcast ? 'Prévision' : 'Observé'}
        </div>
      </div>
    </div>
  );
}
