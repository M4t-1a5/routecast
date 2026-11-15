import { describe, expect, it, vi } from 'vitest';
import type { ConfidenceSummary, RideSettings } from '../../types';
import { buildSummary, compareDepartures, computeRideStats } from './index';
import { reverseSamples } from './compare';
import { makeHours, makeRoute, makeSamples, makeTiming, makeWeather } from '../weather/__fixtures__/routes';

vi.mock('../route', async () => {
  const f = await import('../weather/__fixtures__/routes');
  return {
    computeTiming: (route: Parameters<typeof f.makeTiming>[0], settings: RideSettings) =>
      f.makeTiming(
        route,
        settings.startTime,
        settings.speedModel.kind === 'fixed' ? settings.speedModel.speedKmh : 25,
      ),
    reverseRoute: (route: Parameters<typeof f.makeTiming>[0]) => {
      const total = route.stats.distance;
      const pts = [...route.points]
        .reverse()
        .map((p) => ({ ...p, dist: total - p.dist, bearing: (p.bearing + 180) % 360 }));
      return { ...route, points: pts };
    },
  };
});

const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 15, 8); // 9 h à Paris

describe('computeRideStats', () => {
  const route = makeRoute([
    [20, 0],
    [20, 180],
  ]);
  const timing = makeTiming(route, T0, 20);

  it('parts vent de face/dos, températures, pluie', () => {
    const weather = makeWeather(route, timing, (i) => ({
      windDirection: 0,
      windSpeed: 22,
      temperature: 10 + i / 100,
      precipitation: 1,
      precipitationProbability: i === 50 ? 70 : 10,
    }));
    const conf = { score: 77 } as ConfidenceSummary;
    const s = computeRideStats(route, timing, weather, conf);
    expect(s.distance).toBe(40_000);
    expect(s.headwindShare).toBeCloseTo(0.5, 1);
    expect(s.tailwindShare).toBeCloseTo(0.5, 1);
    expect(s.minTemp).toBe(10);
    expect(s.maxTemp).toBeCloseTo(14);
    expect(s.maxPrecipProbability).toBe(70);
    expect(s.totalPrecipitation).toBeCloseTo(2, 1); // 1 mm/h × 2 h
    expect(s.confidence).toBe(77);
    expect(s.durationSec).toBe(7200);
  });

  it('gère une météo vide', () => {
    const s = computeRideStats(route, timing, [], null);
    expect(s).toMatchObject({
      headwindShare: 0,
      tailwindShare: 0,
      minTemp: 0,
      maxTemp: 0,
      totalPrecipitation: 0,
      confidence: null,
    });
    const sum = buildSummary(route, timing, [], s);
    expect(sum.sentences.length).toBe(1);
    expect(sum.comfortScore).toBe(50);
  });
});

describe('buildSummary', () => {
  const route = makeRoute([
    [20, 0],
    [20, 180],
  ]);
  const timing = makeTiming(route, T0, 20);

  it('phrase de vent regroupée par tronçons', () => {
    const weather = makeWeather(route, timing, () => ({
      windDirection: 0,
      windSpeed: 22,
      temperature: 18,
      apparentTemperature: 18,
    }));
    const sum = buildSummary(route, timing, weather, computeRideStats(route, timing, weather, null));
    expect(sum.sentences[0]).toBe(
      'Vent de face 22 km/h sur les 20 premiers km, de dos 22 km/h sur les 20 derniers km.',
    );
  });

  it('conditions idéales et score de confort élevé', () => {
    const weather = makeWeather(route, timing, () => ({
      windSpeed: 4,
      temperature: 19,
      apparentTemperature: 19,
      cloudCover: 60,
    }));
    const sum = buildSummary(route, timing, weather, computeRideStats(route, timing, weather, null));
    expect(sum.sentences).toEqual(['Conditions idéales pour rouler.']);
    expect(sum.gear).toEqual([]);
    expect(sum.comfortScore).toBeGreaterThan(90);
  });

  it('froid, pluie, rafales, nuit → phrases et équipement', () => {
    const weather = makeWeather(route, timing, (i) => ({
      temperature: 2,
      apparentTemperature: i === 120 ? -1 : 1,
      precipitationProbability: i === 300 ? 65 : 20,
      precipitation: 0.8,
      windGusts: i === 300 ? 58 : 30,
      isDay: i < 350,
    }));
    const stats = computeRideStats(route, timing, weather, null);
    const sum = buildSummary(route, timing, weather, stats);
    const text = sum.sentences.join(' ');
    expect(text).toMatch(/Risque d'averse 65 % vers 11 h au km 30\./);
    expect(text).toMatch(/Rafales jusqu'à 58 km\/h vers le km 30\./);
    expect(text).toMatch(/-1 °C ressentis vers le km 12/);
    expect(text).toMatch(/Arrivée après le coucher du soleil \(11 h 00\) : éclairage obligatoire\./);
    const ids = sum.gear.map((g) => g.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'windbreaker',
        'rain-jacket',
        'arm-warmers',
        'leg-warmers',
        'gloves',
        'winter-layers',
        'lights',
      ]),
    );
    expect(ids).not.toContain('sunscreen');
    expect(sum.gear.find((g) => g.id === 'gloves')?.label).toBe('Gants');
    expect(sum.comfortScore).toBeLessThan(40);
  });

  it('coupe-vent au sommet d’une montée', () => {
    const climbRoute = makeRoute([[20, 90]], {
      climbs: [
        {
          startIdx: 0,
          endIdx: 100,
          startDist: 0,
          endDist: 10_000,
          length: 10_000,
          gain: 400,
          avgGrade: 4,
          maxGrade: 7,
          category: '2',
          summitEle: 900,
        },
      ],
    });
    const t = makeTiming(climbRoute, T0, 20);
    const weather = makeWeather(climbRoute, t, (i) => ({
      temperature: 9,
      apparentTemperature: i === 100 ? 6 : 9,
    }));
    const sum = buildSummary(climbRoute, t, weather, computeRideStats(climbRoute, t, weather, null));
    expect(sum.sentences.join(' ')).toMatch(
      /Prévoir coupe-vent : 6 °C ressentis au sommet de la montée \(km 10\)\./,
    );
  });

  it('chaleur → eau et crème solaire', () => {
    const weather = makeWeather(route, timing, () => ({
      temperature: 31,
      apparentTemperature: 33,
      cloudCover: 5,
    }));
    const sum = buildSummary(route, timing, weather, computeRideStats(route, timing, weather, null));
    expect(sum.gear.map((g) => g.id)).toEqual(['sunscreen', 'extra-water']);
    expect(sum.sentences.join(' ')).toMatch(/Chaleur : jusqu'à 31 °C/);
  });
});

describe('compareDepartures', () => {
  const route = makeRoute([[20, 0]]); // aller simple plein nord
  const last = route.points.length - 1;
  const settings: RideSettings = {
    startTime: T0,
    speedModel: { kind: 'fixed', speedKmh: 20 },
    reversed: false,
    timezone: 'Europe/Paris',
  };

  it('remappe les échantillons pour le sens inverse', () => {
    const s = makeSamples(route, [0, 50, last], () => []);
    const r = reverseSamples(route, s);
    expect(r.map((x) => x.routeIndex)).toEqual([0, last - 50, last]);
    expect(r[0].dist).toBe(20_000 - s[2].dist);
  });

  it('compare heures et sens, marque le meilleur', () => {
    // Vent du nord, et pluie à partir de 10 h UTC
    const samples = makeSamples(route, [0, Math.round(last / 2), last], (i) =>
      makeHours(T0 - H, 8, (k) => ({
        windDirection: 0,
        windSpeed: 25,
        temperature: i === 0 ? 8 : 12,
        precipitationProbability: k >= 3 ? 80 : 0,
        precipitation: k >= 3 ? 2 : 0,
      })),
    );
    const opts = compareDepartures(route, settings, samples, [T0 + 2 * H, T0], true);
    expect(opts).toHaveLength(4);
    expect(opts.map((o) => [o.startTime, o.reversed])).toEqual([
      [T0, false],
      [T0, true],
      [T0 + 2 * H, false],
      [T0 + 2 * H, true],
    ]);
    expect(opts[0].headwindShare).toBeCloseTo(1);
    expect(opts[1].headwindShare).toBe(0);
    const best = opts.filter((o) => o.isBest);
    expect(best).toHaveLength(1);
    expect(best[0]).toMatchObject({ startTime: T0, reversed: true });
    // Sens inverse : le départ est au nord (échantillon d'origine en fin de trace, 12 °C), arrivée au sud (8 °C)
    expect(opts[1].minTemp).toBeCloseTo(8);
    expect(opts[2].maxPrecipProbability).toBe(80);
  });
});
