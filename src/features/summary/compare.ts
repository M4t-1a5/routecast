import type { DepartureOption, RideSettings, Route, WeatherSample } from '../../types';
import { computeTiming, reverseRoute } from '../route';
import { interpolateAlongRoute, makeWindProvider } from '../weather/interpolate';
import { computeRideStats } from './stats';
import { buildSummary } from './summary';

/** Remappe les échantillons de la route d'origine vers la route inversée. */
export function reverseSamples(route: Route, samples: WeatherSample[]): WeatherSample[] {
  const n = route.points.length;
  const total = route.stats.distance || route.points[n - 1]?.dist || 0;
  return samples
    .map((s) => ({ ...s, routeIndex: n - 1 - s.routeIndex, dist: total - s.dist }))
    .sort((a, b) => a.routeIndex - b.routeIndex);
}

/**
 * Compare plusieurs heures de départ (et éventuellement le sens inverse).
 * Les `samples` doivent couvrir toute la fenêtre.
 */
export function compareDepartures(
  route: Route,
  settings: RideSettings,
  samples: WeatherSample[],
  startTimes: number[],
  includeReverse: boolean,
): DepartureOption[] {
  const variants: { reversed: boolean; route: Route; samples: WeatherSample[] }[] = [
    { reversed: false, route, samples: [...samples].sort((a, b) => a.routeIndex - b.routeIndex) },
  ];
  if (includeReverse)
    variants.push({ reversed: true, route: reverseRoute(route), samples: reverseSamples(route, samples) });

  const options: DepartureOption[] = [];
  for (const v of variants) {
    const wind = makeWindProvider(v.samples);
    for (const startTime of startTimes) {
      let speedModel = settings.speedModel;
      if (speedModel.kind === 'replay' && (v.reversed || !v.route.hasRecordedTime)) {
        speedModel = { kind: 'fixed', speedKmh: 25 };
      }
      const s: RideSettings = { ...settings, startTime, reversed: v.reversed, speedModel };
      const timing = computeTiming(v.route, s, speedModel.kind === 'power' ? wind : undefined);
      const weather = interpolateAlongRoute(v.route, timing, v.samples);
      const stats = computeRideStats(v.route, timing, weather, null);
      const summary = buildSummary(v.route, timing, weather, stats);
      options.push({
        startTime,
        reversed: v.reversed,
        comfortScore: summary.comfortScore,
        durationSec: timing.durationSec,
        headwindShare: stats.headwindShare,
        maxPrecipProbability: stats.maxPrecipProbability,
        minTemp: stats.minTemp,
        isBest: false,
      });
    }
  }
  options.sort((a, b) => a.startTime - b.startTime || Number(a.reversed) - Number(b.reversed));
  if (options.length) {
    const best = options.reduce((a, o) => (o.comfortScore > a.comfortScore ? o : a));
    best.isBest = true;
  }
  return options;
}
