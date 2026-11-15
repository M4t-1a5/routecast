import type { ConfidenceSummary, PointWeather, RideStats, Route, Timing } from '../../types';

/** Météo indexée par routeIndex (le tableau peut avoir des trous). */
export function weatherByIndex(weather: PointWeather[]): Map<number, PointWeather> {
  return new Map(weather.map((w) => [w.routeIndex, w]));
}

/**
 * Statistiques de sortie. Parts vent de face/dos selon `windRelation` (règle angulaire pure),
 * pondérées par la longueur des segments. Cumul pluie = Σ mm/h × durée du segment (h).
 * Avec `weather` vide : valeurs météo neutres (0).
 */
export function computeRideStats(
  route: Route,
  timing: Timing,
  weather: PointWeather[],
  confidence: ConfidenceSummary | null,
): RideStats {
  const pts = route.points;
  const byIdx = weatherByIndex(weather);
  let head = 0;
  let tail = 0;
  let covered = 0;
  let precip = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const w = byIdx.get(i);
    if (!w) continue;
    const len = Math.max(0, pts[i + 1].dist - pts[i].dist);
    covered += len;
    if (w.windRelation === 'head') head += len;
    else if (w.windRelation === 'tail') tail += len;
    const dtH = Math.max(0, (timing.etas[i + 1] ?? 0) - (timing.etas[i] ?? 0)) / 3_600_000;
    precip += Math.max(0, w.precipitation) * dtH;
  }
  const temps = weather.map((w) => w.temperature);
  return {
    distance: route.stats.distance,
    ascent: route.stats.ascent,
    descent: route.stats.descent,
    durationSec: timing.durationSec,
    arrival: timing.arrival,
    avgSpeedKmh: timing.avgSpeedKmh,
    headwindShare: covered > 0 ? head / covered : 0,
    tailwindShare: covered > 0 ? tail / covered : 0,
    minTemp: temps.length ? Math.min(...temps) : 0,
    maxTemp: temps.length ? Math.max(...temps) : 0,
    maxPrecipProbability: weather.length ? Math.max(...weather.map((w) => w.precipitationProbability)) : 0,
    totalPrecipitation: Math.round(precip * 10) / 10,
    confidence: confidence?.score ?? null,
  };
}
