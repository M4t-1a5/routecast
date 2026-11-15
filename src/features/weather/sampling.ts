import type { ForecastHorizon, Route } from '../../types';

const DAY = 86_400_000;
export const MAX_SAMPLES = 40;

export function forecastHorizon(startMs: number, nowMs = Date.now()): ForecastHorizon {
  const daysAhead = (startMs - nowMs) / DAY;
  if (daysAhead < -0.1) return { kind: 'past', daysAhead };
  if (daysAhead > 16) return { kind: 'too-far', daysAhead };
  if (daysAhead > 7) return { kind: 'low-reliability', daysAhead };
  return { kind: 'ok', daysAhead };
}

/** Pas d'échantillonnage (m) selon la longueur totale. */
export function sampleSpacing(totalM: number): number {
  if (totalM < 60_000) return 5_000;
  if (totalM <= 150_000) return 7_000;
  return 10_000;
}

/** Index du point dont la distance cumulée est la plus proche de `d` (points triés par dist). */
export function nearestIndexByDist(route: Route, d: number): number {
  const pts = route.points;
  let lo = 0;
  let hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].dist <= d) lo = mid;
    else hi = mid;
  }
  return Math.abs(pts[lo].dist - d) <= Math.abs(pts[hi].dist - d) ? lo : hi;
}

/** Indices des RoutePoints à échantillonner (1 tous les 5–10 km selon la longueur, départ et arrivée inclus, ≤ 40). */
export function pickSampleIndices(route: Route): number[] {
  const n = route.points.length;
  if (n === 0) return [];
  if (n === 1) return [0];
  const total = route.points[n - 1].dist;
  const count = Math.max(2, Math.min(MAX_SAMPLES, Math.round(total / sampleSpacing(total)) + 1));
  const out = new Set<number>();
  for (let k = 0; k < count; k++) out.add(nearestIndexByDist(route, (total * k) / (count - 1)));
  out.add(0);
  out.add(n - 1);
  return [...out].sort((a, b) => a - b);
}
