/** Logique pure du profil d'altitude (testable sans DOM). */
import { gradeColor } from '../../lib/colors';
import type { PointWeather, ProfileOverlay, RoutePoint } from '../../types';

export interface GradeRun {
  /** Index du premier point. */
  start: number;
  /** Index du dernier point (inclus). */
  end: number;
  color: string;
}

/** Regroupe les segments consécutifs de même couleur de pente. Segment i = [i, i+1]. */
export function gradeRuns(points: Pick<RoutePoint, 'grade'>[]): GradeRun[] {
  const runs: GradeRun[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const color = gradeColor(points[i].grade);
    const last = runs[runs.length - 1];
    if (last && last.color === color && last.end === i) last.end = i + 1;
    else runs.push({ start: i, end: i + 1, color });
  }
  return runs;
}

export const GRADE_LEGEND = [
  { label: '< 3 %', color: gradeColor(0) },
  { label: '3–6 %', color: gradeColor(4) },
  { label: '6–9 %', color: gradeColor(7) },
  { label: '> 9 %', color: gradeColor(10) },
];

/** Série de superposition alignée sur les points (null si météo absente). */
export function overlaySeries(
  overlay: ProfileOverlay,
  n: number,
  weather: PointWeather[],
): (number | null)[] | null {
  if (overlay === 'none' || !weather.length) return null;
  const out: (number | null)[] = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const w = weather[i];
    if (!w) continue;
    // vent : positif = vent de dos (barre verte vers le haut), négatif = vent de face (rouge vers le bas)
    out[i] = overlay === 'wind' ? -w.headwind : overlay === 'temperature' ? w.temperature : w.precipitation;
  }
  return out;
}

/** Plage de l'axe secondaire. */
export function overlayRange(overlay: ProfileOverlay, values: (number | null)[]): [number, number] {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  if (!v.length) return [0, 1];
  const min = Math.min(...v);
  const max = Math.max(...v);
  if (overlay === 'wind') {
    const m = Math.max(10, Math.ceil(Math.max(Math.abs(min), Math.abs(max)) / 5) * 5);
    return [-m, m];
  }
  if (overlay === 'rain') return [0, Math.max(2, Math.ceil(max * 1.2))];
  return [Math.floor(min - 2), Math.ceil(max + 2)];
}

/** Plage d'altitude avec marge (le relief reste lisible même sur le plat). */
export function elevationRange(min: number, max: number): [number, number] {
  const span = Math.max(40, max - min);
  return [Math.floor((min - span * 0.08) / 10) * 10, Math.ceil((max + span * 0.15) / 10) * 10];
}
