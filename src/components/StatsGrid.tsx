import { useId, useState, type ReactNode } from 'react';
import { useApp } from '../store/useApp';
import { fmtTime } from '../lib/format';
import type { ConfidenceLevel } from '../types';
import { IconAlert, IconInfo } from './icons';
import { AnimatedNumber, Skeleton } from './ui';
import { cx } from '../lib/cx';

const fr =
  (digits = 0) =>
  (v: number) =>
    v.toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits });
const dur = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
};

function Tile({
  label,
  children,
  unit,
  loading,
  tone,
}: {
  label: string;
  children?: ReactNode;
  unit?: string;
  loading?: boolean;
  tone?: string;
}) {
  return (
    <div className="rounded-[var(--radius-tile)] bg-tile px-3 py-2.5">
      <div className="truncate text-[11px] font-medium text-fg-subtle">{label}</div>
      {loading ? (
        <Skeleton className="mt-1.5 h-6 w-16" />
      ) : (
        <div
          className={cx(
            'mt-0.5 flex items-baseline gap-1 text-[20px] leading-7 font-semibold tracking-tight',
            tone ?? 'text-fg',
          )}
        >
          {children}
          {unit && <span className="text-xs font-medium text-fg-subtle">{unit}</span>}
        </div>
      )}
    </div>
  );
}

const LEVEL: Record<ConfidenceLevel, { label: string; cls: string; dot: string }> = {
  high: { label: 'Élevée', cls: 'bg-green-500/15 text-green-600 dark:text-green-300', dot: 'bg-green-500' },
  medium: {
    label: 'Moyenne',
    cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
    dot: 'bg-amber-500',
  },
  low: { label: 'Faible', cls: 'bg-red-500/15 text-red-600 dark:text-red-300', dot: 'bg-red-500' },
};

export function ConfidenceBadge() {
  const confidence = useApp((s) => s.confidence);
  const status = useApp((s) => s.confidenceStatus);
  const [open, setOpen] = useState(false);
  const tipId = useId();
  if (status === 'loading') return <Skeleton className="h-7 w-32 rounded-full" />;
  if (!confidence)
    return status === 'error' ? <span className="text-xs text-fg-subtle">Confiance indisponible</span> : null;
  const l = LEVEL[confidence.level];
  return (
    <div className="relative">
      <button
        type="button"
        aria-describedby={tipId}
        aria-expanded={open}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onClick={() => setOpen((o) => !o)}
        className={cx(
          'focus-ring inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold',
          l.cls,
        )}
      >
        <span className={cx('size-2 rounded-full', l.dot)} />
        Confiance {l.label.toLowerCase()} · <span className="tabular">{Math.round(confidence.score)}</span>
        <IconInfo size={13} className="opacity-70" />
      </button>
      <div
        id={tipId}
        role="tooltip"
        className={cx(
          'glass-strong absolute top-full right-0 z-20 mt-2 w-72 rounded-2xl p-3 text-xs leading-relaxed text-fg-muted transition',
          open ? 'visible translate-y-0 opacity-100' : 'invisible -translate-y-1 opacity-0',
        )}
      >
        <div className="mb-1 font-semibold text-fg">
          Indice de confiance : {Math.round(confidence.score)}/100
        </div>
        {confidence.reasons.length ? (
          <ul className="list-disc space-y-0.5 pl-4">
            {confidence.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        ) : (
          <p>Accord entre modèles et dispersion de l'ensemble.</p>
        )}
      </div>
    </div>
  );
}

export function HorizonWarning() {
  const horizon = useApp((s) => s.horizon);
  if (horizon?.kind !== 'low-reliability') return null;
  return (
    <div
      role="note"
      className="mx-4 mb-2 flex gap-2 rounded-2xl bg-amber-500/12 px-3 py-2 text-xs text-amber-700 dark:text-amber-200"
    >
      <IconAlert size={16} className="mt-0.5 shrink-0" />
      <span>
        Départ dans {Math.round(horizon.daysAhead)} jours : au-delà d'une semaine, les prévisions sont
        indicatives. Revenez vérifier la veille.
      </span>
    </div>
  );
}

/** Cartes de stats. `compact` : 4 stats clés (bottom sheet replié). */
export default function StatsGrid({ compact = false }: { compact?: boolean }) {
  const route = useApp((s) => s.route);
  const timing = useApp((s) => s.timing);
  const stats = useApp((s) => s.stats);
  const ws = useApp((s) => s.weatherStatus);
  if (!route) return null;
  const wLoading = ws === 'loading';
  const distance = stats?.distance ?? route.stats.distance;
  const ascent = stats?.ascent ?? route.stats.ascent;
  const descent = stats?.descent ?? route.stats.descent;
  const duration = stats?.durationSec ?? timing?.durationSec;
  const arrival = stats?.arrival ?? timing?.arrival;
  const avg = stats?.avgSpeedKmh ?? timing?.avgSpeedKmh;
  const na = <span className="text-fg-subtle">—</span>;

  if (compact) {
    return (
      <div className="grid grid-cols-4 gap-1.5">
        <Tile label="Distance" unit="km">
          <AnimatedNumber value={distance / 1000} format={fr(1)} />
        </Tile>
        <Tile label="D+" unit="m">
          <AnimatedNumber value={ascent} format={fr(0)} />
        </Tile>
        <Tile label="Durée">{duration != null ? dur(duration) : na}</Tile>
        <Tile label="Temp." loading={wLoading} unit="°C">
          {stats ? `${Math.round(stats.minTemp)}–${Math.round(stats.maxTemp)}` : na}
        </Tile>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-3 gap-1.5" aria-busy={ws === 'loading'}>
      <Tile label="Distance" unit="km">
        <AnimatedNumber value={distance / 1000} format={fr(1)} />
      </Tile>
      <Tile label="Dénivelé +" unit="m">
        <AnimatedNumber value={ascent} format={fr(0)} />
      </Tile>
      <Tile label="Dénivelé −" unit="m">
        <AnimatedNumber value={descent} format={fr(0)} />
      </Tile>
      <Tile label="Durée estimée">{duration != null ? dur(duration) : na}</Tile>
      <Tile label="Arrivée">
        {arrival != null ? <span className="tabular">{fmtTime(arrival)}</span> : na}
      </Tile>
      <Tile label="Vitesse moy." unit="km/h">
        {avg != null ? <AnimatedNumber value={avg} format={fr(1)} /> : na}
      </Tile>
      <Tile
        label="Vent de face"
        unit="%"
        loading={wLoading}
        tone={stats && stats.headwindShare > 0.5 ? 'text-red-500 dark:text-red-300' : undefined}
      >
        {stats ? <AnimatedNumber value={stats.headwindShare * 100} /> : na}
      </Tile>
      <Tile label="Temp. min / max" unit="°C" loading={wLoading}>
        {stats ? (
          <span className="tabular">
            {Math.round(stats.minTemp)}
            <span className="text-fg-subtle"> / </span>
            {Math.round(stats.maxTemp)}
          </span>
        ) : (
          na
        )}
      </Tile>
      <Tile
        label="Risque de pluie"
        unit="%"
        loading={wLoading}
        tone={stats && stats.maxPrecipProbability >= 50 ? 'text-sky-500 dark:text-sky-300' : undefined}
      >
        {stats ? <AnimatedNumber value={stats.maxPrecipProbability} /> : na}
      </Tile>
    </div>
  );
}
