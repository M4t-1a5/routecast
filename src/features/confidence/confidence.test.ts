import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { computeConfidence, fetchConfidenceInputs, leadTimeScore, type ConfidenceInputs } from './index';
import { dispersion, percentile, splitFactor } from './score';
import { keysFor, parseMemberBlock, type MemberHour } from './fetch';
import { splitByDay, __setRetryDelayForTests } from '../weather/api';
import { clearMemoryCache } from '../weather/cache';
import { ENSEMBLE_RESPONSE } from './__fixtures__/ensemble';
import { MODELS_RESPONSE } from './__fixtures__/models';
import { makeHours, makeRoute, makeSamples, makeTiming } from '../weather/__fixtures__/routes';

const H = 3_600_000;
const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 15, 8);

const route = makeRoute([[20, 0]]);
const last = route.points.length - 1;
const samples = makeSamples(route, [0, Math.round(last / 2), last], () =>
  makeHours(T0 - H, 4, () => ({ temperature: 12, windSpeed: 15 })),
);

function hoursWith(f: (k: number) => Omit<MemberHour, 'time'>): MemberHour[] {
  return Array.from({ length: 4 }, (_, k) => ({ time: T0 - H + k * H, ...f(k) }));
}
const series = (f: () => Omit<MemberHour, 'time'>) => samples.map(() => hoursWith(f));

const tight: Omit<MemberHour, 'time'> = {
  temperature: [11.8, 12, 12.1, 12.2, 11.9, 12, 12.3, 11.7, 12, 12.1],
  windSpeed: [14, 15, 15, 16, 15, 14.5, 15.5, 15, 15, 16],
  precipitation: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};
const spread: Omit<MemberHour, 'time'> = {
  temperature: [4, 6, 8, 10, 12, 14, 16, 18, 20, 22],
  windSpeed: [5, 10, 15, 20, 25, 30, 35, 40, 45, 50],
  precipitation: [0, 0, 0, 0, 0, 1, 2, 4, 6, 8],
};
const modelsAgree: Omit<MemberHour, 'time'> = {
  temperature: [12, 12.3, 11.8, 12.1],
  windSpeed: [15, 16, 14, 15],
  precipitation: [0, 0, 0, 0],
};

describe('leadTimeScore', () => {
  it('suit les points d’ancrage', () => {
    expect(leadTimeScore(0)).toBe(100);
    expect(leadTimeScore(1)).toBeCloseTo(95);
    expect(leadTimeScore(3)).toBeCloseTo(85);
    expect(leadTimeScore(5)).toBeCloseTo(65);
    expect(leadTimeScore(7)).toBeCloseTo(45);
    expect(leadTimeScore(10)).toBeCloseTo(25);
    expect(leadTimeScore(14)).toBeCloseTo(10);
    expect(leadTimeScore(-1)).toBe(100);
  });
  it('est monotone décroissante et continue', () => {
    let prev = Infinity;
    for (let d = 0; d <= 20; d += 0.05) {
      const s = leadTimeScore(d);
      expect(s).toBeLessThanOrEqual(prev);
      if (prev !== Infinity) expect(prev - s).toBeLessThan(1);
      prev = s;
    }
  });
});

describe('sous-scores', () => {
  it('percentile linéaire', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([0, 10], 0.1)).toBeCloseTo(1);
  });
  it('ensemble partagé 50/50 sur la pluie = incertain', () => {
    expect(splitFactor(0)).toBe(1);
    expect(splitFactor(0.5)).toBeCloseTo(0.2);
    const half = dispersion(
      { time: 0, temperature: [], windSpeed: [], precipitation: [0, 0, 0, 0, 0.5, 0.5, 0.5, 0.5] },
      'percentile',
    )!;
    expect(half.wetFraction).toBe(0.5);
    expect(half.score).toBeLessThan(25);
  });
});

describe('computeConfidence', () => {
  const now = T0 - 6 * H; // échéance courte
  const timing = makeTiming(route, T0, 25);

  it('ensemble serré + modèles d’accord → score élevé', () => {
    const inputs: ConfidenceInputs = { ensemble: series(() => tight), models: series(() => modelsAgree) };
    const c = computeConfidence(route, timing, samples, inputs, now);
    expect(c.score).toBeGreaterThanOrEqual(85);
    expect(c.level).toBe('high');
    expect(c.points).toHaveLength(3);
    expect(c.points[0].temperature.low).toBeLessThan(c.points[0].temperature.high);
    expect(c.reasons.length).toBeGreaterThanOrEqual(2);
    expect(c.reasons.length).toBeLessThanOrEqual(4);
    expect(c.reasons.join(' ')).toMatch(/s'accordent à ±/);
  });

  it('ensemble dispersé → score bas', () => {
    const inputs: ConfidenceInputs = {
      ensemble: series(() => spread),
      models: series(() => ({
        temperature: [6, 12, 18, 9],
        windSpeed: [5, 30, 15, 40],
        precipitation: [0, 3, 0, 6],
      })),
    };
    const c = computeConfidence(route, timing, samples, inputs, now);
    expect(c.score).toBeLessThan(55);
    expect(c.points[0].spreadScore).toBeLessThan(30);
    expect(c.reasons.join(' ')).toMatch(/Désaccord entre modèles sur la pluie vers \d+ h/);
  });

  it('l’échéance fait baisser le score', () => {
    const inputs: ConfidenceInputs = { ensemble: series(() => tight), models: series(() => modelsAgree) };
    const near = computeConfidence(route, timing, samples, inputs, now);
    const far = computeConfidence(route, timing, samples, inputs, T0 - 9 * DAY);
    expect(far.score).toBeLessThan(near.score);
    expect(far.points[0].leadTimeScore).toBeLessThan(40);
    expect(far.reasons.join(' ')).toMatch(/Échéance J\+9 : fiabilité faible/);
  });

  it('renormalise les poids sans ensemble', () => {
    const inputs: ConfidenceInputs = { ensemble: [], models: series(() => modelsAgree) };
    const c = computeConfidence(route, timing, samples, inputs, T0 - 3 * DAY);
    const p = c.points[0];
    expect(p.score).toBeCloseTo((0.3 * p.agreementScore + 0.3 * p.leadTimeScore) / 0.6, 0);
    // Range = min/médiane/max des modèles
    expect(p.temperature).toEqual({ low: 11.8, mid: 12.05, high: 12.3 });
  });

  it('sans aucune source : échéance seule, valeur déterministe en range', () => {
    const c = computeConfidence(route, timing, samples, { ensemble: [], models: [] }, T0 - 5 * DAY);
    expect(c.points[0].score).toBe(c.points[0].leadTimeScore);
    expect(c.points[0].temperature).toEqual({ low: 12, mid: 12, high: 12 });
    expect(c.reasons.join(' ')).toMatch(/indisponibles/);
    expect(c.level).toBe('medium');
  });
});

describe('parsing des réponses Ensemble / multi-modèles (fixtures réelles)', () => {
  it('ensemble : contrôle + membres de chaque modèle', () => {
    const hourly = ENSEMBLE_RESPONSE[0].hourly as unknown as Record<string, (number | null)[]>;
    expect(keysFor(hourly, 'temperature_2m')).toContain('temperature_2m_member01_ecmwf_ifs025_ensemble');
    expect(keysFor(hourly, 'temperature_2m')).toContain('temperature_2m_icon_seamless_eps');
    const block = [...splitByDay(hourly).values()][0];
    const parsed = parseMemberBlock(block);
    expect(parsed).toHaveLength(2);
    expect(parsed[0].time).toBe(T0);
    // 3 modèles × (contrôle + 3 membres)
    expect(parsed[0].temperature).toHaveLength(12);
    expect(parsed[0].windSpeed).toHaveLength(12);
    expect(parsed[0].precipitation).toHaveLength(12);
  });
  it('multi-modèles : une valeur par modèle', () => {
    const hourly = MODELS_RESPONSE[0].hourly as unknown as Record<string, (number | null)[]>;
    const parsed = parseMemberBlock([...splitByDay(hourly).values()][0]);
    expect(parsed[0].temperature).toEqual([8.5, 7.9, 8.2, 8.7]);
    expect(parsed[0].windSpeed).toHaveLength(4);
  });
  it('ignore precipitation_probability', () => {
    expect(
      keysFor(
        { precipitation: [], precipitation_probability: [], precipitation_gfs_seamless: [] },
        'precipitation',
      ),
    ).toEqual(['precipitation', 'precipitation_gfs_seamless']);
  });
});

describe('fetchConfidenceInputs (fetch mocké)', () => {
  const fx = makeSamples(route, [0, last], () => []);
  fx[0].lat = 48.9;
  fx[0].lon = 2.19;
  fx[1].lat = 48.8;
  fx[1].lon = 2.1;
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

  it('interroge l’ensemble et les modèles', async () => {
    const fetchMock = vi.fn(async (u: string | URL) => {
      const url = String(u);
      return new Response(JSON.stringify(url.includes('ensemble-api') ? ENSEMBLE_RESPONSE : MODELS_RESPONSE));
    });
    vi.stubGlobal('fetch', fetchMock);
    const inputs = await fetchConfidenceInputs(fx, T0, T0 + H);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const urls = fetchMock.mock.calls.map((c) => new URL(String((c as unknown[])[0])));
    expect(urls.find((u) => u.host.startsWith('ensemble'))!.searchParams.get('models')).toBe(
      'icon_seamless,gfs_seamless,ecmwf_ifs025',
    );
    expect(inputs.ensemble).toHaveLength(2);
    expect(inputs.ensemble[1][0].temperature).toHaveLength(12);
    expect(inputs.models[0][0].temperature).toHaveLength(4);
  });

  it('ne lève jamais', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('oops', { status: 500 })),
    );
    expect(await fetchConfidenceInputs(fx, T0, T0 + H)).toEqual({ ensemble: [], models: [] });
  });
});
