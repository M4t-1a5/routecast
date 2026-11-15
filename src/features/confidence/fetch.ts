import type { WeatherSample } from '../../types';
import { ENSEMBLE_URL, FORECAST_URL, fetchHourlyBlocks, type EndpointSpec } from '../weather/api';
import type { HourlyBlock } from '../weather/cache';

const HOUR = 3_600_000;

export interface MemberHour {
  time: number;
  temperature: number[];
  windSpeed: number[];
  precipitation: number[];
}

/** Données brutes pour le calcul : membres d'ensemble et modèles déterministes aux points échantillonnés. */
export interface ConfidenceInputs {
  /** Par échantillon (même ordre que samples) : par heure (epoch ms) → valeurs des membres. */
  ensemble: MemberHour[][];
  /** Par échantillon : par heure → valeurs par modèle (ecmwf, icon, gfs, meteofrance). */
  models: MemberHour[][];
}

const VARS = {
  temperature: 'temperature_2m',
  windSpeed: 'wind_speed_10m',
  precipitation: 'precipitation',
} as const;
const HOURLY = Object.values(VARS).join(',');

export const ENSEMBLE_MODELS = 'icon_seamless,gfs_seamless,ecmwf_ifs025';
export const DETERMINISTIC_MODELS = 'ecmwf_ifs025,icon_seamless,gfs_seamless,meteofrance_seamless';

export const ENSEMBLE_SPEC: EndpointSpec = {
  url: ENSEMBLE_URL,
  ns: 'ens1',
  params: { hourly: HOURLY, models: ENSEMBLE_MODELS, wind_speed_unit: 'kmh' },
  ttlMs: 3 * HOUR,
  maxDaysAhead: 15,
};

export const MODELS_SPEC: EndpointSpec = {
  url: FORECAST_URL,
  ns: 'mm1',
  params: { hourly: HOURLY, models: DETERMINISTIC_MODELS, wind_speed_unit: 'kmh' },
  ttlMs: HOUR,
  maxDaysAhead: 15,
};

/** Nombre max de points interrogés (ensemble / multi-modèles), étendus aux autres par plus proche voisin. */
export const ENSEMBLE_POINTS = 6;
export const MODEL_POINTS = 12;

/**
 * Clés d'une variable dans une réponse Open-Meteo multi-membres/multi-modèles.
 * Formats constatés :
 *  - ensemble : `temperature_2m_icon_seamless_eps` (contrôle), `temperature_2m_member01_icon_seamless_eps`,
 *    `…_ncep_gefs_seamless`, `…_ecmwf_ifs025_ensemble` ;
 *  - multi-modèles : `temperature_2m_ecmwf_ifs025`, `temperature_2m_meteofrance_seamless`… ;
 *  - un seul modèle : `temperature_2m`.
 */
export function keysFor(data: Record<string, unknown>, variable: string): string[] {
  return Object.keys(data).filter(
    (k) => (k === variable || k.startsWith(`${variable}_`)) && !k.startsWith(`${variable}_probability`),
  );
}

/** Convertit un bloc horaire brut en valeurs par heure (toutes les clés de chaque variable, nulls ignorés). */
export function parseMemberBlock(block: HourlyBlock): MemberHour[] {
  const kT = keysFor(block.data, VARS.temperature);
  const kW = keysFor(block.data, VARS.windSpeed);
  const kP = keysFor(block.data, VARS.precipitation);
  const pick = (keys: string[], i: number) =>
    keys.map((k) => block.data[k][i]).filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const out: MemberHour[] = [];
  block.time.forEach((time, i) => {
    const h = { time, temperature: pick(kT, i), windSpeed: pick(kW, i), precipitation: pick(kP, i) };
    if (h.temperature.length || h.windSpeed.length || h.precipitation.length) out.push(h);
  });
  return out;
}

/** k indices répartis régulièrement dans [0, n). */
export function spreadIndices(n: number, k: number): number[] {
  if (n <= k) return Array.from({ length: n }, (_, i) => i);
  const out = new Set<number>();
  for (let j = 0; j < k; j++) out.add(Math.round((j * (n - 1)) / (k - 1)));
  return [...out];
}

async function fetchSubset(
  spec: EndpointSpec,
  samples: WeatherSample[],
  maxPoints: number,
  startMs: number,
  endMs: number,
): Promise<MemberHour[][]> {
  try {
    const subset = spreadIndices(samples.length, maxPoints);
    const blocks = await fetchHourlyBlocks(
      spec,
      subset.map((i) => ({ lat: samples[i].lat, lon: samples[i].lon })),
      startMs - HOUR,
      endMs + HOUR,
    );
    const parsed = blocks.map(parseMemberBlock);
    if (!parsed.some((p) => p.length)) return [];
    // Plus proche voisin (distance le long de la trace) pour les autres échantillons.
    return samples.map((s) => {
      let best = 0;
      subset.forEach((si, k) => {
        if (Math.abs(samples[si].dist - s.dist) < Math.abs(samples[subset[best]].dist - s.dist)) best = k;
      });
      return parsed[best];
    });
  } catch {
    return [];
  }
}

/** Appels Ensemble API + forecast multi-modèles, groupés et en cache. Ne lève pas : tableaux vides en cas d'échec. */
export async function fetchConfidenceInputs(
  samples: WeatherSample[],
  startMs: number,
  endMs: number,
): Promise<ConfidenceInputs> {
  if (!samples.length) return { ensemble: [], models: [] };
  const [ensemble, models] = await Promise.all([
    fetchSubset(ENSEMBLE_SPEC, samples, ENSEMBLE_POINTS, startMs, endMs),
    fetchSubset(MODELS_SPEC, samples, MODEL_POINTS, startMs, endMs),
  ]);
  return { ensemble, models };
}
