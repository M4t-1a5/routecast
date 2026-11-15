import { describe, expect, it } from 'vitest';
import type { WeatherGrid, WeatherHour } from '../../types';
import { PRECIP_STOPS, TEMP_STOPS, rampRgb } from '../../lib/colors';
import {
  bilinear,
  buildScreenWindField,
  cellValuesAt,
  computeFieldRGBA,
  makeGridSampler,
  makeWindSampler,
  precipValue,
  tempValue,
  timeFraction,
  windAtPixel,
} from './field';

const H = 3600_000;

function hour(time: number, over: Partial<WeatherHour> = {}): WeatherHour {
  return {
    time,
    temperature: 10,
    apparentTemperature: 10,
    precipitation: 0,
    precipitationProbability: 0,
    windSpeed: 10,
    windDirection: 0,
    windGusts: 15,
    cloudCover: 0,
    weatherCode: 0,
    isDay: true,
    ...over,
  };
}

/** Grille 2×2 sur [2,48]–[3,49], valeurs par cellule et par heure. */
function grid2(values: (i: number, j: number, t: number) => Partial<WeatherHour>): WeatherGrid {
  const times = [0, H];
  const cells = [];
  for (let j = 0; j < 2; j++)
    for (let i = 0; i < 2; i++)
      cells.push({ lat: 48 + j, lon: 2 + i, hours: times.map((t, k) => hour(t, values(i, j, k))) });
  return { bbox: [2, 48, 3, 49], nx: 2, ny: 2, times, cells };
}

describe('échantillonnage de grille', () => {
  it('timeFraction', () => {
    expect(timeFraction([0, H, 2 * H], H / 2)).toEqual({ k: 0, f: 0.5 });
    expect(timeFraction([0, H], -5)).toEqual({ k: 0, f: 0 });
    expect(timeFraction([0, H], 5 * H)).toEqual({ k: 1, f: 0 });
  });
  it('interpolation temporelle par cellule', () => {
    const g = grid2((_i, _j, k) => ({ temperature: k === 0 ? 10 : 20 }));
    expect(Array.from(cellValuesAt(g, H / 2, tempValue))).toEqual([15, 15, 15, 15]);
  });
  it('bilinéaire spatiale', () => {
    expect(bilinear([0, 10, 20, 30], 2, 2, 0.5, 0.5)).toBe(15);
    expect(bilinear([0, 10, NaN, 30], 2, 2, 1, 0)).toBe(10);
    const g = grid2((i, j) => ({ temperature: i * 10 + j * 20 }));
    const s = makeGridSampler(g, 0, tempValue);
    expect(s(48, 2)).toBe(0);
    expect(s(49, 3)).toBe(30);
    expect(s(48.5, 2.5)).toBeCloseTo(15);
    expect(s(40, 0)).toBe(0); // clampé hors grille
  });
  it('vent en composantes u/v (direction météo)', () => {
    // Vent du nord (0°) à 10 km/h → souffle vers le sud : u=0, v=-10
    const g = grid2(() => ({ windSpeed: 10, windDirection: 0 }));
    const w = makeWindSampler(g, 0)(48.5, 2.5)!;
    expect(w.u).toBeCloseTo(0);
    expect(w.v).toBeCloseTo(-10);
  });
});

describe('computeFieldRGBA', () => {
  it('couleurs TEMP_STOPS, rangée 0 au nord', () => {
    // Sud = -10 °C, nord = 35 °C
    const g = grid2((_i, j) => ({ temperature: j === 0 ? -10 : 35 }));
    const f = computeFieldRGBA(g, 0, tempValue, TEMP_STOPS, { width: 4, height: 64 });
    expect(f.data).toBeInstanceOf(Uint8ClampedArray);
    expect(f.data.length).toBe(4 * 64 * 4);
    const px = (x: number, y: number) => Array.from(f.data.slice((y * 4 + x) * 4, (y * 4 + x) * 4 + 4));
    const top = px(1, 0),
      bottom = px(1, 63);
    const north = rampRgb(TEMP_STOPS, 35),
      south = rampRgb(TEMP_STOPS, -10);
    for (let k = 0; k < 3; k++) {
      expect(Math.abs(top[k] - north[k])).toBeLessThanOrEqual(12);
      expect(Math.abs(bottom[k] - south[k])).toBeLessThanOrEqual(12);
    }
    expect(top[3]).toBe(255);
    expect(f.coordinates).toEqual([
      [2, 49],
      [3, 49],
      [3, 48],
      [2, 48],
    ]);
  });

  it('pluie : transparent sous 0.1 mm/h, alpha progressif', () => {
    // Ouest sec, est 5 mm/h
    const g = grid2((i) => ({ precipitation: i === 0 ? 0 : 5 }));
    const f = computeFieldRGBA(g, 0, precipValue, PRECIP_STOPS, {
      width: 100,
      height: 2,
      minValue: 0.1,
      alpha: (v) => Math.min(1, v / 5),
    });
    const a = (x: number) => f.data[x * 4 + 3];
    expect(a(0)).toBe(0); // 0 mm/h
    expect(a(99)).toBeGreaterThan(240); // ~5 mm/h
    expect(a(50)).toBeGreaterThan(80); // ~2.5 mm/h
    expect(a(50)).toBeLessThan(180);
    // Couleur au point le plus pluvieux ≈ PRECIP_STOPS(5)
    const c = rampRgb(PRECIP_STOPS, 5);
    expect(Math.abs(f.data[99 * 4] - c[0])).toBeLessThanOrEqual(15);
  });

  it('cellules manquantes → transparent', () => {
    const g = grid2(() => ({}));
    g.cells.forEach((c) => (c.hours = []));
    const f = computeFieldRGBA(g, 0, tempValue, TEMP_STOPS, { width: 2, height: 2 });
    expect(Array.from(f.data).every((v) => v === 0)).toBe(true);
  });
});

describe('champ de vent écran', () => {
  it('grille tous les step px, rotation selon le bearing, hors champ = null', () => {
    // Vent vers l'est (u=10, v=0) partout dans la moitié gauche
    const sample = (x: number) => (x <= 50 ? { u: 10, v: 0 } : null);
    const f = buildScreenWindField(100, 40, 20, sample, 0);
    expect(f.cols).toBe(6);
    expect(f.rows).toBe(3);
    const w = windAtPixel(f, 10, 10)!;
    expect(w.u).toBeCloseTo(10);
    expect(w.v).toBeCloseTo(0);
    expect(windAtPixel(f, 95, 10)).toBeNull();
    expect(windAtPixel(f, -1, 10)).toBeNull();
    // Carte tournée de 90° (est en haut) : un vent vers l'est monte à l'écran (v < 0).
    const r = buildScreenWindField(100, 40, 20, () => ({ u: 10, v: 0 }), 90);
    const wr = windAtPixel(r, 10, 10)!;
    expect(wr.u).toBeCloseTo(0);
    expect(wr.v).toBeCloseTo(-10);
  });
});
