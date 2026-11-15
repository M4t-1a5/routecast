/**
 * Actions asynchrones / orchestration du pipeline :
 * fichier → Route → ETA → météo par point → (puissance : ré-itération avec le vent) → stats/synthèse
 * puis, en arrière-plan : indice de confiance, grille météo (couches carte).
 */
import type { ParsedTrack, RideSettings, Route } from '../types';
import { useApp } from './useApp';
import {
  ImportError,
  deleteStoredRoute,
  getStoredRoute,
  listStoredRoutes,
  loadPrefs,
  parseGpx,
  parseTrackFile,
  renameStoredRoute,
  savePrefs,
  saveStoredRoute,
} from '../features/import';
import { buildRoute, computeTiming, reverseRoute } from '../features/route';
import {
  fetchWeatherGrid,
  forecastHorizon,
  interpolateAlongRoute,
  loadRouteWeather,
  makeWindProvider,
} from '../features/weather';
import { computeConfidence, fetchConfidenceInputs } from '../features/confidence';
import { buildSummary, compareDepartures, computeRideStats } from '../features/summary';

const get = () => useApp.getState();
const set = (p: Parameters<ReturnType<typeof useApp.getState>['set']>[0]) => useApp.getState().set(p);

export const DEMO_URL = `${import.meta.env.BASE_URL}demo/houilles-chevreuse.gpx`;

/* ---------------------------- Historique ---------------------------- */

export async function refreshHistory() {
  try {
    const history = await listStoredRoutes();
    history.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt);
    set({ history });
  } catch {
    set({ error: { kind: 'storage', message: "Impossible de lire l'historique local." } });
  }
}

export async function openStoredRoute(id: string) {
  const stored = await getStoredRoute(id);
  if (!stored) return;
  await openRoute(
    stored.route,
    stored.settings ? { ...stored.settings, startTime: get().settings.startTime } : undefined,
  );
}

export async function removeStoredRoute(id: string) {
  await deleteStoredRoute(id);
  if (get().baseRoute?.id === id) closeRoute();
  await refreshHistory();
}

export async function renameRoute(id: string, name: string) {
  const clean = name.trim();
  if (!clean) return;
  await renameStoredRoute(id, clean);
  const { baseRoute, route } = get();
  if (baseRoute?.id === id)
    set({ baseRoute: { ...baseRoute, name: clean }, route: route && { ...route, name: clean } });
  await refreshHistory();
}

export function closeRoute() {
  set({
    baseRoute: null,
    route: null,
    timing: null,
    samples: [],
    weather: [],
    confidence: null,
    stats: null,
    summary: null,
    departures: [],
    grid: null,
    horizon: null,
    weatherStatus: 'idle',
    confidenceStatus: 'idle',
    gridStatus: 'idle',
    departuresStatus: 'idle',
    timelineTime: null,
    playing: false,
    hoverIndex: null,
  });
}

/* ------------------------------ Import ------------------------------ */

/** Réglages d'un lien partagé sans trace : appliqués (sens compris) au prochain import. */
let pendingShared: RideSettings | null = null;
export function setPendingSharedSettings(s: RideSettings) {
  pendingShared = s;
}

async function importParsed(parsed: ParsedTrack) {
  const route = buildRoute(parsed);
  const settings = pendingShared ?? { ...get().settings, reversed: false };
  pendingShared = null;
  if (route.sport === 'running' && settings.speedModel.kind !== 'run') {
    settings.speedModel = { kind: 'run', paceSecPerKm: 330 };
  }
  await openRoute(route, settings);
}

export async function importFile(file: File) {
  set({ importStatus: 'loading', error: null });
  try {
    const parsed = await parseTrackFile(file);
    await importParsed(parsed);
    set({ importStatus: 'ready' });
  } catch (e) {
    set({
      importStatus: 'error',
      error: {
        kind: 'invalid-file',
        message: e instanceof ImportError ? e.message : `Fichier illisible : ${(e as Error).message}`,
      },
    });
  }
}

export async function loadDemo() {
  set({ importStatus: 'loading', error: null });
  try {
    const res = await fetch(DEMO_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parsed = parseGpx(await res.text(), 'Boucle Houilles – Vallée de Chevreuse');
    await importParsed({ ...parsed, source: 'demo' });
    set({ importStatus: 'ready' });
  } catch (e) {
    set({
      importStatus: 'error',
      error: { kind: 'unknown', message: `Démo indisponible : ${(e as Error).message}` },
    });
  }
}

export async function openRoute(route: Route, settings?: RideSettings) {
  set({
    baseRoute: route,
    settings: settings ?? get().settings,
    departures: [],
    departuresStatus: 'idle',
    timelineTime: null,
    playing: false,
    hoverIndex: null,
  });
  try {
    await saveStoredRoute({ route, lastOpenedAt: Date.now(), settings: settings ?? get().settings });
    await refreshHistory();
  } catch {
    /* stockage indisponible (navigation privée) : on continue */
  }
  await recompute();
}

/* ----------------------------- Réglages ----------------------------- */

let debounce: ReturnType<typeof setTimeout> | undefined;

/** Met à jour les réglages et relance le calcul (debounce 400 ms pour les sliders). */
export function updateSettings(patch: Partial<RideSettings>, immediate = false) {
  set({ settings: { ...get().settings, ...patch }, departures: [], departuresStatus: 'idle' });
  void savePrefs('speedModel', get().settings.speedModel).catch(() => undefined);
  clearTimeout(debounce);
  if (immediate) void recompute();
  else debounce = setTimeout(() => void recompute(), 400);
}

export async function restorePrefs() {
  try {
    const [theme, layer, speedModel, baseMap] = await Promise.all([
      loadPrefs<'dark' | 'light'>('theme'),
      loadPrefs<'wind' | 'rain' | 'temperature'>('layer'),
      loadPrefs<RideSettings['speedModel']>('speedModel'),
      loadPrefs<'vector' | 'topo'>('baseMap'),
    ]);
    set({
      ...(theme ? { theme } : {}),
      ...(layer ? { layer } : {}),
      ...(baseMap ? { baseMap } : {}),
      ...(speedModel ? { settings: { ...get().settings, speedModel } } : {}),
    });
  } catch {
    /* ignore */
  }
}

/* ----------------------------- Pipeline ----------------------------- */

let runId = 0;
const ARRIVAL_MARGIN_MS = 3 * 3600_000;

export async function recompute() {
  const { baseRoute, settings } = get();
  if (!baseRoute) return;
  const id = ++runId;
  const stale = () => id !== runId;

  const route = settings.reversed ? reverseRoute(baseRoute) : baseRoute;
  const horizon = forecastHorizon(settings.startTime);
  // Le mode "rejouer" n'a pas de sens sur une trace inversée.
  const effSettings: RideSettings =
    settings.speedModel.kind === 'replay' && (!route.hasRecordedTime || settings.reversed)
      ? { ...settings, speedModel: { kind: 'fixed', speedKmh: 25 } }
      : settings;
  const baseTiming = computeTiming(route, effSettings);

  set({
    route,
    horizon,
    timing: baseTiming,
    weather: [],
    samples: [],
    grid: null,
    confidence: null,
    error: null,
  });

  if (horizon.kind === 'too-far' || horizon.kind === 'past') {
    set({
      weatherStatus: 'error',
      confidenceStatus: 'idle',
      gridStatus: 'idle',
      stats: null,
      summary: null,
      error:
        horizon.kind === 'too-far'
          ? {
              kind: 'too-far',
              message: `Départ dans ${Math.round(horizon.daysAhead)} jours : les prévisions ne vont pas au-delà de 16 jours. Choisissez une date plus proche.`,
            }
          : { kind: 'past', message: 'La date de départ est passée. Choisissez une date à venir.' },
    });
    return;
  }

  set({ weatherStatus: 'loading', confidenceStatus: 'loading', gridStatus: 'loading' });
  try {
    const samples = await loadRouteWeather(route, settings.startTime, baseTiming.arrival + ARRIVAL_MARGIN_MS);
    if (stale()) return;
    const timing =
      effSettings.speedModel.kind === 'power'
        ? computeTiming(route, effSettings, makeWindProvider(samples))
        : baseTiming;
    const weather = interpolateAlongRoute(route, timing, samples);
    const stats = computeRideStats(route, timing, weather, null);
    const summary = buildSummary(route, timing, weather, stats);
    set({ samples, timing, weather, stats, summary, weatherStatus: 'ready' });

    // Arrière-plan : confiance + grille (indépendants)
    void (async () => {
      try {
        const inputs = await fetchConfidenceInputs(samples, settings.startTime, timing.arrival);
        if (stale()) return;
        const confidence = computeConfidence(route, timing, samples, inputs);
        set({
          confidence,
          stats: { ...get().stats!, confidence: confidence.score },
          confidenceStatus: 'ready',
        });
      } catch {
        if (!stale()) set({ confidenceStatus: 'error' });
      }
    })();
    void (async () => {
      try {
        const grid = await fetchWeatherGrid(route, settings.startTime, timing.arrival);
        if (stale()) return;
        set({ grid, gridStatus: 'ready' });
      } catch {
        if (!stale()) set({ gridStatus: 'error' });
      }
    })();
  } catch (e) {
    if (stale()) return;
    set({
      weatherStatus: 'error',
      confidenceStatus: 'idle',
      gridStatus: 'idle',
      error: {
        kind: 'api',
        message: `Météo indisponible (Open-Meteo) : ${(e as Error).message}. Réessayez dans un instant.`,
      },
    });
  }
}

/* --------------------- Comparaison des départs ---------------------- */

/** Compare des heures de départ (décalages en heures par rapport au départ choisi) et, option, le sens inverse. */
export async function computeDepartures(offsetsHours: number[] = [-1, 0, 1, 2], includeReverse = true) {
  const { baseRoute, settings, timing } = get();
  if (!baseRoute || !timing) return;
  set({ departuresStatus: 'loading' });
  try {
    const starts = offsetsHours.map((h) => settings.startTime + h * 3600_000);
    const startMin = Math.min(...starts);
    const endMax = Math.max(...starts) + timing.durationSec * 1000 * 1.5 + ARRIVAL_MARGIN_MS;
    const samples = await loadRouteWeather(baseRoute, startMin, endMax);
    const departures = compareDepartures(
      baseRoute,
      { ...settings, reversed: false },
      samples,
      starts,
      includeReverse,
    );
    set({ departures, departuresStatus: 'ready' });
  } catch (e) {
    set({
      departuresStatus: 'error',
      error: { kind: 'api', message: `Comparaison impossible : ${(e as Error).message}` },
    });
  }
}

/** Persistance simple des préférences UI. */
useApp.subscribe((s, prev) => {
  if (s.theme !== prev.theme) void savePrefs('theme', s.theme).catch(() => undefined);
  if (s.layer !== prev.layer) void savePrefs('layer', s.layer).catch(() => undefined);
  if (s.baseMap !== prev.baseMap) void savePrefs('baseMap', s.baseMap).catch(() => undefined);
});
