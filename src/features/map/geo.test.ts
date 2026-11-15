import { describe, expect, it } from 'vitest';
import type { PointWeather, RoutePoint, WindRelation } from '../../types';
import { WIND_RELATION_COLORS, ramp, TEMP_STOPS } from '../../lib/colors';
import {
  NEUTRAL_ROUTE_COLOR,
  arrowSpacing,
  buildColoredSegments,
  buildWindArrows,
  haversine,
  isLoop,
  isRadarWindow,
  nearestIndex,
  pointsBounds,
  positionFromEtas,
  recenterPadding,
} from './geo';

/** Trace rectiligne vers l'est, un point tous les ~100 m. */
function line(n: number, lat = 48.8, lon0 = 2.0): RoutePoint[] {
  const dLon = 100 / (111_320 * Math.cos((lat * Math.PI) / 180));
  return Array.from({ length: n }, (_, i) => ({
    lat,
    lon: lon0 + i * dLon,
    ele: 100,
    dist: i * 100,
    grade: 0,
    bearing: 90,
    elapsed: null,
  }));
}

function pw(i: number, over: Partial<PointWeather> = {}): PointWeather {
  return {
    routeIndex: i,
    time: 0,
    temperature: 15,
    apparentTemperature: 15,
    precipitation: 0,
    precipitationProbability: 0,
    windSpeed: 20,
    windDirection: 270,
    windGusts: 30,
    cloudCover: 0,
    weatherCode: 0,
    isDay: true,
    headwind: 0,
    crosswind: 0,
    windRelation: 'tail',
    ...over,
  };
}

describe('haversine / isLoop', () => {
  it('mesure ~100 m entre deux points consécutifs', () => {
    const p = line(2);
    expect(haversine(p[0], p[1])).toBeCloseTo(100, 0);
  });
  it('détecte une boucle (< 200 m) et une trace A → B', () => {
    const open = line(50);
    expect(isLoop({ points: open })).toBe(false);
    const loop = [...open, { ...open[0], lat: open[0].lat + 0.001 }]; // ~111 m du départ
    expect(isLoop({ points: loop })).toBe(true);
    expect(isLoop({ points: [open[0]] })).toBe(false);
  });
  it('calcule la bbox', () => {
    expect(
      pointsBounds([
        { lat: 1, lon: 2 },
        { lat: -1, lon: 5 },
      ]),
    ).toEqual([2, -1, 5, 1]);
  });
});

describe('buildColoredSegments', () => {
  const pts = line(10);
  it('sans météo : un seul segment neutre couvrant toute la trace', () => {
    const fc = buildColoredSegments({ points: pts }, [], 'wind');
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties.color).toBe(NEUTRAL_ROUTE_COLOR);
    expect(fc.features[0].geometry.coordinates).toHaveLength(10);
  });

  it('vent : couleur selon windRelation, segments fusionnés et contigus', () => {
    const rel: WindRelation[] = [
      'tail',
      'tail',
      'tail',
      'head',
      'head',
      'cross',
      'cross',
      'cross',
      'cross',
      'cross',
    ];
    const weather = rel.map((r, i) => pw(i, { windRelation: r }));
    const fc = buildColoredSegments({ points: pts }, weather, 'wind');
    expect(fc.features.map((f) => f.properties.color)).toEqual([
      WIND_RELATION_COLORS.tail,
      WIND_RELATION_COLORS.head,
      WIND_RELATION_COLORS.cross,
    ]);
    expect(fc.features.map((f) => [f.properties.from, f.properties.to])).toEqual([
      [0, 3],
      [3, 5],
      [5, 9],
    ]);
    // Contiguïté : la fin d'un segment = le début du suivant.
    for (let k = 1; k < fc.features.length; k++) {
      const prev = fc.features[k - 1].geometry.coordinates;
      expect(fc.features[k].geometry.coordinates[0]).toEqual(prev[prev.length - 1]);
    }
  });

  it('température : couleur TEMP_STOPS', () => {
    const weather = pts.map((_, i) => pw(i, { temperature: i < 5 ? 0 : 35 }));
    const fc = buildColoredSegments({ points: pts }, weather, 'temperature');
    expect(fc.features[0].properties.color).toBe(ramp(TEMP_STOPS, 0));
    expect(fc.features[fc.features.length - 1].properties.color).toBe(ramp(TEMP_STOPS, 35));
  });

  it('comble les points sans météo', () => {
    const weather = [pw(0, { windRelation: 'head' }), pw(9, { windRelation: 'head' })];
    const fc = buildColoredSegments({ points: pts }, weather, 'wind');
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties.color).toBe(WIND_RELATION_COLORS.head);
  });
});

describe('buildWindArrows', () => {
  it('espace les flèches régulièrement et oriente vers où souffle le vent', () => {
    const pts = line(201); // 20 km
    const weather = pts.map((_, i) => pw(i, { windDirection: 270, windSpeed: 30 }));
    const fc = buildWindArrows({ points: pts }, weather, 3000);
    // 1.5, 4.5, 7.5, 10.5, 13.5, 16.5, 19.5 km
    expect(fc.features).toHaveLength(7);
    const d = fc.features.map((f) => pts[f.properties.routeIndex].dist);
    expect(d[0]).toBe(1500);
    for (let k = 1; k < d.length; k++) expect(d[k] - d[k - 1]).toBe(3000);
    // Vent d'ouest (270°) → souffle vers l'est (90°)
    expect(fc.features[0].properties.rotate).toBe(90);
    expect(fc.features[0].properties.speed).toBe(30);
  });
  it('vide sans météo', () => {
    expect(buildWindArrows({ points: line(50) }, []).features).toHaveLength(0);
  });
  it('espacement selon la longueur', () => {
    expect(arrowSpacing(30_000)).toBe(3000);
    expect(arrowSpacing(100_000)).toBe(4000);
    expect(arrowSpacing(300_000)).toBe(5000);
  });
});

describe('recenterPadding', () => {
  it('desktop : sidebar à gauche + profil en bas', () => {
    expect(recenterPadding(1440, 900)).toEqual({ top: 90, bottom: 310, left: 430, right: 90 });
  });
  it('mobile : bottom sheet 45 %', () => {
    const p = recenterPadding(390, 844);
    expect(p.top).toBe(80);
    expect(p.bottom).toBe(Math.round(844 * 0.45));
    expect(p.left + p.right).toBeLessThan(390 * 0.7);
  });
  it('réduit le padding si la fenêtre est trop petite', () => {
    const p = recenterPadding(1024, 300);
    expect(p.top + p.bottom).toBeLessThanOrEqual(300 * 0.7);
    expect(p.left + p.right).toBeLessThanOrEqual(1024 * 0.7);
  });
});

describe('nearestIndex', () => {
  const xy = [0, 0, 10, 0, 20, 0];
  it('trouve le point le plus proche', () => {
    expect(nearestIndex(xy, 12, 3)).toBe(1);
    expect(nearestIndex(xy, 100, 0)).toBe(2);
  });
  it('respecte la distance max', () => {
    expect(nearestIndex(xy, 10, 50, 20)).toBe(-1);
  });
});

describe('positionFromEtas / isRadarWindow', () => {
  const pts = line(3);
  const etas = [1000, 2000, 3000];
  it('interpole et clampe', () => {
    expect(positionFromEtas({ points: pts }, { etas }, 0).index).toBe(0);
    expect(positionFromEtas({ points: pts }, { etas }, 9999).index).toBe(2);
    const mid = positionFromEtas({ points: pts }, { etas }, 1500);
    expect(mid.dist).toBe(50);
  });
  it('fenêtre radar ± 2 h', () => {
    const now = 1_000_000_000;
    expect(isRadarWindow(now + 3600_000, now)).toBe(true);
    expect(isRadarWindow(now - 3600_000, now)).toBe(true);
    expect(isRadarWindow(now + 3 * 3600_000, now)).toBe(false);
    expect(isRadarWindow(now - 3 * 3600_000, now)).toBe(false);
  });
});

describe('pointColor pluie', () => {
  it('sec → gris clair, pluie → PRECIP_STOPS', async () => {
    const { pointColor, DRY_ROUTE_COLOR } = await import('./geo');
    const { PRECIP_STOPS } = await import('../../lib/colors');
    expect(pointColor('rain', pw(0, { precipitation: 0 }))).toBe(DRY_ROUTE_COLOR);
    expect(pointColor('rain', pw(0, { precipitation: 5 }))).toBe(ramp(PRECIP_STOPS, 5));
  });
});
