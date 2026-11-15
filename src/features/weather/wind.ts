import type { WindRelation } from '../../types';

const RAD = Math.PI / 180;

/** Normalise un angle dans [0, 360). */
export function normDeg(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

/** Différence angulaire signée a − b dans (−180, 180]. */
export function angleDiff(a: number, b: number): number {
  const d = normDeg(a - b);
  return d > 180 ? d - 360 : d;
}

/**
 * Composantes du vent relatif au cap.
 * - headwind = speed·cos(Δ) avec Δ = windFrom − bearing : > 0 = vent de face, < 0 = vent de dos.
 * - crosswind = |speed·sin(Δ)|.
 * - relation : 'head' si |Δ| < 60°, 'tail' si |Δ| > 120°, sinon 'cross'.
 *   Règle volontairement simple : elle ne dépend que de l'angle, même par vent faible (< 5 km/h),
 *   où la relation est alors sans conséquence pratique (les consommateurs pondèrent par la vitesse).
 */
export function relativeWind(
  bearingDeg: number,
  windFromDeg: number,
  speedKmh: number,
): { headwind: number; crosswind: number; relation: WindRelation } {
  const delta = angleDiff(windFromDeg, bearingDeg);
  const headwind = speedKmh * Math.cos(delta * RAD);
  const crosswind = Math.abs(speedKmh * Math.sin(delta * RAD));
  const abs = Math.abs(delta);
  const relation: WindRelation = abs < 60 ? 'head' : abs > 120 ? 'tail' : 'cross';
  return { headwind: Math.abs(headwind) < 1e-9 ? 0 : headwind, crosswind, relation };
}

/**
 * Interpole la direction du vent par composantes (u/v) pondérées par la vitesse.
 * Évite l'écueil 350°/10° → 180°. Si les vecteurs s'annulent, retombe sur les vecteurs unitaires.
 */
export function blendDirection(
  dirA: number,
  speedA: number,
  dirB: number,
  speedB: number,
  w: number,
): number {
  const sa = Math.max(speedA, 0);
  const sb = Math.max(speedB, 0);
  let x = (1 - w) * sa * Math.sin(dirA * RAD) + w * sb * Math.sin(dirB * RAD);
  let y = (1 - w) * sa * Math.cos(dirA * RAD) + w * sb * Math.cos(dirB * RAD);
  if (Math.hypot(x, y) < 1e-6) {
    x = (1 - w) * Math.sin(dirA * RAD) + w * Math.sin(dirB * RAD);
    y = (1 - w) * Math.cos(dirA * RAD) + w * Math.cos(dirB * RAD);
    if (Math.hypot(x, y) < 1e-6) return normDeg(w < 0.5 ? dirA : dirB);
  }
  return normDeg(Math.atan2(x, y) / RAD);
}
