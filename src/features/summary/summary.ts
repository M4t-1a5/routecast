import type {
  GearAdvice,
  PointWeather,
  RideStats,
  RideSummary,
  Route,
  Timing,
  WindRelation,
} from '../../types';
import { TZ, fmtTime } from '../../lib/format';
import { weatherByIndex } from './stats';

export const GEAR_LABELS: Record<GearAdvice, string> = {
  windbreaker: 'Coupe-vent',
  'rain-jacket': 'Veste imperméable',
  'arm-warmers': 'Manchettes',
  'leg-warmers': 'Jambières',
  gloves: 'Gants',
  'winter-layers': 'Tenue hiver (couches chaudes)',
  lights: 'Éclairage avant et arrière',
  sunscreen: 'Crème solaire',
  'extra-water': 'Eau supplémentaire',
};

/** Vent sous lequel un tronçon est considéré « calme » pour les phrases (km/h). */
export const WIND_PHRASE_MIN = 8;
/** Longueur minimale d'un tronçon de vent cité (m). */
export const WIND_RUN_MIN = 10_000;
const ABSORB_RUN = 3_000;

const km = (m: number) => Math.round(m / 1000);
/** « 14 h » (heure arrondie, Europe/Paris). */
export function fmtHourRound(ms: number): string {
  const h = new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hourCycle: 'h23', timeZone: TZ }).format(
    ms + 30 * 60_000,
  );
  return `${Number(h.replace(/\D/g, ''))} h`;
}
/** « 18 h 12 » (Europe/Paris). */
export const fmtHourMin = (ms: number) =>
  fmtTime(ms)
    .replace(':', ' h ')
    .replace(/^0(\d)/, '$1');

type EffRel = WindRelation | 'calm';
interface Run {
  rel: EffRel;
  start: number;
  end: number;
  speedLen: number;
}

/** Tronçons contigus de même relation de vent (vent < 8 km/h = calme), petits tronçons absorbés. */
export function windRuns(route: Route, weather: PointWeather[]): Run[] {
  const pts = route.points;
  const byIdx = weatherByIndex(weather);
  const raw: Run[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const w = byIdx.get(i);
    if (!w) continue;
    const len = Math.max(0, pts[i + 1].dist - pts[i].dist);
    const rel: EffRel = w.windSpeed >= WIND_PHRASE_MIN ? w.windRelation : 'calm';
    const last = raw[raw.length - 1];
    if (last && last.rel === rel && Math.abs(last.end - pts[i].dist) < 1) {
      last.end = pts[i + 1].dist;
      last.speedLen += w.windSpeed * len;
    } else raw.push({ rel, start: pts[i].dist, end: pts[i + 1].dist, speedLen: w.windSpeed * len });
  }
  // Absorbe les tronçons très courts dans le précédent (bruit de cap).
  const merged: Run[] = [];
  for (const r of raw) {
    const last = merged[merged.length - 1];
    if (last && (r.end - r.start < ABSORB_RUN || last.rel === r.rel)) {
      last.end = r.end;
      last.speedLen += r.speedLen;
    } else merged.push({ ...r });
  }
  return merged;
}

function windSentence(route: Route, weather: PointWeather[], total: number): string | null {
  const runs = windRuns(route, weather).filter(
    (r) => (r.rel === 'head' || r.rel === 'tail') && r.end - r.start >= WIND_RUN_MIN,
  );
  if (!runs.length) return null;
  const phrases = runs.slice(0, 3).map((r, k) => {
    const len = r.end - r.start;
    const speed = Math.round(r.speedLen / Math.max(len, 1));
    const label = r.rel === 'head' ? 'de face' : 'de dos';
    let pos: string;
    if (len >= 0.85 * total) pos = "sur l'essentiel du parcours";
    else if (r.start <= 1000) pos = `sur les ${km(len)} premiers km`;
    else if (r.end >= total - 1000) pos = `sur les ${km(len)} derniers km`;
    else pos = `du km ${km(r.start)} au km ${km(r.end)}`;
    return `${k === 0 ? 'Vent ' : ''}${label} ${speed} km/h ${pos}`;
  });
  return `${phrases.join(', ')}.`;
}

/** Résumé en langage clair + conseils d'équipement, par règles. */
export function buildSummary(
  route: Route,
  timing: Timing,
  weather: PointWeather[],
  stats: RideStats,
): RideSummary {
  if (!weather.length) {
    return { sentences: ['Météo indisponible pour cette sortie.'], gear: [], comfortScore: 50 };
  }
  const pts = route.points;
  const total = stats.distance || pts[pts.length - 1]?.dist || 0;
  const distOf = (w: PointWeather) => pts[w.routeIndex]?.dist ?? 0;
  const sentences: string[] = [];
  let warnings = 0;

  // Vent
  const ws = windSentence(route, weather, total);
  if (ws) {
    sentences.push(ws);
    if (stats.headwindShare > 0.3) warnings++;
  }
  const avgWind = weather.reduce((a, w) => a + w.windSpeed, 0) / weather.length;
  if (!ws && avgWind >= 20) {
    sentences.push(
      `Vent de travers soutenu (${Math.round(avgWind)} km/h) : prudence sur les portions exposées.`,
    );
    warnings++;
  }

  // Pluie
  const wettest = weather.reduce((a, w) => (w.precipitationProbability > a.precipitationProbability ? w : a));
  if (wettest.precipitationProbability >= 30) {
    sentences.push(
      `Risque d'averse ${Math.round(wettest.precipitationProbability)} % vers ${fmtHourRound(wettest.time)} au km ${km(distOf(wettest))}.`,
    );
    warnings++;
  }
  if (stats.totalPrecipitation >= 1) {
    sentences.push(
      `Cumul de pluie estimé : ${stats.totalPrecipitation.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} mm sur la sortie.`,
    );
    warnings++;
  }

  // Froid (ressenti)
  const coldest = weather.reduce((a, w) => (w.apparentTemperature < a.apparentTemperature ? w : a));
  const nearSummit = route.climbs.find((c) => Math.abs(c.endIdx - coldest.routeIndex) <= 15);
  if (coldest.apparentTemperature < 10) {
    const t = Math.round(coldest.apparentTemperature);
    sentences.push(
      nearSummit
        ? `Prévoir coupe-vent : ${t} °C ressentis au sommet de la montée (km ${km(distOf(coldest))}).`
        : `Fraîcheur : ${t} °C ressentis vers le km ${km(distOf(coldest))} (${fmtHourRound(coldest.time)}).`,
    );
    warnings++;
  }

  // Chaleur
  const hottest = weather.reduce((a, w) => (w.temperature > a.temperature ? w : a));
  if (hottest.temperature > 27) {
    sentences.push(
      `Chaleur : jusqu'à ${Math.round(hottest.temperature)} °C vers ${fmtHourRound(hottest.time)}, hydratez-vous régulièrement.`,
    );
    warnings++;
  }

  // Rafales
  const gustiest = weather.reduce((a, w) => (w.windGusts > a.windGusts ? w : a));
  if (gustiest.windGusts >= 45) {
    sentences.push(
      `Rafales jusqu'à ${Math.round(gustiest.windGusts)} km/h vers le km ${km(distOf(gustiest))}.`,
    );
    warnings++;
  }

  // Nuit
  const first = weather[0];
  const last = weather[weather.length - 1];
  if (!first.isDay) {
    sentences.push(`Départ de nuit (${fmtHourMin(timing.etas[0] ?? first.time)}) : éclairage obligatoire.`);
    warnings++;
  }
  if (!last.isDay && first.isDay) {
    sentences.push(
      `Arrivée après le coucher du soleil (${fmtHourMin(timing.arrival)}) : éclairage obligatoire.`,
    );
    warnings++;
  }

  if (!warnings) {
    sentences.push(
      route.sport === 'running' ? 'Conditions idéales pour courir.' : 'Conditions idéales pour rouler.',
    );
  }

  // Équipement
  const minApp = coldest.apparentTemperature;
  const coolDescent = route.climbs.some((c) => {
    if (c.gain < 300) return false;
    const w = weatherByIndex(weather).get(c.endIdx);
    return !!w && w.apparentTemperature < 16;
  });
  const gearIds: GearAdvice[] = [];
  if (minApp < 12 || coolDescent) gearIds.push('windbreaker');
  if (stats.maxPrecipProbability > 40 || stats.totalPrecipitation > 1) gearIds.push('rain-jacket');
  if (stats.minTemp < 15) gearIds.push('arm-warmers');
  if (stats.minTemp < 10) gearIds.push('leg-warmers');
  if (stats.minTemp < 8) gearIds.push('gloves');
  if (stats.minTemp < 3) gearIds.push('winter-layers');
  if (!first.isDay || !last.isDay) gearIds.push('lights');
  if (weather.some((w) => w.isDay && w.cloudCover < 30 && w.temperature > 20)) gearIds.push('sunscreen');
  if (stats.maxTemp > 27) gearIds.push('extra-water');

  return {
    sentences,
    gear: gearIds.map((id) => ({ id, label: GEAR_LABELS[id] })),
    comfortScore: comfortScore(route, weather, stats),
  };
}

/**
 * Score de confort 0–100 : 100 moins des pénalités plafonnées
 * pluie (proba max ≤ 35, cumul ≤ 25), vent de face moyen (≤ 25), rafales (≤ 15),
 * froid/chaleur extrêmes (≤ 20), part de nuit (≤ 15).
 */
export function comfortScore(route: Route, weather: PointWeather[], stats: RideStats): number {
  if (!weather.length) return 50;
  const pts = route.points;
  const byIdx = weatherByIndex(weather);
  let len = 0;
  let headSum = 0;
  let night = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const w = byIdx.get(i);
    if (!w) continue;
    const l = Math.max(0, pts[i + 1].dist - pts[i].dist);
    len += l;
    headSum += Math.max(0, w.headwind) * l;
    if (!w.isDay) night += l;
  }
  const avgHead = len ? headSum / len : 0;
  const nightShare = len ? night / len : weather.every((w) => !w.isDay) ? 1 : 0;
  const maxGust = Math.max(...weather.map((w) => w.windGusts));
  const minApp = Math.min(...weather.map((w) => w.apparentTemperature));

  let s = 100;
  s -= Math.min(35, 0.35 * stats.maxPrecipProbability);
  s -= Math.min(25, stats.totalPrecipitation * 8);
  s -= Math.min(25, avgHead * 1.2);
  if (maxGust > 30) s -= Math.min(15, (maxGust - 30) * 0.6);
  if (minApp < 5) s -= Math.min(20, (5 - minApp) * 2.5);
  if (stats.maxTemp > 28) s -= Math.min(20, (stats.maxTemp - 28) * 3);
  s -= 15 * nightShare;
  return Math.round(Math.max(0, Math.min(100, s)));
}
