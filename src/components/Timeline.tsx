import { useMemo } from 'react';
import { useApp } from '../store/useApp';
import { positionAtTime } from '../features/route';
import { fmtTime } from '../lib/format';
import { WIND_RELATION_COLORS } from '../lib/colors';
import { IconClock, IconPause, IconPlay, WeatherIcon, WindArrow } from './icons';
import { cx } from '../lib/cx';

const HOUR = 3600_000;
const REL = { head: 'de face', tail: 'de dos', cross: 'de travers' } as const;

/** Timeline horaire (capsule glass) : curseur départ → arrivée, lecture animée, météo à la position du cycliste. */
export default function Timeline({ className }: { className?: string }) {
  const route = useApp((s) => s.route);
  const timing = useApp((s) => s.timing);
  const weather = useApp((s) => s.weather);
  const start = useApp((s) => s.settings.startTime);
  const t = useApp((s) => s.timelineTime);
  const playing = useApp((s) => s.playing);
  const setT = useApp((s) => s.setTimelineTime);
  const setPlaying = useApp((s) => s.setPlaying);

  const end = timing?.arrival ?? start;
  const span = Math.max(1, end - start);
  const ticks = useMemo(() => {
    const out: number[] = [];
    for (let h = Math.ceil(start / HOUR) * HOUR; h <= end; h += HOUR) out.push(h);
    // trop de graduations sur une longue sortie : une sur deux
    return out.length > 10 ? out.filter((_, i) => i % 2 === 0) : out;
  }, [start, end]);

  if (!route || !timing || !route.points.length) return null;
  const cur = t ?? start;
  const pct = ((cur - start) / span) * 100;
  let idx: number;
  try {
    idx = positionAtTime(route, timing, cur).index;
  } catch {
    idx = 0;
  }
  const w = t != null ? weather[Math.max(0, Math.min(weather.length - 1, idx))] : undefined;

  return (
    <div className={cx('glass flex items-center gap-3 rounded-full py-1.5 pr-4 pl-1.5 text-fg', className)}>
      <button
        type="button"
        onClick={() => setPlaying(!playing)}
        aria-label={playing ? 'Mettre en pause' : 'Lire la sortie'}
        className="focus-ring flex size-10 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-accent-from to-accent-to text-white shadow-md hover:brightness-110 active:scale-95"
      >
        {playing ? <IconPause size={16} /> : <IconPlay size={16} />}
      </button>

      <div className="w-[64px] shrink-0">
        <div className="tabular text-[17px] leading-5 font-semibold">{fmtTime(cur)}</div>
        <div className="truncate text-[10px] text-fg-subtle">
          {t == null
            ? 'au passage'
            : `km ${(route.points[idx]?.dist / 1000 || 0).toFixed(1).replace('.', ',')}`}
        </div>
      </div>

      <div className="relative min-w-0 flex-1 pt-1 pb-3.5">
        <input
          type="range"
          className="rc-range w-full"
          style={{ ['--rc-fill' as string]: `${pct}%` }}
          min={start}
          max={end}
          step={60_000}
          value={cur}
          aria-label="Heure affichée sur la carte"
          aria-valuetext={fmtTime(cur)}
          onChange={(e) => {
            if (playing) setPlaying(false);
            setT(Number(e.target.value));
          }}
        />
        <div className="pointer-events-none absolute inset-x-[9px] bottom-0 h-3" aria-hidden="true">
          {ticks.map((h) => (
            <span
              key={h}
              className="tabular absolute -translate-x-1/2 text-[10px] text-fg-subtle"
              style={{ left: `${((h - start) / span) * 100}%` }}
            >
              {fmtTime(h)}
            </span>
          ))}
        </div>
      </div>

      <div
        className="hidden w-[178px] shrink-0 items-center gap-2 text-xs whitespace-nowrap sm:flex"
        aria-live="off"
      >
        {w ? (
          <>
            <WeatherIcon code={w.weatherCode} isDay={w.isDay} size={24} />
            <div className="min-w-0">
              <div className="tabular font-semibold">
                {Math.round(w.temperature)}°{' '}
                <span className="font-normal text-fg-subtle">ress. {Math.round(w.apparentTemperature)}°</span>
              </div>
              <div className="tabular flex items-center gap-1 text-fg-subtle">
                <WindArrow
                  deg={w.windDirection}
                  size={12}
                  style={{ color: WIND_RELATION_COLORS[w.windRelation] }}
                />
                {Math.round(w.windSpeed)} km/h {REL[w.windRelation]}
              </div>
            </div>
          </>
        ) : (
          <span className="text-[11px] whitespace-normal text-fg-subtle">
            Météo à l'heure de passage de chaque point
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={() => {
          setPlaying(false);
          setT(null);
        }}
        disabled={t == null}
        aria-label="Revenir à l'heure de passage"
        title="Heure de passage"
        className="focus-ring hidden shrink-0 items-center gap-1 rounded-full bg-tile px-2.5 py-1.5 text-xs font-medium text-fg-muted hover:bg-tile-hover hover:text-fg disabled:opacity-40 sm:inline-flex"
      >
        <IconClock size={14} /> Passage
      </button>
      <button
        type="button"
        onClick={() => {
          setPlaying(false);
          setT(null);
        }}
        disabled={t == null}
        aria-label="Revenir à l'heure de passage"
        className="focus-ring inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-tile text-fg-muted disabled:opacity-40 sm:hidden"
      >
        <IconClock size={14} />
      </button>
    </div>
  );
}
