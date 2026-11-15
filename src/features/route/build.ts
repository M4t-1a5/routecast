import type { ParsedTrack, RawPoint, Route, RoutePoint, RouteStats } from '../../types';
import { ImportError } from '../import/errors';
import { haversine, initialBearing, lerp } from './geo';
import { detectClimbs } from './climbs';

/** Écart minimal entre deux points pour ne pas être considérés comme doublons (m). */
const DUPLICATE_EPS_M = 0.5;
/** Saut au-delà duquel un point isolé est jugé aberrant (m). */
const MAX_JUMP_M = 5000;
/** Seuil d'hystérésis pour le cumul D+/D- (m). */
export const ELEVATION_HYSTERESIS_M = 2;
/** Pente bornée (%). */
export const MAX_GRADE = 30;
/** Distance de demi-fenêtre visée pour le lissage d'altitude (m). */
const SMOOTH_HALF_WINDOW_M = 200;

interface Work {
  lat: number;
  lon: number;
  ele: number | null;
  time: number | null;
}

/** 1) Supprime coordonnées invalides, doublons consécutifs et pointes aberrantes (> 5 km). */
export function cleanPoints(points: RawPoint[]): Work[] {
  const valid = points.filter(
    (p) =>
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lon) &&
      Math.abs(p.lat) <= 90 &&
      Math.abs(p.lon) <= 180 &&
      !(p.lat === 0 && p.lon === 0),
  );

  // Pointes : point loin de ses deux voisins alors que ceux-ci sont proches entre eux.
  const d = (a: Work, b: Work) => haversine(a.lat, a.lon, b.lat, b.lon);
  const noSpikes: Work[] = [];
  for (let i = 0; i < valid.length; i++) {
    const p = valid[i];
    const prev = noSpikes[noSpikes.length - 1];
    const next = valid[i + 1];
    if (prev && next && d(prev, p) > MAX_JUMP_M && d(p, next) > MAX_JUMP_M && d(prev, next) <= MAX_JUMP_M)
      continue;
    // Extrémités : premier/dernier point détaché du reste.
    if (!prev && next && valid[i + 2] && d(p, next) > MAX_JUMP_M && d(next, valid[i + 2]) <= MAX_JUMP_M)
      continue;
    if (prev && !next && noSpikes.length >= 2 && d(prev, p) > MAX_JUMP_M) continue;
    noSpikes.push({ ...p });
  }

  // Doublons consécutifs (on garde le premier, complété par l'altitude du suivant si absente).
  const out: Work[] = [];
  for (const p of noSpikes) {
    const last = out[out.length - 1];
    if (last && d(last, p) < DUPLICATE_EPS_M) {
      if (last.ele == null && p.ele != null) last.ele = p.ele;
      continue;
    }
    out.push(p);
  }
  return out;
}

/** Remplit les valeurs nulles par interpolation linéaire selon la distance (extrémités : plus proche connue). */
export function fillByDistance(values: (number | null)[], dist: number[], fallback: number): number[] {
  const known: number[] = [];
  values.forEach((v, i) => {
    if (v != null && Number.isFinite(v)) known.push(i);
  });
  if (known.length === 0) return values.map(() => fallback);
  const out = new Array<number>(values.length);
  let k = 0;
  for (let i = 0; i < values.length; i++) {
    while (k < known.length - 1 && known[k + 1] <= i) k++;
    const a = known[k];
    if (i <= known[0]) out[i] = values[known[0]] as number;
    else if (i >= known[known.length - 1]) out[i] = values[known[known.length - 1]] as number;
    else if (a === i) out[i] = values[i] as number;
    else {
      const b = known[k + 1];
      const span = dist[b] - dist[a];
      const t = span > 0 ? (dist[i] - dist[a]) / span : 0;
      out[i] = lerp(values[a] as number, values[b] as number, t);
    }
  }
  return out;
}

export function cumulativeDistances(pts: { lat: number; lon: number }[]): number[] {
  const dist = [0];
  for (let i = 1; i < pts.length; i++) {
    dist.push(dist[i - 1] + haversine(pts[i - 1].lat, pts[i - 1].lon, pts[i].lat, pts[i].lon));
  }
  return dist;
}

interface Sample {
  lat: number;
  lon: number;
  ele: number;
  time: number | null;
}

/** 3) Rééchantillonnage à pas constant le long de la polyligne (départ et arrivée conservés). */
export function resample(pts: Sample[], dist: number[], spacing: number): Sample[] {
  const total = dist[dist.length - 1];
  const n = Math.max(1, Math.round(total / spacing));
  const step = total / n;
  const out: Sample[] = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const target = k === n ? total : k * step;
    while (j < pts.length - 2 && dist[j + 1] < target) j++;
    const a = pts[j];
    const b = pts[j + 1];
    const span = dist[j + 1] - dist[j];
    const t = span > 0 ? Math.min(1, Math.max(0, (target - dist[j]) / span)) : 0;
    out.push({
      lat: lerp(a.lat, b.lat, t),
      lon: lerp(a.lon, b.lon, t),
      ele: lerp(a.ele, b.ele, t),
      time: a.time != null && b.time != null ? lerp(a.time, b.time, t) : null,
    });
  }
  return out;
}

/** 4) Lissage d'altitude : moyenne mobile à poids triangulaires (extrémités conservées). */
export function smoothElevation(ele: number[], halfWindow: number): number[] {
  const n = ele.length;
  if (halfWindow < 1 || n < 3) return ele.slice();
  const out = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const h = Math.min(halfWindow, i, n - 1 - i); // fenêtre symétrique, réduite aux bords
    let sum = 0;
    let wsum = 0;
    for (let k = -h; k <= h; k++) {
      const w = h + 1 - Math.abs(k);
      sum += ele[i + k] * w;
      wsum += w;
    }
    out[i] = sum / wsum;
  }
  return out;
}

/** 5) D+/D- avec hystérésis, min/max. */
export function elevationStats(
  ele: number[],
  threshold = ELEVATION_HYSTERESIS_M,
): Omit<RouteStats, 'distance'> {
  let ascent = 0;
  let descent = 0;
  let ref = ele[0] ?? 0;
  let minEle = Infinity;
  let maxEle = -Infinity;
  for (const e of ele) {
    if (e < minEle) minEle = e;
    if (e > maxEle) maxEle = e;
    if (e - ref >= threshold) {
      ascent += e - ref;
      ref = e;
    } else if (ref - e >= threshold) {
      descent += ref - e;
      ref = e;
    }
  }
  // Reliquat final sous le seuil : comptabilisé pour coller à l'écart départ/arrivée.
  const last = ele[ele.length - 1] ?? ref;
  if (last > ref) ascent += last - ref;
  else descent += ref - last;
  if (!Number.isFinite(minEle)) minEle = maxEle = 0;
  return { ascent, descent, minEle, maxEle };
}

/** 6) Distances, pentes (bornées) et caps à partir de lat/lon/ele. */
export function toRoutePoints(
  pts: { lat: number; lon: number; ele: number; elapsed: number | null }[],
): RoutePoint[] {
  const dist = cumulativeDistances(pts);
  const out: RoutePoint[] = pts.map((p, i) => ({
    lat: p.lat,
    lon: p.lon,
    ele: p.ele,
    dist: dist[i],
    grade: 0,
    bearing: 0,
    elapsed: p.elapsed,
  }));
  for (let i = 0; i < out.length - 1; i++) {
    const a = out[i];
    const b = out[i + 1];
    const len = b.dist - a.dist;
    const g = len > 0 ? ((b.ele - a.ele) / len) * 100 : 0;
    a.grade = Math.max(-MAX_GRADE, Math.min(MAX_GRADE, g));
    a.bearing = initialBearing(a.lat, a.lon, b.lat, b.lon);
  }
  if (out.length >= 2) {
    out[out.length - 1].grade = out[out.length - 2].grade;
    out[out.length - 1].bearing = out[out.length - 2].bearing;
  }
  return out;
}

export function computeStats(points: RoutePoint[]): RouteStats {
  return {
    distance: points.length ? points[points.length - 1].dist : 0,
    ...elevationStats(points.map((p) => p.ele)),
  };
}

function makeId(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `r-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

/** Nettoie (doublons, altitudes manquantes), rééchantillonne (~spacing m), lisse l'altitude, calcule stats/pente/cap/montées. */
export function buildRoute(parsed: ParsedTrack, opts: { spacing?: number; id?: string } = {}): Route {
  const spacing = opts.spacing && opts.spacing > 0 ? opts.spacing : 100;
  const cleaned = cleanPoints(parsed.points);
  if (cleaned.length < 2) {
    throw new ImportError('La trace est trop courte : au moins deux points distincts sont nécessaires.');
  }
  const dist = cumulativeDistances(cleaned);

  // 2) Altitudes manquantes interpolées (0 si aucune).
  const ele = fillByDistance(
    cleaned.map((p) => p.ele),
    dist,
    0,
  );

  // Temps : seulement si l'enregistrement en contient ; monotonie forcée.
  let times: (number | null)[] = cleaned.map(() => null);
  if (parsed.hasTime) {
    const filled = fillByDistance(
      cleaned.map((p) => p.time),
      dist,
      NaN,
    );
    if (filled.every(Number.isFinite)) {
      let max = -Infinity;
      times = filled.map((t) => (max = Math.max(max, t)));
    }
  }

  const samples = resample(
    cleaned.map((p, i) => ({ lat: p.lat, lon: p.lon, ele: ele[i], time: times[i] })),
    dist,
    spacing,
  );
  const half = Math.max(2, Math.round(SMOOTH_HALF_WINDOW_M / spacing));
  const smoothed = smoothElevation(
    samples.map((s) => s.ele),
    half,
  );
  const t0 = samples[0].time;
  const hasRecordedTime = t0 != null && samples.every((s) => s.time != null);

  const points = toRoutePoints(
    samples.map((s, i) => ({
      lat: s.lat,
      lon: s.lon,
      ele: smoothed[i],
      elapsed: hasRecordedTime ? ((s.time as number) - (t0 as number)) / 1000 : null,
    })),
  );

  return {
    id: opts.id ?? makeId(),
    name: parsed.name,
    source: parsed.source,
    sport: parsed.sport ?? 'cycling',
    createdAt: Date.now(),
    points,
    stats: computeStats(points),
    climbs: detectClimbs(points),
    hasRecordedTime,
  };
}

/** Renvoie la trace parcourue en sens inverse (distances, pentes, caps recalculés ; elapsed = null). */
export function reverseRoute(route: Route): Route {
  const points = toRoutePoints(
    route.points
      .slice()
      .reverse()
      .map((p) => ({ lat: p.lat, lon: p.lon, ele: p.ele, elapsed: null })),
  );
  return {
    ...route,
    points,
    // D+ et D- s'échangent (évite l'asymétrie de l'hystérésis).
    stats: { ...computeStats(points), ascent: route.stats.descent, descent: route.stats.ascent },
    climbs: detectClimbs(points),
    hasRecordedTime: false,
  };
}
