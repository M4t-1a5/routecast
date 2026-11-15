import type { Route, Timing } from '../../types';
import { lerp } from './geo';

/** Plus grand indice i tel que arr[i] <= x (arr croissant), borné à [0, n-1]. */
function lowerIndex(arr: ArrayLike<number>, x: number): number {
  let lo = 0;
  let hi = arr.length - 1;
  if (hi <= 0 || x <= arr[0]) return 0;
  if (x >= arr[hi]) return hi;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] <= x) lo = mid;
    else hi = mid;
  }
  return lo;
}

/** Position interpolée sur la trace à l'instant t (pour l'animation). Clampée au départ/arrivée. */
export function positionAtTime(
  route: Route,
  timing: Timing,
  t: number,
): { index: number; lat: number; lon: number; dist: number } {
  const pts = route.points;
  if (pts.length === 0) return { index: 0, lat: 0, lon: 0, dist: 0 };
  const etas = timing.etas;
  const last = Math.min(pts.length, etas.length) - 1;
  if (last <= 0 || t <= etas[0]) return { index: 0, lat: pts[0].lat, lon: pts[0].lon, dist: pts[0].dist };
  if (t >= etas[last]) return { index: last, lat: pts[last].lat, lon: pts[last].lon, dist: pts[last].dist };
  const i = Math.min(lowerIndex(etas, t), last - 1);
  const span = etas[i + 1] - etas[i];
  const f = span > 0 ? (t - etas[i]) / span : 0;
  const a = pts[i];
  const b = pts[i + 1];
  return { index: i, lat: lerp(a.lat, b.lat, f), lon: lerp(a.lon, b.lon, f), dist: lerp(a.dist, b.dist, f) };
}

/** Index du RoutePoint le plus proche d'une distance (m). */
export function indexAtDistance(route: Route, dist: number): number {
  const pts = route.points;
  if (pts.length <= 1) return 0;
  const dists = pts.map((p) => p.dist);
  const i = lowerIndex(dists, dist);
  if (i >= pts.length - 1) return pts.length - 1;
  return dist - dists[i] <= dists[i + 1] - dist ? i : i + 1;
}

/** Bounding box [w, s, e, n]. */
export function routeBounds(route: Route): [number, number, number, number] {
  if (route.points.length === 0) return [0, 0, 0, 0];
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of route.points) {
    if (p.lon < w) w = p.lon;
    if (p.lon > e) e = p.lon;
    if (p.lat < s) s = p.lat;
    if (p.lat > n) n = p.lat;
  }
  return [w, s, e, n];
}
