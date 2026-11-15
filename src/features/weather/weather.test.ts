import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  WeatherApiError,
  fetchForecast,
  fetchRainViewerFrames,
  forecastHorizon,
  interpolateAlongRoute,
  makeWindProvider,
  pickSampleIndices,
  relativeWind,
  sampleGrid,
  weatherAt,
  fetchWeatherGrid,
  loadRouteWeather,
} from './index';
import { clearMemoryCache } from './cache';
import { __setRetryDelayForTests, parseLocations } from './api';
import { gridDims } from './grid';
import { FORECAST_RESPONSE } from './__fixtures__/forecast';
import { makeHours, makeRoute, makeSamples, makeTiming } from './__fixtures__/routes';
import type { WeatherGrid } from '../../types';

const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 15, 8); // 1794729600 s — heure de la fixture

/** Réponse Open-Meteo synthétique : autant de lieux que de latitudes dans l'URL. */
function syntheticResponse(url: string, hours = 24) {
  const u = new URL(url);
  const lats = u.searchParams.get('latitude')!.split(',');
  const start = Date.parse(`${u.searchParams.get('start_date')}T00:00:00Z`) / 1000;
  const end = Date.parse(`${u.searchParams.get('end_date')}T00:00:00Z`) / 1000 + 86400;
  const time: number[] = [];
  for (let t = start; t < end && time.length < hours * 20; t += 3600) time.push(t);
  const arr = lats.map((lat, k) => ({
    latitude: Number(lat),
    longitude: 2,
    ...(k > 0 ? { location_id: k } : {}),
    hourly: {
      time,
      temperature_2m: time.map(() => 10 + k),
      apparent_temperature: time.map(() => 8 + k),
      precipitation: time.map(() => 0),
      precipitation_probability: time.map(() => 5),
      wind_speed_10m: time.map(() => 12),
      wind_direction_10m: time.map(() => 270),
      wind_gusts_10m: time.map(() => 20),
      cloud_cover: time.map(() => 40),
      weather_code: time.map(() => 2),
      is_day: time.map(() => 1),
    },
  }));
  return arr.length === 1 ? arr[0] : arr;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe('relativeWind', () => {
  it('vent du nord, cap nord → 100 % de face', () => {
    const r = relativeWind(0, 0, 20);
    expect(r.headwind).toBeCloseTo(20);
    expect(r.crosswind).toBeCloseTo(0);
    expect(r.relation).toBe('head');
  });
  it('vent du nord, cap sud → dos', () => {
    const r = relativeWind(180, 0, 20);
    expect(r.headwind).toBeCloseTo(-20);
    expect(r.relation).toBe('tail');
  });
  it('vent du nord, cap est → travers', () => {
    const r = relativeWind(90, 0, 20);
    expect(r.headwind).toBeCloseTo(0);
    expect(r.crosswind).toBeCloseTo(20);
    expect(r.relation).toBe('cross');
  });
  it('gère le passage 0/360', () => {
    expect(relativeWind(350, 20, 10).relation).toBe('head');
    expect(relativeWind(10, 200, 10).relation).toBe('tail');
  });
});

describe('forecastHorizon', () => {
  const now = Date.UTC(2026, 10, 14, 12);
  it('classe les échéances', () => {
    expect(forecastHorizon(now + 2 * 86400000, now).kind).toBe('ok');
    expect(forecastHorizon(now + 10 * 86400000, now).kind).toBe('low-reliability');
    expect(forecastHorizon(now + 17 * 86400000, now).kind).toBe('too-far');
    expect(forecastHorizon(now - 3 * H, now).kind).toBe('past');
    expect(forecastHorizon(now - 1 * H, now).kind).toBe('ok');
    expect(forecastHorizon(now + 86400000, now).daysAhead).toBeCloseTo(1);
  });
});

describe('pickSampleIndices', () => {
  it('~5 km pour une courte trace, départ et arrivée inclus', () => {
    const r = makeRoute([[40, 0]]);
    const idx = pickSampleIndices(r);
    expect(idx[0]).toBe(0);
    expect(idx[idx.length - 1]).toBe(r.points.length - 1);
    expect(idx.length).toBe(9);
  });
  it('~7 km entre 60 et 150 km', () => {
    const idx = pickSampleIndices(makeRoute([[105, 90]], { spacing: 200 }));
    expect(idx.length).toBe(16);
  });
  it('plafonne à 40 points', () => {
    const idx = pickSampleIndices(makeRoute([[600, 90]], { spacing: 500 }));
    expect(idx.length).toBeLessThanOrEqual(40);
    expect(new Set(idx).size).toBe(idx.length);
  });
  it('trace dégénérée', () => {
    const r = makeRoute([[0.05, 0]]);
    expect(pickSampleIndices(r)).toEqual([0, r.points.length - 1].filter((v, i, a) => a.indexOf(v) === i));
  });
});

describe('weatherAt / interpolation', () => {
  const route = makeRoute([[10, 0]]);
  const last = route.points.length - 1;

  it('interpole linéairement en temps', () => {
    const samples = makeSamples(route, [0], () =>
      makeHours(T0, 2, (k) => ({ temperature: 10 + 4 * k, precipitationProbability: 20 * k })),
    );
    const v = weatherAt(samples, 0, T0 + 0.25 * H)!;
    expect(v.temperature).toBeCloseTo(11);
    expect(v.precipitationProbability).toBeCloseTo(5);
    // Borné hors plage
    expect(weatherAt(samples, 0, T0 - 5 * H)!.temperature).toBe(10);
  });

  it('interpole le long de la trace entre 2 échantillons', () => {
    const samples = makeSamples(route, [0, last], (i) =>
      makeHours(T0, 2, () => ({ temperature: i === 0 ? 10 : 20 })),
    );
    expect(weatherAt(samples, Math.round(last / 2), T0)!.temperature).toBeCloseTo(15);
    expect(weatherAt(samples, Math.round(last / 4), T0)!.temperature).toBeCloseTo(12.5);
  });

  it('direction du vent par composantes : 350° / 10° → ~0°', () => {
    const samples = makeSamples(route, [0], () =>
      makeHours(T0, 2, (k) => ({ windDirection: k === 0 ? 350 : 10, windSpeed: 20 })),
    );
    const d = weatherAt(samples, 0, T0 + 0.5 * H)!.windDirection;
    expect(Math.min(d, 360 - d)).toBeLessThan(0.5);
    const sp = makeSamples(route, [0, last], (i) =>
      makeHours(T0, 1, () => ({ windDirection: i === 0 ? 350 : 10, windSpeed: 20 })),
    );
    const d2 = weatherAt(sp, Math.round(last / 2), T0)!.windDirection;
    expect(Math.min(d2, 360 - d2)).toBeLessThan(0.5);
  });

  it('weatherCode / isDay : valeur la plus proche', () => {
    const samples = makeSamples(route, [0], () =>
      makeHours(T0, 2, (k) => ({ weatherCode: k ? 61 : 0, isDay: k === 0 })),
    );
    expect(weatherAt(samples, 0, T0 + 0.4 * H)!.weatherCode).toBe(0);
    expect(weatherAt(samples, 0, T0 + 0.6 * H)!.isDay).toBe(false);
  });

  it('renvoie null sans données', () => {
    expect(weatherAt([], 0, T0)).toBeNull();
  });

  it('interpolateAlongRoute calcule le vent relatif à l’ETA', () => {
    const samples = makeSamples(route, [0, last], () =>
      makeHours(T0, 3, () => ({ windDirection: 0, windSpeed: 18 })),
    );
    const timing = makeTiming(route, T0, 25);
    const pw = interpolateAlongRoute(route, timing, samples);
    expect(pw).toHaveLength(route.points.length);
    expect(pw[10].windRelation).toBe('head');
    expect(pw[10].headwind).toBeCloseTo(18);
    expect(pw[10].time).toBe(timing.etas[10]);
    expect(makeWindProvider(samples)(5, T0)).toEqual({ speedKmh: 18, directionDeg: 0 });
    expect(interpolateAlongRoute(route, timing, [])).toEqual([]);
  });
});

describe('fetchForecast (Open-Meteo, fetch mocké)', () => {
  beforeEach(() => {
    clearMemoryCache();
    __setRetryDelayForTests(1);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 10, 14, 12));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('parse une réponse multi-lieux réelle (tableau + location_id)', async () => {
    const fetchMock = vi.fn(async () => json(FORECAST_RESPONSE));
    vi.stubGlobal('fetch', fetchMock);
    const res = await fetchForecast(
      [
        { lat: 48.9, lon: 2.19 },
        { lat: 48.8, lon: 2.1 },
      ],
      T0,
      T0 + H,
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get('latitude')).toBe('48.90,48.80');
    expect(url.searchParams.get('timezone')).toBe('GMT');
    expect(url.searchParams.get('timeformat')).toBe('unixtime');
    expect(url.searchParams.get('hourly')).toContain('wind_gusts_10m');
    expect(res).toHaveLength(2);
    expect(res[0][0]).toMatchObject({
      time: T0,
      temperature: 7.9,
      windDirection: 187,
      isDay: true,
      weatherCode: 2,
    });
    expect(res[1][1]).toMatchObject({
      time: T0 + H,
      temperature: 8.4,
      windGusts: 35.6,
      precipitationProbability: 3,
    });
  });

  it('parseLocations accepte un objet seul', () => {
    const one = parseLocations({ hourly: { time: [1] } }, 1);
    expect(one[0].hourly?.time).toEqual([1]);
    expect(() => parseLocations({ error: true, reason: 'x' }, 1)).toThrow(WeatherApiError);
  });

  it('découpe en lots de 50 et sert le cache mémoire au 2e appel', async () => {
    const fetchMock = vi.fn(async (u: string | URL) => json(syntheticResponse(String(u))));
    vi.stubGlobal('fetch', fetchMock);
    const locs = Array.from({ length: 70 }, (_, k) => ({ lat: 45 + k * 0.05, lon: 2 }));
    const a = await fetchForecast(locs, T0, T0 + 3 * H);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(a).toHaveLength(70);
    expect(a[0].length).toBe(4);
    expect(a[69][0].temperature).toBe(10 + 19); // 2e lot, location_id 19
    const b = await fetchForecast(locs, T0, T0 + 3 * H);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(b).toEqual(a);
    // Un nouveau lieu seul est redemandé
    await fetchForecast([...locs, { lat: 10, lon: 10 }], T0, T0 + 3 * H);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const url = new URL(String((fetchMock.mock.calls[2] as unknown[])[0]));
    expect(url.searchParams.get('latitude')).toBe('10.00');
  });

  it('retry une fois sur 429 puis réussit', async () => {
    let n = 0;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string | URL) =>
        n++ === 0 ? json({ error: true }, 429) : json(syntheticResponse(String(u))),
      ),
    );
    const res = await fetchForecast([{ lat: 48, lon: 2 }], T0, T0 + H);
    expect(n).toBe(2);
    expect(res[0].length).toBe(2);
  });

  it('lève WeatherApiError (message FR) sur 400', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => json({ error: true, reason: 'Latitude invalide' }, 400)),
    );
    await expect(fetchForecast([{ lat: 48, lon: 2 }], T0, T0 + H)).rejects.toThrow(
      /refusée.*Latitude invalide/,
    );
  });

  it('loadRouteWeather renvoie un échantillon par point choisi', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string | URL) => json(syntheticResponse(String(u)))),
    );
    const route = makeRoute([[20, 90]]);
    const s = await loadRouteWeather(route, T0, T0 + H);
    expect(s.map((x) => x.routeIndex)).toEqual(pickSampleIndices(route));
    expect(s[0].hours[0].time).toBe(T0 - H);
  });

  it('fetchWeatherGrid + sampleGrid', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (u: string | URL) => json(syntheticResponse(String(u)))),
    );
    const route = makeRoute([[30, 45]]);
    const grid = await fetchWeatherGrid(route, T0, T0 + 2 * H, 8);
    expect(grid.nx * grid.ny).toBe(grid.cells.length);
    expect(grid.cells.length).toBeLessThanOrEqual(100);
    expect(grid.cells[0].lat).toBeLessThan(grid.cells[grid.cells.length - 1].lat);
    expect(grid.times.length).toBeGreaterThan(0);
    const p = route.points[50];
    expect(sampleGrid(grid, p.lat, p.lon, T0)?.windDirection).toBeCloseTo(270);
    expect(sampleGrid(grid, 0, 0, T0)).toBeNull();
  });
});

describe('grille', () => {
  it('adapte nx/ny au ratio', () => {
    const wide = gridDims([0, 45, 4, 45.5], 8);
    expect(wide.nx).toBeGreaterThan(wide.ny);
    expect(wide.nx * wide.ny).toBeLessThanOrEqual(100);
  });
  it('sampleGrid bilinéaire', () => {
    const hours = (temp: number) => makeHours(T0, 2, () => ({ temperature: temp }));
    const grid: WeatherGrid = {
      bbox: [0, 0, 1, 1],
      nx: 2,
      ny: 2,
      times: [T0, T0 + H],
      cells: [
        { lat: 0, lon: 0, hours: hours(0) },
        { lat: 0, lon: 1, hours: hours(10) },
        { lat: 1, lon: 0, hours: hours(20) },
        { lat: 1, lon: 1, hours: hours(30) },
      ],
    };
    expect(sampleGrid(grid, 0.5, 0.5, T0)!.temperature).toBeCloseTo(15);
    expect(sampleGrid(grid, 0, 1, T0)!.temperature).toBeCloseTo(10);
    expect(sampleGrid(grid, 1, 0, T0)!.temperature).toBeCloseTo(20);
  });
});

describe('fetchRainViewerFrames', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('convertit les temps en ms', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        json({
          host: 'https://tilecache.rainviewer.com',
          radar: {
            past: [{ time: 1794648000, path: '/v2/radar/a' }],
            nowcast: [{ time: 1794648600, path: '/v2/radar/b' }],
          },
        }),
      ),
    );
    const r = await fetchRainViewerFrames();
    expect(r.host).toBe('https://tilecache.rainviewer.com');
    expect(r.frames).toEqual([
      { time: 1794648000000, path: '/v2/radar/a', kind: 'past' },
      { time: 1794648600000, path: '/v2/radar/b', kind: 'nowcast' },
    ]);
  });
  it('ne lève pas en cas d’échec', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('offline'))),
    );
    expect(await fetchRainViewerFrames()).toEqual({ host: '', frames: [] });
  });
});
