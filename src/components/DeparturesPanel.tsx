import { motion } from 'framer-motion';
import { useState } from 'react';
import { useApp } from '../store/useApp';
import { computeDepartures, updateSettings } from '../store/actions';
import { fmtDuration, fmtTime } from '../lib/format';
import { hourOffsetsAround } from '../lib/time';
import { toast } from '../lib/toast';
import { IconClock, IconSwap } from './icons';
import { Button, Section, Skeleton, Switch } from './ui';
import { cx } from '../lib/cx';

const hourLabel = (ms: number) => `${Number(fmtTime(ms).slice(0, 2))} h`;

function scoreColor(s: number) {
  if (s >= 70) return 'from-green-400 to-emerald-500';
  if (s >= 45) return 'from-amber-300 to-amber-500';
  return 'from-orange-400 to-red-500';
}

export default function DeparturesPanel() {
  const startTime = useApp((s) => s.settings.startTime);
  const reversedNow = useApp((s) => s.settings.reversed);
  const departures = useApp((s) => s.departures);
  const status = useApp((s) => s.departuresStatus);
  const ready = useApp((s) => s.weatherStatus === 'ready');
  const [withReverse, setWithReverse] = useState(true);
  const { offsets, starts } = hourOffsetsAround(startTime);
  const label = `Comparer ${starts.map(hourLabel).join(' / ')}`;
  const sorted = [...departures].sort(
    (a, b) => a.startTime - b.startTime || Number(a.reversed) - Number(b.reversed),
  );

  return (
    <Section title="Comparer les départs" icon={<IconClock size={14} />}>
      <div className="space-y-2.5">
        <Switch checked={withReverse} onChange={setWithReverse} label="Inclure le sens inverse" />
        <Button
          className="w-full"
          onClick={() => void computeDepartures(offsets, withReverse)}
          disabled={!ready || status === 'loading'}
        >
          {status === 'loading' ? 'Comparaison…' : label}
        </Button>
        {status === 'loading' && (
          <div className="space-y-1.5">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-14 w-full rounded-2xl" />
            ))}
          </div>
        )}
        {status === 'ready' && sorted.length > 0 && (
          <ul className="space-y-1.5" aria-label="Options de départ">
            {sorted.map((d, i) => {
              const current = Math.abs(d.startTime - startTime) < 60_000 && d.reversed === reversedNow;
              return (
                <motion.li
                  key={`${d.startTime}-${d.reversed}`}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.03 }}
                  className={cx(
                    'rounded-2xl px-3 py-2.5',
                    d.isBest
                      ? 'bg-gradient-to-r from-accent-from/20 to-accent-to/20 ring-1 ring-sky-400/50'
                      : 'bg-tile',
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className="tabular text-sm font-semibold text-fg">{fmtTime(d.startTime)}</span>
                    {d.reversed && (
                      <span className="inline-flex items-center gap-0.5 rounded-full bg-tile-hover px-1.5 py-0.5 text-[10px] font-medium text-fg-muted">
                        <IconSwap size={11} /> inverse
                      </span>
                    )}
                    {d.isBest && (
                      <span className="rounded-full bg-sky-500 px-2 py-0.5 text-[10px] font-semibold text-white">
                        Meilleure fenêtre
                      </span>
                    )}
                    <span
                      className="tabular ml-auto text-sm font-semibold text-fg"
                      aria-label={`Score de confort ${Math.round(d.comfortScore)} sur 100`}
                    >
                      {Math.round(d.comfortScore)}
                    </span>
                  </div>
                  <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line" aria-hidden="true">
                    <motion.div
                      className={cx('h-full rounded-full bg-gradient-to-r', scoreColor(d.comfortScore))}
                      initial={{ width: 0 }}
                      animate={{ width: `${Math.max(3, Math.min(100, d.comfortScore))}%` }}
                      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
                    />
                  </div>
                  <div className="tabular mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
                    <span>{fmtDuration(d.durationSec)}</span>
                    <span>Face {Math.round(d.headwindShare * 100)} %</span>
                    <span>Pluie {Math.round(d.maxPrecipProbability)} %</span>
                    <span>Min {Math.round(d.minTemp)} °C</span>
                    {current ? (
                      <span className="ml-auto text-sky-500 dark:text-sky-300">Départ actuel</span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          updateSettings({ startTime: d.startTime, reversed: d.reversed }, true);
                          toast(
                            `Départ réglé à ${fmtTime(d.startTime)}${d.reversed ? ' (sens inverse)' : ''}`,
                            'success',
                          );
                        }}
                        className="focus-ring ml-auto rounded-full px-2 py-0.5 font-medium text-sky-600 hover:bg-sky-500/10 dark:text-sky-300"
                      >
                        Utiliser ce départ
                      </button>
                    )}
                  </div>
                </motion.li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
}
