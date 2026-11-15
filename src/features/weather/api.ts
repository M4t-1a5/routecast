/**
 * Accès Open-Meteo : requêtes groupées (≤ 50 lieux/appel), ≤ 2 requêtes concurrentes,
 * 1 retry avec backoff sur 429/5xx/réseau, cache par (lieu arrondi, jour UTC).
 */
import type { Route, WeatherHour, WeatherSample } from '../../types';
import { cacheGet, cacheKey, cacheSet, roundCoord, type HourlyBlock } from './cache';
import { WeatherApiError } from './errors';
import { pickSampleIndices } from './sampling';

const HOUR = 3_600_000;
const DAY = 86_400_000;
export const BATCH_SIZE = 50;
export const MAX_CONCURRENCY = 2;

export const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
export const ENSEMBLE_URL = 'https://ensemble-api.open-meteo.com/v1/ensemble';

export const FORECAST_VARS = [
  'temperature_2m',
  'apparent_temperature',
  'precipitation',
  'precipitation_probability',
  'wind_speed_10m',
  'wind_direction_10m',
  'wind_gusts_10m',
  'cloud_cover',
  'weather_code',
  'is_day',
] as const;

export interface EndpointSpec {
  url: string;
  /** Espace de noms du cache (endpoint + variables + modèles). */
  ns: string;
  /** Paramètres additionnels (hourly, models, wind_speed_unit…). */
  params: Record<string, string>;
  ttlMs: number;
  /** Nombre max de jours après aujourd'hui (UTC) que l'API accepte. */
  maxDaysAhead: number;
}

export const FORECAST_SPEC: EndpointSpec = {
  url: FORECAST_URL,
  ns: 'fc1',
  params: { hourly: FORECAST_VARS.join(','), wind_speed_unit: 'kmh' },
  ttlMs: HOUR,
  maxDaysAhead: 15,
};

let retryDelayMs = 700;
/** Pour les tests : réduit le backoff. */
export function __setRetryDelayForTests(ms: number) {
  retryDelayMs = ms;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);

function daysBetween(startMs: number, endMs: number, nowMs: number, maxAhead: number): string[] {
  const first = Math.floor(startMs / DAY) * DAY;
  const last = Math.min(Math.floor(endMs / DAY) * DAY, Math.floor(nowMs / DAY) * DAY + maxAhead * DAY);
  const out: string[] = [];
  for (let d = first; d <= last; d += DAY) out.push(dayStr(d));
  return out;
}

async function fetchJson(url: string): Promise<unknown> {
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url);
    } catch {
      if (attempt === 0) {
        await sleep(retryDelayMs);
        continue;
      }
      throw new WeatherApiError('connexion au service météo impossible, vérifiez votre connexion internet');
    }
    if (res.ok) return res.json();
    const retryable = res.status === 429 || res.status >= 500;
    if (retryable && attempt === 0) {
      await sleep(retryDelayMs * (res.status === 429 ? 2 : 1));
      continue;
    }
    let reason = '';
    try {
      const j = (await res.json()) as { reason?: string };
      reason = j?.reason ?? '';
    } catch {
      /* corps non JSON */
    }
    if (res.status === 429)
      throw new WeatherApiError('trop de requêtes vers le service météo, réessayez dans une minute');
    if (res.status >= 500) throw new WeatherApiError(`le service météo ne répond pas (erreur ${res.status})`);
    throw new WeatherApiError(`requête météo refusée (${res.status}${reason ? ` : ${reason}` : ''})`);
  }
}

/** Exécute des tâches avec au plus `limit` en parallèle. */
export async function runPool<T>(tasks: (() => Promise<T>)[], limit = MAX_CONCURRENCY): Promise<T[]> {
  const results: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const i = next++;
      results[i] = await tasks[i]();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

interface RawLocation {
  location_id?: number;
  hourly?: Record<string, (number | null)[]>;
}

/** Normalise la réponse (objet seul ou tableau multi-lieux) dans l'ordre des lieux demandés. */
export function parseLocations(json: unknown, count: number): RawLocation[] {
  if (json && typeof json === 'object' && !Array.isArray(json) && (json as { error?: boolean }).error) {
    throw new WeatherApiError(`réponse météo invalide : ${(json as { reason?: string }).reason ?? 'erreur'}`);
  }
  const arr = (Array.isArray(json) ? json : [json]) as RawLocation[];
  const out: RawLocation[] = new Array(count).fill(null).map(() => ({}));
  arr.forEach((loc, k) => {
    const idx = typeof loc?.location_id === 'number' ? loc.location_id : k;
    if (idx >= 0 && idx < count) out[idx] = loc ?? {};
  });
  return out;
}

/** Découpe le bloc `hourly` d'une réponse en blocs par jour UTC (time en ms). */
export function splitByDay(hourly: Record<string, (number | null)[]> | undefined): Map<string, HourlyBlock> {
  const out = new Map<string, HourlyBlock>();
  if (!hourly || !Array.isArray(hourly.time)) return out;
  const keys = Object.keys(hourly).filter((k) => k !== 'time');
  hourly.time.forEach((sec, i) => {
    if (sec == null) return;
    const t = sec * 1000;
    const d = dayStr(t);
    let b = out.get(d);
    if (!b) {
      b = { time: [], data: Object.fromEntries(keys.map((k) => [k, []])) };
      out.set(d, b);
    }
    b.time.push(t);
    for (const k of keys) b.data[k].push(hourly[k]?.[i] ?? null);
  });
  return out;
}

function concatBlocks(blocks: HourlyBlock[], fromMs: number, toMs: number): HourlyBlock {
  const out: HourlyBlock = { time: [], data: {} };
  for (const b of blocks) {
    for (const k of Object.keys(b.data))
      if (!out.data[k]) out.data[k] = new Array(out.time.length).fill(null);
    b.time.forEach((t, i) => {
      if (t < fromMs || t > toMs) return;
      out.time.push(t);
      for (const k of Object.keys(out.data)) out.data[k].push(b.data[k]?.[i] ?? null);
    });
  }
  return out;
}

/**
 * Récupère les blocs horaires bruts pour chaque lieu sur [startMs, endMs] (heures pleines englobantes).
 * Seules les paires (lieu, jour) absentes ou périmées du cache sont redemandées.
 */
export async function fetchHourlyBlocks(
  spec: EndpointSpec,
  locations: { lat: number; lon: number }[],
  startMs: number,
  endMs: number,
  nowMs = Date.now(),
): Promise<HourlyBlock[]> {
  const fromMs = Math.floor(startMs / HOUR) * HOUR;
  const toMs = Math.ceil(endMs / HOUR) * HOUR;
  const days = daysBetween(fromMs, toMs, nowMs, spec.maxDaysAhead);
  if (!locations.length) return [];
  if (!days.length) return locations.map(() => ({ time: [], data: {} }));

  // Lieux uniques (coordonnées arrondies à 0,01°).
  const uniq = new Map<string, { lat: number; lon: number }>();
  const locKey = locations.map((l) => {
    const k = `${roundCoord(l.lat).toFixed(2)},${roundCoord(l.lon).toFixed(2)}`;
    if (!uniq.has(k)) uniq.set(k, { lat: roundCoord(l.lat), lon: roundCoord(l.lon) });
    return k;
  });

  const found = new Map<string, HourlyBlock>(); // `${locKey}|${day}` → bloc
  const missingRange = new Map<string, { lk: string; from: string; to: string }>();
  await Promise.all(
    [...uniq.entries()].map(async ([lk, l]) => {
      const missing: string[] = [];
      await Promise.all(
        days.map(async (d) => {
          const e = await cacheGet(cacheKey(spec.ns, l.lat, l.lon, d), spec.ttlMs, nowMs);
          if (e) found.set(`${lk}|${d}`, e);
          else missing.push(d);
        }),
      );
      if (missing.length) {
        missing.sort();
        missingRange.set(lk, { lk, from: missing[0], to: missing[missing.length - 1] });
      }
    }),
  );

  // Regroupe les lieux manquants par plage de jours puis par lots de 50.
  const groups = new Map<string, string[]>();
  for (const { lk, from, to } of missingRange.values()) {
    const g = `${from}|${to}`;
    groups.set(g, [...(groups.get(g) ?? []), lk]);
  }
  const tasks: (() => Promise<void>)[] = [];
  for (const [g, lks] of groups) {
    const [from, to] = g.split('|');
    for (let b = 0; b < lks.length; b += BATCH_SIZE) {
      const batch = lks.slice(b, b + BATCH_SIZE);
      tasks.push(async () => {
        const pts = batch.map((lk) => uniq.get(lk)!);
        const qs = new URLSearchParams({
          latitude: pts.map((p) => p.lat.toFixed(2)).join(','),
          longitude: pts.map((p) => p.lon.toFixed(2)).join(','),
          ...spec.params,
          timezone: 'GMT',
          timeformat: 'unixtime',
          start_date: from,
          end_date: to,
        });
        const json = await fetchJson(`${spec.url}?${qs.toString()}`);
        const locs = parseLocations(json, batch.length);
        const fetchedAt = Date.now();
        await Promise.all(
          batch.map(async (lk, k) => {
            const byDay = splitByDay(locs[k].hourly);
            const p = pts[k];
            for (const d of days) {
              if (d < from || d > to) continue;
              const block = byDay.get(d) ?? { time: [], data: {} };
              found.set(`${lk}|${d}`, block);
              await cacheSet(cacheKey(spec.ns, p.lat, p.lon, d), { ...block, fetchedAt });
            }
          }),
        );
      });
    }
  }
  await runPool(tasks);

  return locKey.map((lk) =>
    concatBlocks(
      days.map((d) => found.get(`${lk}|${d}`) ?? { time: [], data: {} }),
      fromMs,
      toMs,
    ),
  );
}

/** Convertit un bloc forecast en série horaire typée (heures sans température/vent ignorées). */
export function blockToHours(block: HourlyBlock): WeatherHour[] {
  const g = (k: string, i: number) => block.data[k]?.[i] ?? null;
  const out: WeatherHour[] = [];
  block.time.forEach((t, i) => {
    const temperature = g('temperature_2m', i);
    const windSpeed = g('wind_speed_10m', i);
    if (temperature == null || windSpeed == null) return;
    out.push({
      time: t,
      temperature,
      apparentTemperature: g('apparent_temperature', i) ?? temperature,
      precipitation: g('precipitation', i) ?? 0,
      precipitationProbability: g('precipitation_probability', i) ?? 0,
      windSpeed,
      windDirection: g('wind_direction_10m', i) ?? 0,
      windGusts: g('wind_gusts_10m', i) ?? windSpeed,
      cloudCover: g('cloud_cover', i) ?? 0,
      weatherCode: g('weather_code', i) ?? 0,
      isDay: (g('is_day', i) ?? 1) === 1,
    });
  });
  return out;
}

/** Requêtes groupées Open-Meteo forecast + cache. Une série par location. */
export async function fetchForecast(
  locations: { lat: number; lon: number }[],
  startMs: number,
  endMs: number,
): Promise<WeatherHour[][]> {
  const blocks = await fetchHourlyBlocks(FORECAST_SPEC, locations, startMs, endMs);
  return blocks.map(blockToHours);
}

/** Échantillonne la trace et charge la météo couvrant [startMs − 1 h, endMs + 1 h]. */
export async function loadRouteWeather(
  route: Route,
  startMs: number,
  endMs: number,
): Promise<WeatherSample[]> {
  const idx = pickSampleIndices(route);
  if (!idx.length) return [];
  const locs = idx.map((i) => ({ lat: route.points[i].lat, lon: route.points[i].lon }));
  const series = await fetchForecast(locs, startMs - HOUR, endMs + HOUR);
  const samples = idx.map((i, k) => ({
    lat: route.points[i].lat,
    lon: route.points[i].lon,
    routeIndex: i,
    dist: route.points[i].dist,
    hours: series[k] ?? [],
  }));
  if (!samples.some((s) => s.hours.length)) {
    throw new WeatherApiError('aucune prévision disponible pour ces dates');
  }
  return samples;
}
