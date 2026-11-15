/**
 * Indice de confiance — formule documentée dans docs/confidence.md.
 * score = 0.4·spread + 0.3·agreement + 0.3·lead (poids renormalisés sur les sources disponibles).
 */
import type {
  ConfidenceLevel,
  ConfidenceSummary,
  PointConfidence,
  Range,
  Route,
  Timing,
  WeatherSample,
} from '../../types';
import { TZ } from '../../lib/format';
import { weatherAt } from '../weather/interpolate';
import type { ConfidenceInputs, MemberHour } from './fetch';

const DAY = 86_400_000;
const HOUR = 3_600_000;

/** Échelles : écart (P10–P90 ou max–min) pour lequel le sous-score tombe à 0. */
export const SCALES = { temperature: 8, windSpeed: 25, precipitation: 5 } as const;
/** Poids des variables dans spread / agreement. */
export const VAR_WEIGHTS = { temperature: 0.3, windSpeed: 0.35, precipitation: 0.35 } as const;
/** Poids des composantes du score. */
export const COMPONENT_WEIGHTS = { spread: 0.4, agreement: 0.3, lead: 0.3 } as const;
/** Seuil « pluie » d'un membre (mm/h). */
export const WET_THRESHOLD = 0.1;

/** Points d'ancrage (jours → score) de la décroissance avec l'échéance, interpolés linéairement. */
const LEAD_ANCHORS: [number, number][] = [
  [0, 100],
  [1, 95],
  [3, 85],
  [5, 65],
  [7, 45],
  [10, 25],
  [14, 10],
  [16, 5],
];

/** Score de décroissance avec l'échéance (jours) : continu, monotone décroissant, 100 à J0, 5 au-delà de J16. */
export function leadTimeScore(daysAhead: number): number {
  if (!Number.isFinite(daysAhead) || daysAhead <= 0) return 100;
  for (let k = 1; k < LEAD_ANCHORS.length; k++) {
    const [d1, s1] = LEAD_ANCHORS[k];
    if (daysAhead <= d1) {
      const [d0, s0] = LEAD_ANCHORS[k - 1];
      return s0 + ((s1 - s0) * (daysAhead - d0)) / (d1 - d0);
    }
  }
  return LEAD_ANCHORS[LEAD_ANCHORS.length - 1][1];
}

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Percentile linéaire (p ∈ [0, 1]) d'un tableau quelconque. */
export function percentile(values: number[], p: number): number {
  const s = [...values].sort((a, b) => a - b);
  if (!s.length) return NaN;
  const pos = (s.length - 1) * p;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** 100 si écart nul, 0 si écart ≥ échelle. */
export const deltaScore = (delta: number, scale: number) => 100 * (1 - clamp01(delta / scale));

/** Pénalité de partage pluie/sec : 1 si unanimes, 0,2 si partagés 50/50. */
export const splitFactor = (wetFraction: number) => 1 - 0.8 * 4 * wetFraction * (1 - wetFraction);

export interface Dispersion {
  score: number;
  temperatureDelta: number | null;
  windDelta: number | null;
  precipDelta: number | null;
  wetFraction: number | null;
}

/**
 * Sous-score de dispersion d'un ensemble de valeurs (membres : P10–P90 ; modèles : max–min).
 * Une variable n'est prise en compte qu'avec ≥ 2 valeurs ; poids renormalisés. null si rien d'exploitable.
 */
export function dispersion(h: MemberHour, mode: 'percentile' | 'range'): Dispersion | null {
  const spread = (v: number[]) =>
    v.length < 2
      ? null
      : mode === 'percentile'
        ? percentile(v, 0.9) - percentile(v, 0.1)
        : Math.max(...v) - Math.min(...v);
  const dT = spread(h.temperature);
  const dW = spread(h.windSpeed);
  const dP = spread(h.precipitation);
  const wet =
    h.precipitation.length >= 2
      ? h.precipitation.filter((x) => x > WET_THRESHOLD).length / h.precipitation.length
      : null;
  const parts: [number, number][] = [];
  if (dT != null) parts.push([deltaScore(dT, SCALES.temperature), VAR_WEIGHTS.temperature]);
  if (dW != null) parts.push([deltaScore(dW, SCALES.windSpeed), VAR_WEIGHTS.windSpeed]);
  if (dP != null && wet != null)
    parts.push([deltaScore(dP, SCALES.precipitation) * splitFactor(wet), VAR_WEIGHTS.precipitation]);
  if (!parts.length) return null;
  const wsum = parts.reduce((a, [, w]) => a + w, 0);
  return {
    score: parts.reduce((a, [s, w]) => a + s * w, 0) / wsum,
    temperatureDelta: dT,
    windDelta: dW,
    precipDelta: dP,
    wetFraction: wet,
  };
}

/** Heure la plus proche de t (à ≤ 1,5 h près). */
export function hourAt(series: MemberHour[] | undefined, t: number): MemberHour | null {
  if (!series?.length) return null;
  let best: MemberHour | null = null;
  for (const h of series) if (!best || Math.abs(h.time - t) < Math.abs(best.time - t)) best = h;
  return best && Math.abs(best.time - t) <= 1.5 * HOUR ? best : null;
}

function rangeOf(values: number[], mode: 'percentile' | 'range'): Range | null {
  if (!values.length) return null;
  return mode === 'percentile'
    ? { low: percentile(values, 0.1), mid: percentile(values, 0.5), high: percentile(values, 0.9) }
    : { low: Math.min(...values), mid: percentile(values, 0.5), high: Math.max(...values) };
}

export function levelOf(score: number): ConfidenceLevel {
  return score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low';
}

const fmt1 = (x: number) => x.toLocaleString('fr-FR', { maximumFractionDigits: 1 });
const fmtHourFr = (ms: number) =>
  `${Number(new Intl.DateTimeFormat('fr-FR', { hour: 'numeric', hourCycle: 'h23', timeZone: TZ }).format(ms + 30 * 60_000).replace(/\D/g, ''))} h`;
const fmtKmInt = (m: number) => `km ${Math.round(m / 1000)}`;

/** Score 0–100 par point (aux index échantillonnés, à l'ETA) + global + niveau + raisons. Pure. */
export function computeConfidence(
  _route: Route,
  timing: Timing,
  samples: WeatherSample[],
  inputs: ConfidenceInputs,
  nowMs = Date.now(),
): ConfidenceSummary {
  const etaOf = (idx: number) => timing.etas[idx] ?? timing.etas[timing.etas.length - 1] ?? nowMs;
  const startDays = ((timing.etas[0] ?? nowMs) - nowMs) / DAY;

  type Detail = {
    ens: Dispersion | null;
    mod: Dispersion | null;
    eta: number;
    dist: number;
    ensHour: MemberHour | null;
    modHour: MemberHour | null;
  };
  const details: Detail[] = [];
  const points: PointConfidence[] = samples.map((s, k) => {
    const eta = etaOf(s.routeIndex);
    const ensHour = hourAt(inputs.ensemble[k], eta);
    const modHour = hourAt(inputs.models[k], eta);
    const ens = ensHour ? dispersion(ensHour, 'percentile') : null;
    const mod = modHour ? dispersion(modHour, 'range') : null;
    const lead = leadTimeScore((eta - nowMs) / DAY);

    const comps: [number, number][] = [[lead, COMPONENT_WEIGHTS.lead]];
    if (ens) comps.push([ens.score, COMPONENT_WEIGHTS.spread]);
    if (mod) comps.push([mod.score, COMPONENT_WEIGHTS.agreement]);
    const wsum = comps.reduce((a, [, w]) => a + w, 0);
    const score = comps.reduce((a, [v, w]) => a + v * w, 0) / wsum;

    const det = weatherAt([s], s.routeIndex, eta);
    const range = (key: 'temperature' | 'windSpeed' | 'precipitation'): Range => {
      const fromEns = ensHour && ensHour[key].length >= 2 ? rangeOf(ensHour[key], 'percentile') : null;
      const fromMod = modHour ? rangeOf(modHour[key], 'range') : null;
      const v = det ? det[key] : 0;
      return fromEns ?? fromMod ?? { low: v, mid: v, high: v };
    };
    details.push({ ens, mod, eta, dist: s.dist, ensHour, modHour });
    return {
      routeIndex: s.routeIndex,
      score: Math.round(score),
      spreadScore: Math.round(ens?.score ?? lead),
      agreementScore: Math.round(mod?.score ?? lead),
      leadTimeScore: Math.round(lead),
      temperature: range('temperature'),
      windSpeed: range('windSpeed'),
      precipitation: range('precipitation'),
    };
  });

  // Poids = longueur de trace représentée par chaque échantillon.
  const order = samples.map((_, k) => k).sort((a, b) => samples[a].dist - samples[b].dist);
  const weights = new Array(samples.length).fill(0);
  order.forEach((k, r) => {
    const prev = r > 0 ? samples[order[r - 1]].dist : samples[k].dist;
    const next = r < order.length - 1 ? samples[order[r + 1]].dist : samples[k].dist;
    weights[k] = (next - prev) / 2;
  });
  const wTotal = weights.reduce((a, b) => a + b, 0);
  const rawScore = points.length
    ? wTotal > 0
      ? points.reduce((a, p, k) => a + p.score * weights[k], 0) / wTotal
      : points.reduce((a, p) => a + p.score, 0) / points.length
    : leadTimeScore(startDays);
  const score = Math.round(rawScore);

  return { score, level: levelOf(score), reasons: buildReasons(details, startDays), points };

  function buildReasons(ds: Detail[], days: number): string[] {
    const out: string[] = [];
    const secondary: string[] = [];
    const withEns = ds.filter((d) => d.ens);
    const withMod = ds.filter((d) => d.mod);

    if (withEns.length) {
      const tD = withEns.map((d) => d.ens!.temperatureDelta).filter((x): x is number => x != null);
      if (tD.length) {
        const half = tD.reduce((a, b) => a + b, 0) / tD.length / 2;
        out.push(
          half <= 2
            ? `Les membres de l'ensemble s'accordent à ±${fmt1(half)} °C sur la température.`
            : `Forte dispersion de l'ensemble sur la température (±${fmt1(half)} °C).`,
        );
      }
      const split = withEns
        .filter((d) => d.ens!.wetFraction != null && d.ens!.wetFraction >= 0.25 && d.ens!.wetFraction <= 0.75)
        .sort((a, b) => Math.abs(a.ens!.wetFraction! - 0.5) - Math.abs(b.ens!.wetFraction! - 0.5))[0];
      if (split) {
        secondary.push(
          `L'ensemble hésite sur la pluie vers ${fmtHourFr(split.eta)} (${Math.round(split.ens!.wetFraction! * 100)} % des membres en prévoient).`,
        );
      }
      const wD = withEns.map((d) => d.ens!.windDelta ?? 0);
      const maxW = Math.max(...wD);
      if (maxW >= 12)
        secondary.push(`Vent incertain : jusqu'à ${Math.round(maxW)} km/h d'écart entre membres.`);
    }

    if (withMod.length) {
      const rainWorst = [...withMod].sort((a, b) => (a.mod!.score ?? 0) - (b.mod!.score ?? 0))[0];
      const rainDisagree = withMod
        .filter(
          (d) =>
            (d.mod!.precipDelta ?? 0) >= 1 ||
            (d.mod!.wetFraction != null &&
              d.mod!.wetFraction > 0 &&
              d.mod!.wetFraction < 1 &&
              (d.mod!.precipDelta ?? 0) >= 0.3),
        )
        .sort((a, b) => (b.mod!.precipDelta ?? 0) - (a.mod!.precipDelta ?? 0))[0];
      const tMax = Math.max(...withMod.map((d) => d.mod!.temperatureDelta ?? 0));
      if (rainDisagree) {
        out.push(
          `Désaccord entre modèles sur la pluie vers ${fmtHourFr(rainDisagree.eta)} (${fmtKmInt(rainDisagree.dist)}).`,
        );
      } else if (tMax >= 3) {
        out.push(`Écart de ${fmt1(tMax)} °C entre modèles sur la température.`);
      } else if (rainWorst.mod!.score >= 70) {
        const count = Math.max(...withMod.map((d) => d.modHour?.temperature.length ?? 0));
        out.push(`Les ${count} modèles (ECMWF, ICON, GFS, Météo-France) concordent.`);
      } else {
        out.push('Accord moyen entre modèles sur le vent et la pluie.');
      }
    }

    if (!withEns.length && !withMod.length) {
      out.push("Données d'ensemble et multi-modèles indisponibles : indice fondé sur l'échéance seule.");
    }

    out.push(...secondary);
    const d = Math.round(days);
    if (days >= 2.5) out.push(`Échéance J+${d} : fiabilité ${days >= 7 ? 'faible' : 'réduite'}.`);
    else if (days < 1) out.push('Échéance courte (moins de 24 h) : prévision fiable.');
    else out.push(`Échéance J+${Math.max(1, d)} : prévision généralement fiable.`);

    // 2 à 4 phrases : l'échéance est toujours conservée.
    if (out.length > 4) return [...out.slice(0, 3), out[out.length - 1]];
    return out;
  }
}
