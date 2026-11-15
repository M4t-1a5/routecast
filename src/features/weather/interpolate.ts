import type {
  PointWeather,
  Route,
  Timing,
  WeatherHour,
  WeatherSample,
  WeatherValues,
  WindProvider,
} from '../../types';
import { blendDirection, relativeWind } from './wind';

const lerp = (a: number, b: number, w: number) => a + (b - a) * w;

/** Mélange de deux jeux de valeurs (w = poids de b). Vent par composantes, code/jour au plus proche. */
export function blendValues(a: WeatherValues, b: WeatherValues, w: number): WeatherValues {
  if (w <= 0) return a;
  if (w >= 1) return b;
  const near = w < 0.5 ? a : b;
  return {
    temperature: lerp(a.temperature, b.temperature, w),
    apparentTemperature: lerp(a.apparentTemperature, b.apparentTemperature, w),
    precipitation: lerp(a.precipitation, b.precipitation, w),
    precipitationProbability: lerp(a.precipitationProbability, b.precipitationProbability, w),
    windSpeed: lerp(a.windSpeed, b.windSpeed, w),
    windDirection: blendDirection(a.windDirection, a.windSpeed, b.windDirection, b.windSpeed, w),
    windGusts: lerp(a.windGusts, b.windGusts, w),
    cloudCover: lerp(a.cloudCover, b.cloudCover, w),
    weatherCode: near.weatherCode,
    isDay: near.isDay,
  };
}

function strip(h: WeatherHour): WeatherValues {
  return {
    temperature: h.temperature,
    apparentTemperature: h.apparentTemperature,
    precipitation: h.precipitation,
    precipitationProbability: h.precipitationProbability,
    windSpeed: h.windSpeed,
    windDirection: h.windDirection,
    windGusts: h.windGusts,
    cloudCover: h.cloudCover,
    weatherCode: h.weatherCode,
    isDay: h.isDay,
  };
}

/** Valeurs à l'instant t dans une série horaire triée (linéaire entre heures, bornée aux extrémités). */
export function valuesAtTime(hours: WeatherHour[], t: number): WeatherValues | null {
  const n = hours.length;
  if (!n) return null;
  if (t <= hours[0].time) return strip(hours[0]);
  if (t >= hours[n - 1].time) return strip(hours[n - 1]);
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (hours[mid].time <= t) lo = mid;
    else hi = mid;
  }
  const a = hours[lo];
  const b = hours[hi];
  const w = (t - a.time) / (b.time - a.time || 1);
  return blendValues(strip(a), strip(b), w);
}

/**
 * Valeurs interpolées au RoutePoint `routeIndex` à l'instant `timeMs` :
 * linéaire en temps dans chaque échantillon, puis entre les 2 échantillons encadrants.
 * La pondération spatiale se fait sur l'index (points rééchantillonnés à pas constant ≈ distance).
 */
export function weatherAt(
  samples: WeatherSample[],
  routeIndex: number,
  timeMs: number,
): WeatherValues | null {
  const valid = samples.filter((s) => s.hours.length > 0);
  if (!valid.length) return null;
  let s0 = valid[0];
  let s1 = valid[valid.length - 1];
  if (routeIndex <= s0.routeIndex) return valuesAtTime(s0.hours, timeMs);
  if (routeIndex >= s1.routeIndex) return valuesAtTime(s1.hours, timeMs);
  for (let k = 0; k < valid.length - 1; k++) {
    if (valid[k].routeIndex <= routeIndex && valid[k + 1].routeIndex >= routeIndex) {
      s0 = valid[k];
      s1 = valid[k + 1];
      break;
    }
  }
  const a = valuesAtTime(s0.hours, timeMs);
  const b = valuesAtTime(s1.hours, timeMs);
  if (!a || !b) return a ?? b;
  const span = s1.routeIndex - s0.routeIndex;
  const w = span > 0 ? (routeIndex - s0.routeIndex) / span : 0;
  return blendValues(a, b, w);
}

/** Météo à chaque RoutePoint à son heure de passage, vent relatif inclus. */
export function interpolateAlongRoute(
  route: Route,
  timing: Timing,
  samples: WeatherSample[],
): PointWeather[] {
  const sorted = [...samples].sort((a, b) => a.routeIndex - b.routeIndex);
  if (!sorted.some((s) => s.hours.length)) return [];
  const out: PointWeather[] = [];
  route.points.forEach((p, i) => {
    const t = timing.etas[i] ?? timing.etas[timing.etas.length - 1];
    const v = weatherAt(sorted, i, t);
    if (!v) return;
    const rel = relativeWind(p.bearing, v.windDirection, v.windSpeed);
    out.push({
      ...v,
      routeIndex: i,
      time: t,
      headwind: rel.headwind,
      crosswind: rel.crosswind,
      windRelation: rel.relation,
    });
  });
  return out;
}

/** WindProvider pour le modèle de puissance. */
export function makeWindProvider(samples: WeatherSample[]): WindProvider {
  const sorted = [...samples].sort((a, b) => a.routeIndex - b.routeIndex);
  return (i, t) => {
    const v = weatherAt(sorted, i, t);
    return v ? { speedKmh: v.windSpeed, directionDeg: v.windDirection } : null;
  };
}
