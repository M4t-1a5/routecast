/** Palettes partagées carte ↔ profil ↔ légendes. Chaque échelle = stops [valeur, couleur hex]. */
export type Stops = [number, string][];

/** Température -40 → 55 °C (inspiration Apple Météo). */
export const TEMP_STOPS: Stops = [
  [-40, '#8b5cf6'],
  [-25, '#6366f1'],
  [-10, '#3b82f6'],
  [0, '#22d3ee'],
  [8, '#34d399'],
  [15, '#a3e635'],
  [22, '#facc15'],
  [28, '#fb923c'],
  [35, '#ef4444'],
  [45, '#be123c'],
  [55, '#7f1d1d'],
];
/** Précipitations mm/h : Faible / Modéré / Fort / Extrême (bleu → violet → jaune). */
export const PRECIP_STOPS: Stops = [
  [0, '#1e3a8a'],
  [0.2, '#2563eb'],
  [1, '#3b82f6'],
  [2.5, '#7c3aed'],
  [5, '#a855f7'],
  [10, '#e879f9'],
  [20, '#facc15'],
];
export const PRECIP_LEVELS = [
  { label: 'Faible', min: 0.1 },
  { label: 'Modéré', min: 2.5 },
  { label: 'Fort', min: 7.5 },
  { label: 'Extrême', min: 20 },
];
/** Vent km/h 0 → 120. */
export const WIND_STOPS: Stops = [
  [0, '#93c5fd'],
  [10, '#5eead4'],
  [20, '#86efac'],
  [30, '#fde047'],
  [45, '#fb923c'],
  [60, '#ef4444'],
  [80, '#c026d3'],
  [120, '#7e22ce'],
];
export const WIND_RELATION_COLORS = { tail: '#22c55e', head: '#ef4444', cross: '#f59e0b' } as const;

/** Pente : vert < 3 %, jaune 3–6, orange 6–9, rouge > 9. */
export function gradeColor(grade: number): string {
  if (grade < 3) return '#22c55e';
  if (grade < 6) return '#eab308';
  if (grade < 9) return '#f97316';
  return '#ef4444';
}

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Couleur interpolée dans une échelle → [r,g,b]. */
export function rampRgb(stops: Stops, v: number): [number, number, number] {
  if (!Number.isFinite(v)) return hexToRgb(stops[0][1]);
  if (v <= stops[0][0]) return hexToRgb(stops[0][1]);
  for (let i = 1; i < stops.length; i++) {
    const [v1, c1] = stops[i];
    if (v <= v1) {
      const [v0, c0] = stops[i - 1];
      const t = (v - v0) / (v1 - v0);
      const a = hexToRgb(c0),
        b = hexToRgb(c1);
      return [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * t)) as [number, number, number];
    }
  }
  return hexToRgb(stops[stops.length - 1][1]);
}
export function ramp(stops: Stops, v: number): string {
  const [r, g, b] = rampRgb(stops, v);
  return `rgb(${r},${g},${b})`;
}
/** Expression MapLibre 'interpolate' à partir d'une échelle. */
export function mapInterpolate(stops: Stops, input: unknown): unknown[] {
  return ['interpolate', ['linear'], input, ...stops.flatMap(([v, c]) => [v, c])];
}
/** Dégradé CSS pour les légendes. */
export function cssGradient(stops: Stops): string {
  const min = stops[0][0],
    max = stops[stops.length - 1][0];
  return `linear-gradient(90deg, ${stops.map(([v, c]) => `${c} ${(((v - min) / (max - min)) * 100).toFixed(1)}%`).join(', ')})`;
}
