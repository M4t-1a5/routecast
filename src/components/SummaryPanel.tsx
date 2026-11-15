import { useApp } from '../store/useApp';
import { fmtKm, fmtTime } from '../lib/format';
import { WIND_RELATION_COLORS } from '../lib/colors';
import type { ClimbCategory } from '../types';
import { GearIcon, IconMountain, WeatherIcon, WindArrow } from './icons';
import { Section, Skeleton } from './ui';

const CAT: Record<ClimbCategory, { label: string; cls: string }> = {
  HC: { label: 'HC', cls: 'bg-red-600 text-white' },
  '1': { label: '1re', cls: 'bg-red-500 text-white' },
  '2': { label: '2e', cls: 'bg-orange-500 text-white' },
  '3': { label: '3e', cls: 'bg-amber-400 text-slate-900' },
  '4': { label: '4e', cls: 'bg-lime-400 text-slate-900' },
};
const REL = { head: 'face', tail: 'dos', cross: 'travers' } as const;

export function Climbs() {
  const route = useApp((s) => s.route);
  const weather = useApp((s) => s.weather);
  const timing = useApp((s) => s.timing);
  const ws = useApp((s) => s.weatherStatus);
  const climbs = route?.climbs ?? [];
  if (!route || !climbs.length) return null;
  return (
    <Section title={`Montées (${climbs.length})`} icon={<IconMountain size={14} />}>
      <ul className="space-y-1.5">
        {climbs.map((c) => {
          const w = weather[c.endIdx];
          const eta = timing?.etas[c.endIdx];
          return (
            <li
              key={`${c.startIdx}-${c.endIdx}`}
              className="flex items-center gap-3 rounded-2xl bg-tile px-3 py-2"
            >
              <span
                className={`flex h-7 min-w-9 items-center justify-center rounded-lg px-1.5 text-xs font-bold ${CAT[c.category].cls}`}
                aria-label={`Catégorie ${c.category === 'HC' ? 'hors catégorie' : c.category}`}
              >
                {CAT[c.category].label}
              </span>
              <div className="min-w-0 flex-1">
                <div className="tabular text-sm font-medium text-fg">
                  km {(c.startDist / 1000).toFixed(1).replace('.', ',')} →{' '}
                  {(c.endDist / 1000).toFixed(1).replace('.', ',')}
                </div>
                <div className="tabular text-xs text-fg-subtle">
                  {fmtKm(c.length)} · {c.avgGrade.toFixed(1).replace('.', ',')} % moy. · max{' '}
                  {c.maxGrade.toFixed(0)} % · {Math.round(c.summitEle)} m
                </div>
              </div>
              <div className="text-right text-xs">
                {w ? (
                  <>
                    <div className="flex items-center justify-end gap-1 font-medium text-fg">
                      <WeatherIcon code={w.weatherCode} isDay={w.isDay} size={16} />
                      <span className="tabular">{Math.round(w.temperature)}°</span>
                    </div>
                    <div className="tabular flex items-center justify-end gap-0.5 text-fg-subtle">
                      <WindArrow
                        deg={w.windDirection}
                        size={12}
                        style={{ color: WIND_RELATION_COLORS[w.windRelation] }}
                      />
                      {Math.round(w.windSpeed)} km/h {REL[w.windRelation]}
                    </div>
                    {eta != null && <div className="tabular text-fg-subtle">sommet {fmtTime(eta)}</div>}
                  </>
                ) : ws === 'loading' ? (
                  <Skeleton className="h-8 w-16" />
                ) : (
                  eta != null && <div className="tabular text-fg-subtle">sommet {fmtTime(eta)}</div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

export default function SummaryPanel() {
  const summary = useApp((s) => s.summary);
  const ws = useApp((s) => s.weatherStatus);
  if (ws === 'loading')
    return (
      <Section title="Résumé de la sortie">
        <div className="space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <Skeleton className="h-4 w-2/3" />
        </div>
      </Section>
    );
  if (!summary || (!summary.sentences.length && !summary.gear.length)) return null;
  return (
    <Section title="Résumé de la sortie">
      {summary.sentences.length > 0 && (
        <div className="space-y-1.5 text-sm leading-relaxed text-fg-muted">
          {summary.sentences.map((s) => (
            <p key={s}>{s}</p>
          ))}
        </div>
      )}
      {summary.gear.length > 0 && (
        <>
          <h3 className="mt-3 mb-1.5 text-xs font-medium text-fg-subtle">À prévoir</h3>
          <ul className="flex flex-wrap gap-1.5">
            {summary.gear.map((g) => (
              <li
                key={g.id}
                className="inline-flex items-center gap-1.5 rounded-full bg-tile px-2.5 py-1 text-xs font-medium text-fg"
              >
                <GearIcon id={g.id} size={14} className="text-sky-500 dark:text-sky-300" />
                {g.label}
              </li>
            ))}
          </ul>
        </>
      )}
    </Section>
  );
}
