/** Helpers de test : construisent des Route / Timing / WeatherSample à la main (sans buildRoute). */
import type {
  Climb,
  PointWeather,
  Route,
  RoutePoint,
  Timing,
  WeatherHour,
  WeatherSample,
} from '../../../types';
import { relativeWind } from '../wind';

const M_PER_DEG = 111_320;

/** Trace en segments rectilignes [longueur km, cap °], points tous les `spacing` m. */
export function makeRoute(
  legs: [km: number, bearing: number][],
  opts: { spacing?: number; climbs?: Climb[]; sport?: Route['sport'] } = {},
): Route {
  const spacing = opts.spacing ?? 100;
  const pts: RoutePoint[] = [];
  let lat = 48.9;
  let lon = 2.2;
  let dist = 0;
  const push = (bearing: number) => pts.push({ lat, lon, ele: 50, dist, grade: 0, bearing, elapsed: null });
  for (const [km, bearing] of legs) {
    const steps = Math.round((km * 1000) / spacing);
    for (let s = 0; s < steps; s++) {
      push(bearing);
      const r = (bearing * Math.PI) / 180;
      lat += (spacing * Math.cos(r)) / M_PER_DEG;
      lon += (spacing * Math.sin(r)) / (M_PER_DEG * Math.cos((lat * Math.PI) / 180));
      dist += spacing;
    }
  }
  push(legs[legs.length - 1]?.[1] ?? 0);
  return {
    id: 'test',
    name: 'Test',
    source: 'demo',
    sport: opts.sport ?? 'cycling',
    createdAt: 0,
    points: pts,
    stats: { distance: dist, ascent: 0, descent: 0, minEle: 50, maxEle: 50 },
    climbs: opts.climbs ?? [],
    hasRecordedTime: false,
  };
}

/** Timing à vitesse constante. */
export function makeTiming(route: Route, startMs: number, speedKmh = 25): Timing {
  const etas = route.points.map((p) => startMs + (p.dist / 1000 / speedKmh) * 3_600_000);
  const durationSec = (etas[etas.length - 1] - startMs) / 1000;
  return {
    etas,
    speeds: route.points.map(() => speedKmh),
    durationSec,
    avgSpeedKmh: speedKmh,
    arrival: etas[etas.length - 1],
  };
}

export const BASE_HOUR: Omit<WeatherHour, 'time'> = {
  temperature: 15,
  apparentTemperature: 15,
  precipitation: 0,
  precipitationProbability: 0,
  windSpeed: 0,
  windDirection: 0,
  windGusts: 10,
  cloudCover: 50,
  weatherCode: 2,
  isDay: true,
};

/** Série horaire de `n` heures à partir de `startMs` (arrondi à l'heure). */
export function makeHours(
  startMs: number,
  n: number,
  f: (k: number) => Partial<WeatherHour> = () => ({}),
): WeatherHour[] {
  const t0 = Math.floor(startMs / 3_600_000) * 3_600_000;
  return Array.from({ length: n }, (_, k) => ({ ...BASE_HOUR, time: t0 + k * 3_600_000, ...f(k) }));
}

export function makeSamples(
  route: Route,
  indices: number[],
  hours: (i: number) => WeatherHour[],
): WeatherSample[] {
  return indices.map((i) => ({
    lat: route.points[i].lat,
    lon: route.points[i].lon,
    routeIndex: i,
    dist: route.points[i].dist,
    hours: hours(i),
  }));
}

/** PointWeather uniforme pour chaque point (vent relatif calculé). */
export function makeWeather(
  route: Route,
  timing: Timing,
  f: (i: number) => Partial<WeatherHour> = () => ({}),
): PointWeather[] {
  return route.points.map((p, i) => {
    const v = { ...BASE_HOUR, ...f(i) };
    const rel = relativeWind(p.bearing, v.windDirection, v.windSpeed);
    return {
      ...v,
      routeIndex: i,
      time: timing.etas[i],
      headwind: rel.headwind,
      crosswind: rel.crosswind,
      windRelation: rel.relation,
    };
  });
}
