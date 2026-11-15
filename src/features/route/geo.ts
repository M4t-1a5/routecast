/** Rayon terrestre moyen (m). */
export const EARTH_RADIUS = 6371008.8;

const RAD = Math.PI / 180;

/** Distance grand cercle (haversine), en mètres. */
export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD;
  const dLon = (lon2 - lon1) * RAD;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Cap initial grand cercle de 1 vers 2, en degrés [0, 360). */
export function initialBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = lat1 * RAD;
  const φ2 = lat2 * RAD;
  const Δλ = (lon2 - lon1) * RAD;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  const θ = Math.atan2(y, x) / RAD;
  return (θ + 360) % 360;
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
