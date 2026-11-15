import type { MapLayer } from '../../types';
import { useApp } from '../../store/useApp';
import {
  PRECIP_LEVELS,
  PRECIP_STOPS,
  TEMP_STOPS,
  WIND_RELATION_COLORS,
  WIND_STOPS,
  cssGradient,
} from '../../lib/colors';
import { glass } from './ui';

export type RainMode = 'radar' | 'forecast';

/** Légende de la couche active. */
export default function MapLegend({
  layer,
  rainMode = 'forecast',
  className = '',
}: {
  layer: MapLayer;
  rainMode?: RainMode;
  className?: string;
}) {
  const theme = useApp((s) => s.theme);
  const muted = theme === 'dark' ? 'text-white/70' : 'text-slate-600';

  let title: string;
  let gradient: string;
  let labels: string[];
  if (layer === 'wind') {
    title = 'Vent (km/h)';
    gradient = cssGradient(WIND_STOPS);
    labels = ['0', '30', '60', '90', '120'];
  } else if (layer === 'rain') {
    title = rainMode === 'radar' ? 'Radar pluie (RainViewer)' : 'Précipitations prévues';
    gradient = cssGradient(PRECIP_STOPS);
    labels = PRECIP_LEVELS.map((l) => l.label);
  } else {
    title = 'Température (°C)';
    gradient = cssGradient(TEMP_STOPS);
    labels = ['-40', '-20', '0', '20', '40', '55'];
  }

  return (
    <div
      className={`${glass(theme)} pointer-events-auto w-full px-3 py-2 text-xs ${className}`}
      aria-label={`Légende : ${title}`}
      role="group"
    >
      <div className="mb-1.5 font-medium">{title}</div>
      <div className="h-2 rounded-full" style={{ background: gradient }} aria-hidden="true" />
      <div className={`mt-1 flex justify-between tabular-nums ${muted}`}>
        {labels.map((l) => (
          <span key={l}>{l}</span>
        ))}
      </div>
      {layer === 'wind' && (
        <div className={`mt-2 flex flex-wrap gap-x-3 gap-y-1 ${muted}`}>
          {(
            [
              ['tail', 'Dos'],
              ['cross', 'Travers'],
              ['head', 'Face'],
            ] as const
          ).map(([k, l]) => (
            <span key={k} className="flex items-center gap-1">
              <span
                className="inline-block h-1.5 w-3 rounded-full"
                style={{ background: WIND_RELATION_COLORS[k] }}
              />
              {l}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
