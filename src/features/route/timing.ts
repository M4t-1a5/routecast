import type { RideSettings, Route, Timing, WindProvider } from '../../types';

const G = 9.80665;
/** Rendement de transmission. */
export const DRIVETRAIN_EFFICIENCY = 0.97;
/** Masse volumique de l'air au niveau de la mer (kg/m³) et hauteur d'échelle (m). */
const RHO0 = 1.225;
const RHO_SCALE_HEIGHT = 8400;
/** Bornes de vitesse du modèle de puissance (km/h). */
export const MIN_SPEED_KMH = 3;
export const MAX_SPEED_KMH = 90;
/** Plafond en descente (km/h), prudence / freinage. */
export const MAX_DESCENT_SPEED_KMH = 70;
/** Vitesse de repli du mode « rejouer » sans temps enregistrés (km/h). */
const REPLAY_FALLBACK_KMH = 25;

/** Composante de face du vent (même unité que speed) : >0 = vent de face. */
export function headwindComponent(windSpeed: number, windFromDeg: number, bearingDeg: number): number {
  return windSpeed * Math.cos(((windFromDeg - bearingDeg) * Math.PI) / 180);
}

export interface PowerParams {
  powerW: number;
  massKg: number;
  cda: number;
  crr: number;
}

/**
 * Vitesse d'équilibre (m/s) : P·η = v·(m·g·(Crr·cosθ + sinθ) + ½·ρ·CdA·(v+vHead)·|v+vHead|).
 * Résolution par bissection (fonction croissante sur l'intervalle utile), bornée.
 */
export function solvePowerSpeed(p: PowerParams, gradePct: number, eleM: number, headwindMs: number): number {
  const θ = Math.atan(gradePct / 100);
  const rho = RHO0 * Math.exp(-eleM / RHO_SCALE_HEIGHT);
  const fGrav = p.massKg * G * (p.crr * Math.cos(θ) + Math.sin(θ));
  const k = 0.5 * rho * p.cda;
  const target = p.powerW * DRIVETRAIN_EFFICIENCY;
  const f = (v: number) => {
    const air = v + headwindMs;
    return v * (fGrav + k * air * Math.abs(air)) - target;
  };
  const lo = MIN_SPEED_KMH / 3.6;
  const hi = (gradePct < -1 ? MAX_DESCENT_SPEED_KMH : MAX_SPEED_KMH) / 3.6;
  if (f(hi) <= 0) return hi;
  if (f(lo) >= 0) return lo;
  let a = lo;
  let b = hi;
  for (let it = 0; it < 60 && b - a > 1e-4; it++) {
    const m = (a + b) / 2;
    if (f(m) < 0) a = m;
    else b = m;
  }
  return (a + b) / 2;
}

/** Facteur multiplicatif d'allure en course à pied selon la pente (%). */
export function runPaceFactor(gradePct: number): number {
  if (gradePct >= 0) return 1 + 0.033 * gradePct;
  const down = -gradePct;
  if (down <= 10) return 1 - 0.018 * down;
  // Au-delà de −10 % les descentes raides ralentissent à nouveau.
  return 1 - 0.18 + 0.02 * (down - 10);
}

/**
 * Heures de passage. Modèle 'power' : équilibre P = (m g (Crr cosθ + sinθ) + ½ ρ CdA (v+vw)² ) v,
 * vent fourni par `wind` (itération : vent dépend de l'heure, heure dépend de la vitesse).
 * 'replay' utilise point.elapsed ; 'run' ajuste l'allure selon la pente.
 */
export function computeTiming(route: Route, settings: RideSettings, wind?: WindProvider): Timing {
  const pts = route.points;
  const n = pts.length;
  const start = settings.startTime;
  const etas = new Array<number>(n).fill(start);
  const speeds = new Array<number>(n).fill(0);
  const model = settings.speedModel;

  const fixed = (kmh: number) => {
    const v = Math.max(0.1, kmh) / 3.6;
    for (let i = 0; i < n - 1; i++) {
      etas[i + 1] = etas[i] + ((pts[i + 1].dist - pts[i].dist) / v) * 1000;
      speeds[i] = v * 3.6;
    }
  };

  if (model.kind === 'fixed') {
    fixed(model.speedKmh);
  } else if (model.kind === 'replay') {
    if (!route.hasRecordedTime || pts.some((p) => p.elapsed == null)) {
      fixed(REPLAY_FALLBACK_KMH);
    } else {
      for (let i = 0; i < n; i++) etas[i] = start + Math.max(0, pts[i].elapsed as number) * 1000;
      for (let i = 1; i < n; i++) etas[i] = Math.max(etas[i], etas[i - 1]);
      for (let i = 0; i < n - 1; i++) {
        const dt = (etas[i + 1] - etas[i]) / 1000;
        speeds[i] = dt > 0 ? ((pts[i + 1].dist - pts[i].dist) / dt) * 3.6 : 0;
      }
    }
  } else if (model.kind === 'run') {
    const pace = Math.max(60, model.paceSecPerKm);
    for (let i = 0; i < n - 1; i++) {
      const len = pts[i + 1].dist - pts[i].dist;
      const dt = (len / 1000) * pace * runPaceFactor(pts[i].grade);
      etas[i + 1] = etas[i] + dt * 1000;
      speeds[i] = dt > 0 ? (len / dt) * 3.6 : 0;
    }
  } else {
    // Un seul passage séquentiel suffit : l'ETA au point i est connue avant de résoudre le segment i.
    for (let i = 0; i < n - 1; i++) {
      let head = 0;
      const w = wind?.(i, etas[i]);
      if (w) head = headwindComponent(w.speedKmh, w.directionDeg, pts[i].bearing) / 3.6;
      const v = solvePowerSpeed(model, pts[i].grade, pts[i].ele, head);
      etas[i + 1] = etas[i] + ((pts[i + 1].dist - pts[i].dist) / v) * 1000;
      speeds[i] = v * 3.6;
    }
  }

  if (n >= 2) speeds[n - 1] = speeds[n - 2];
  const durationSec = (etas[n - 1] - start) / 1000;
  const distance = n ? pts[n - 1].dist : 0;
  return {
    etas,
    speeds,
    durationSec,
    avgSpeedKmh: durationSec > 0 ? (distance / durationSec) * 3.6 : 0,
    arrival: etas[n - 1] ?? start,
  };
}
