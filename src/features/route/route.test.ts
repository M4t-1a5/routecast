/// <reference types="node" />
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { DOMParser as XmlDomParser } from '@xmldom/xmldom';
import { beforeAll, describe, expect, it } from 'vitest';
import type { ParsedTrack, RawPoint, RideSettings, Route, SpeedModel } from '../../types';
import { parseGpx } from '../import';
import {
  buildRoute,
  computeTiming,
  defaultStartTime,
  detectClimbs,
  haversine,
  indexAtDistance,
  initialBearing,
  positionAtTime,
  reverseRoute,
  routeBounds,
} from './index';
import { climbCategory } from './climbs';

beforeAll(() => {
  if (typeof globalThis.DOMParser === 'undefined') {
    (globalThis as unknown as { DOMParser: unknown }).DOMParser = XmlDomParser;
  }
});

const M_PER_DEG_LAT = 111195;

/** Générateur pseudo-aléatoire déterministe (mulberry32). */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Trace nord-sud échantillonnée tous les `step` m, altitude = profile(distance). */
function synthetic(
  lengthM: number,
  profile: (d: number) => number | null,
  opts: { step?: number; noise?: number; speedKmh?: number; seed?: number } = {},
): ParsedTrack {
  const step = opts.step ?? 20;
  const rand = rng(opts.seed ?? 42);
  const points: RawPoint[] = [];
  for (let d = 0; d <= lengthM + 1e-6; d += step) {
    const e = profile(d);
    points.push({
      lat: 45 + d / M_PER_DEG_LAT,
      lon: 6,
      ele: e == null ? null : e + (opts.noise ? (rand() * 2 - 1) * opts.noise : 0),
      time: opts.speedKmh ? Date.UTC(2026, 4, 10, 7) + (d / (opts.speedKmh / 3.6)) * 1000 : null,
    });
  }
  return { name: 'Synthétique', source: 'gpx', sport: null, points, hasTime: !!opts.speedKmh };
}

/** Plat 2 km, montée 5 km à 6 % (+300 m), plat 2 km, descente 3 km à 10 % (−300 m). */
const climbProfile = (d: number) => {
  if (d < 2000) return 100;
  if (d < 7000) return 100 + (d - 2000) * 0.06;
  if (d < 9000) return 400;
  if (d < 12000) return 400 - (d - 9000) * 0.1;
  return 100;
};

const settings = (speedModel: SpeedModel, startTime = Date.UTC(2026, 10, 22, 8)): RideSettings => ({
  startTime,
  speedModel,
  reversed: false,
  timezone: 'Europe/Paris',
});

const flat = (lengthM: number) =>
  buildRoute(
    synthetic(lengthM, () => 50, { step: 50 }),
    { id: 'flat' },
  );

describe('géodésie', () => {
  it('haversine Paris → Lyon ≈ 392 km', () => {
    const d = haversine(48.8566, 2.3522, 45.764, 4.8357);
    expect(d / 1000).toBeGreaterThan(388);
    expect(d / 1000).toBeLessThan(396);
  });
  it('cap : est ≈ 90°, nord ≈ 0°, sud ≈ 180°, ouest ≈ 270°', () => {
    expect(initialBearing(45, 6, 45, 6.01)).toBeCloseTo(90, 0);
    expect(initialBearing(45, 6, 45.01, 6)).toBeCloseTo(0, 5);
    expect(initialBearing(45, 6, 44.99, 6)).toBeCloseTo(180, 5);
    expect(initialBearing(45, 6, 45, 5.99)).toBeCloseTo(270, 0);
  });
});

describe('buildRoute', () => {
  it('rééchantillonne à pas constant, départ et arrivée conservés', () => {
    const parsed = synthetic(10_030, () => 100, { step: 37 });
    const r = buildRoute(parsed, { spacing: 100, id: 'x' });
    const pts = r.points;
    expect(r.id).toBe('x');
    expect(pts[0].lat).toBeCloseTo(parsed.points[0].lat, 9);
    expect(pts[pts.length - 1].lat).toBeCloseTo(parsed.points[parsed.points.length - 1].lat, 9);
    const steps = pts.slice(1).map((p, i) => p.dist - pts[i].dist);
    for (const s of steps) expect(Math.abs(s - steps[0])).toBeLessThan(0.5);
    expect(steps[0]).toBeGreaterThan(95);
    expect(steps[0]).toBeLessThan(105);
    expect(r.stats.distance).toBeCloseTo(haversine(parsed.points[0].lat, 6, parsed.points.at(-1)!.lat, 6), 0);
    expect(r.sport).toBe('cycling');
    expect(r.hasRecordedTime).toBe(false);
    expect(pts.every((p) => p.elapsed === null)).toBe(true);
    expect(pts.every((p) => Math.abs(p.bearing) < 1e-6 || Math.abs(p.bearing - 360) < 1e-6)).toBe(true);
  });

  it('supprime doublons et points aberrants (> 5 km)', () => {
    const parsed = synthetic(2000, () => 10, { step: 100 });
    const pts = parsed.points;
    pts.splice(5, 0, { ...pts[4] }, { ...pts[4] }); // doublons
    pts.splice(10, 0, { lat: 46, lon: 7, ele: 10, time: null }); // pointe à ~130 km
    pts.splice(3, 0, { lat: NaN, lon: 6, ele: 10, time: null });
    const r = buildRoute(parsed);
    expect(r.stats.distance).toBeGreaterThan(1990);
    expect(r.stats.distance).toBeLessThan(2010);
  });

  it('altitudes manquantes interpolées ; aucune altitude → 0', () => {
    const partial = synthetic(1000, (d) => (d === 0 ? 0 : d === 1000 ? 100 : null), { step: 50 });
    const r = buildRoute(partial);
    const mid = r.points[indexAtDistance(r, 500)];
    expect(mid.ele).toBeGreaterThan(45);
    expect(mid.ele).toBeLessThan(55);
    const none = buildRoute(synthetic(1000, () => null));
    expect(none.points.every((p) => p.ele === 0)).toBe(true);
    expect(none.stats.ascent).toBe(0);
  });

  it('D+ sur une montée connue (+300 m), bruit ±1,5 m non gonflé', () => {
    const clean = buildRoute(synthetic(14_000, climbProfile));
    expect(clean.stats.ascent).toBeGreaterThan(290);
    expect(clean.stats.ascent).toBeLessThan(310);
    expect(clean.stats.descent).toBeGreaterThan(290);
    expect(clean.stats.minEle).toBeCloseTo(100, 0);
    expect(clean.stats.maxEle).toBeGreaterThan(395);
    const noisy = buildRoute(synthetic(14_000, climbProfile, { noise: 1.5, step: 10 }));
    expect(noisy.stats.ascent).toBeLessThan(330);
    expect(noisy.stats.ascent).toBeGreaterThan(280);
  });

  it('pente (%) bornée à ±30 et cohérente', () => {
    const r = buildRoute(synthetic(14_000, climbProfile));
    const g = r.points[indexAtDistance(r, 4500)].grade;
    expect(g).toBeGreaterThan(5.5);
    expect(g).toBeLessThan(6.5);
    expect(r.points[indexAtDistance(r, 10_500)].grade).toBeCloseTo(-10, 0);
    const wall = buildRoute(synthetic(2000, (d) => (d < 1000 ? 0 : 500)));
    expect(Math.max(...wall.points.map((p) => p.grade))).toBeLessThanOrEqual(30);
    expect(wall.points.at(-1)!.grade).toBe(wall.points.at(-2)!.grade);
  });

  it('elapsed depuis les temps enregistrés', () => {
    const r = buildRoute(synthetic(10_000, () => 0, { speedKmh: 20 }));
    expect(r.hasRecordedTime).toBe(true);
    expect(r.points[0].elapsed).toBe(0);
    expect(r.points.at(-1)!.elapsed).toBeCloseTo(1800, 0);
  });

  it('trace dégénérée → erreur', () => {
    const p: RawPoint = { lat: 45, lon: 6, ele: 0, time: null };
    expect(() =>
      buildRoute({ name: 'x', source: 'gpx', sport: null, points: [p, { ...p }], hasTime: false }),
    ).toThrow(/trop courte/);
  });
});

describe('detectClimbs', () => {
  it('détecte la montée de 5 km à 6 % (cat. 3)', () => {
    const r = buildRoute(synthetic(14_000, climbProfile, { noise: 1.5, step: 10 }));
    expect(r.climbs).toHaveLength(1);
    const c = r.climbs[0];
    expect(c.length).toBeGreaterThan(4500);
    expect(c.length).toBeLessThan(5500);
    expect(c.avgGrade).toBeGreaterThan(5);
    expect(c.avgGrade).toBeLessThan(7);
    expect(c.category).toBe('3'); // ≈ 5000 × 6 = 30000 < 32000
    expect(c.summitEle).toBeGreaterThan(390);
    expect(c.endIdx).toBeGreaterThan(c.startIdx);
  });

  it('fusionne un court replat, ignore les petites bosses', () => {
    const prof = (d: number) => {
      if (d < 1000) return 0;
      if (d < 3000) return (d - 1000) * 0.05; // +100
      if (d < 3200) return 100; // replat 200 m
      if (d < 5000) return 100 + (d - 3200) * 0.05; // +90
      if (d < 5300) return 190 + (d - 5000) * 0.05; // fin
      if (d < 6000) return 205;
      if (d < 6400) return 205 + (d - 6000) * 0.04; // petite bosse : 16 m
      return 221;
    };
    const climbs = detectClimbs(buildRoute(synthetic(7000, prof)).points);
    expect(climbs).toHaveLength(1);
    expect(climbs[0].gain).toBeGreaterThan(195);
    expect(climbs[0].length).toBeGreaterThan(4000);
  });

  it('catégories selon le score longueur × pente', () => {
    expect(climbCategory(7999)).toBeNull();
    expect(climbCategory(8000)).toBe('4');
    expect(climbCategory(16000)).toBe('3');
    expect(climbCategory(32000)).toBe('2');
    expect(climbCategory(64000)).toBe('1');
    expect(climbCategory(80000)).toBe('HC');
    expect(detectClimbs(flat(5000).points)).toEqual([]);
  });
});

describe('reverseRoute', () => {
  it('inverse points, distances, pentes, caps et stats', () => {
    const r = buildRoute(synthetic(14_000, climbProfile, { speedKmh: 25 }), { id: 'id1' });
    const rev = reverseRoute(r);
    expect(rev.id).toBe('id1');
    expect(rev.name).toBe(r.name);
    expect(rev.points).toHaveLength(r.points.length);
    expect(rev.points[0].lat).toBe(r.points.at(-1)!.lat);
    expect(rev.points[0].dist).toBe(0);
    expect(rev.points.at(-1)!.dist).toBeCloseTo(r.stats.distance, 3);
    expect(rev.points[0].bearing).toBeCloseTo(180, 3);
    expect(rev.stats.ascent).toBe(r.stats.descent);
    expect(rev.stats.descent).toBe(r.stats.ascent);
    expect(rev.hasRecordedTime).toBe(false);
    expect(rev.points.every((p) => p.elapsed === null)).toBe(true);
    // La descente à 10 % devient une montée de 3 km.
    expect(rev.climbs).toHaveLength(1);
    expect(rev.climbs[0].avgGrade).toBeGreaterThan(8.5);
    expect(rev.points[indexAtDistance(rev, 3500)].grade).toBeCloseTo(10, 0);
  });
});

describe('computeTiming', () => {
  it('fixed : 100 km à 25 km/h = 4 h', () => {
    const r = flat(100_000);
    const t = computeTiming(r, settings({ kind: 'fixed', speedKmh: 25 }));
    expect(t.durationSec).toBeCloseTo(4 * 3600, -1);
    expect(t.avgSpeedKmh).toBeCloseTo(25, 3);
    expect(t.arrival).toBe(t.etas.at(-1));
    expect(t.etas).toHaveLength(r.points.length);
    expect(t.speeds).toHaveLength(r.points.length);
    expect(t.speeds.at(-1)).toBe(t.speeds.at(-2));
  });

  const power: SpeedModel = { kind: 'power', powerW: 200, massKg: 80, cda: 0.3, crr: 0.004 };

  it('power : plat sans vent ≈ 30–35 km/h', () => {
    const t = computeTiming(flat(20_000), settings(power));
    expect(t.avgSpeedKmh).toBeGreaterThan(30);
    expect(t.avgSpeedKmh).toBeLessThan(35);
  });

  it('power : vent de face ralentit, vent de dos accélère', () => {
    const r = flat(20_000); // trace vers le nord
    const calm = computeTiming(r, settings(power)).avgSpeedKmh;
    const head = computeTiming(r, settings(power), () => ({ speedKmh: 20, directionDeg: 0 })).avgSpeedKmh;
    const tail = computeTiming(r, settings(power), () => ({ speedKmh: 20, directionDeg: 180 })).avgSpeedKmh;
    expect(head).toBeLessThan(calm - 5);
    expect(tail).toBeGreaterThan(calm + 3);
  });

  it('power : le vent est demandé à l’heure de passage', () => {
    const r = flat(10_000);
    const calls: number[] = [];
    const t = computeTiming(r, settings(power), (i, time) => {
      calls[i] = time;
      return null;
    });
    expect(calls.slice(0, r.points.length - 1)).toEqual(t.etas.slice(0, -1));
  });

  it('power : la montée ralentit, descente plafonnée', () => {
    const r = buildRoute(synthetic(14_000, climbProfile));
    const t = computeTiming(r, settings(power));
    const up = t.speeds[indexAtDistance(r, 4500)];
    const down = t.speeds[indexAtDistance(r, 10_500)];
    expect(up).toBeLessThan(15);
    expect(up).toBeGreaterThan(8);
    expect(down).toBeGreaterThan(40);
    expect(Math.max(...t.speeds)).toBeLessThanOrEqual(70.0001);
    expect(Math.min(...t.speeds)).toBeGreaterThanOrEqual(3);
  });

  it('replay : utilise elapsed, repli 25 km/h sinon', () => {
    const rec = buildRoute(synthetic(10_000, () => 0, { speedKmh: 20 }));
    const start = Date.UTC(2026, 10, 22, 8);
    const t = computeTiming(rec, settings({ kind: 'replay' }, start));
    expect(t.etas[0]).toBe(start);
    expect(t.durationSec).toBeCloseTo(1800, 0);
    const fallback = computeTiming(flat(10_000), settings({ kind: 'replay' }));
    expect(fallback.avgSpeedKmh).toBeCloseTo(25, 3);
  });

  it('run : allure de base sur le plat, plus lente en montée', () => {
    const t = computeTiming(flat(10_000), settings({ kind: 'run', paceSecPerKm: 300 }));
    expect(t.durationSec).toBeCloseTo(3000, -1);
    const hilly = buildRoute(synthetic(14_000, climbProfile));
    const h = computeTiming(hilly, settings({ kind: 'run', paceSecPerKm: 300 }));
    expect(h.speeds[indexAtDistance(hilly, 4500)]).toBeLessThan(h.speeds[indexAtDistance(hilly, 1000)]);
    expect(h.speeds[indexAtDistance(hilly, 10_500)]).toBeGreaterThan(
      h.speeds[indexAtDistance(hilly, 1000)] * 0.95,
    );
  });
});

describe('defaultStartTime', () => {
  it('lundi 2026-11-16 10:00 Paris → dimanche 22 09:00 Paris (08:00 UTC)', () => {
    expect(defaultStartTime(new Date('2026-11-16T09:00:00Z'))).toBe(Date.UTC(2026, 10, 22, 8));
  });
  it('dimanche avant 8 h → aujourd’hui 9 h ; après → dimanche suivant', () => {
    expect(defaultStartTime(new Date('2026-11-22T06:30:00Z'))).toBe(Date.UTC(2026, 10, 22, 8)); // 07:30 Paris
    expect(defaultStartTime(new Date('2026-11-22T07:30:00Z'))).toBe(Date.UTC(2026, 10, 29, 8)); // 08:30 Paris
  });
  it('heure d’été et autre fuseau', () => {
    // Samedi 2026-07-04 → dimanche 5 juillet 09:00 CEST = 07:00 UTC
    expect(defaultStartTime(new Date('2026-07-04T12:00:00Z'))).toBe(Date.UTC(2026, 6, 5, 7));
    // Changement d'heure : samedi 28 mars 2026 → dimanche 29 mars 09:00 CEST = 07:00 UTC
    expect(defaultStartTime(new Date('2026-03-28T12:00:00Z'))).toBe(Date.UTC(2026, 2, 29, 7));
    expect(defaultStartTime(new Date('2026-11-16T09:00:00Z'), 'America/New_York')).toBe(
      Date.UTC(2026, 10, 22, 14),
    );
  });
});

describe('requêtes', () => {
  const r = flat(1000);
  const timing = computeTiming(r, settings({ kind: 'fixed', speedKmh: 36 }, 0)); // 10 m/s

  it('positionAtTime interpole et clampe', () => {
    const mid = positionAtTime(r, timing, 50_000);
    expect(mid.dist).toBeCloseTo(500, 3);
    // index = point de départ du segment contenant la position
    expect(r.points[mid.index].dist).toBeLessThanOrEqual(500 + 1e-6);
    expect(r.points[mid.index + 1].dist).toBeGreaterThanOrEqual(500 - 1e-6);
    expect(positionAtTime(r, timing, -5).dist).toBe(0);
    const end = positionAtTime(r, timing, 1e9);
    expect(end.index).toBe(r.points.length - 1);
    expect(end.dist).toBeCloseTo(r.stats.distance, 6);
  });

  it('indexAtDistance renvoie le plus proche', () => {
    expect(indexAtDistance(r, -10)).toBe(0);
    expect(indexAtDistance(r, 149)).toBe(1);
    expect(indexAtDistance(r, 151)).toBe(2);
    expect(indexAtDistance(r, 1e6)).toBe(r.points.length - 1);
  });

  it('routeBounds', () => {
    const [w, s, e, n] = routeBounds(r);
    expect(w).toBe(6);
    expect(e).toBe(6);
    expect(s).toBeCloseTo(45, 9);
    expect(n).toBeGreaterThan(45);
  });
});

describe('GPX de démo réel', () => {
  it('houilles-chevreuse : 90–100 km, D+ plausible', () => {
    const xml = readFileSync(resolve(__dirname, '../../../public/demo/houilles-chevreuse.gpx'), 'utf8');
    const route: Route = buildRoute(parseGpx(xml, 'demo.gpx'));
    expect(route.stats.distance / 1000).toBeGreaterThan(90);
    expect(route.stats.distance / 1000).toBeLessThan(100);
    expect(route.stats.ascent).toBeGreaterThan(150);
    expect(route.stats.ascent).toBeLessThan(900);
    expect(route.sport).toBe('cycling');
    expect(Math.abs(route.points.length - route.stats.distance / 100)).toBeLessThan(2);
  });
});
