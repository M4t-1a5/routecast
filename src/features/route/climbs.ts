import type { Climb, ClimbCategory, RoutePoint } from '../../types';

/** Longueur minimale d'une montée (m). */
export const CLIMB_MIN_LENGTH_M = 500;
/** Pente moyenne minimale (%). */
export const CLIMB_MIN_AVG_GRADE = 3;
/** Pente au-delà de laquelle un segment est considéré « en montée » (%). */
export const CLIMB_SEGMENT_GRADE = 2;
/** Replat/descente fusionné dans la montée s'il est plus court que… (m) */
export const CLIMB_MAX_FLAT_GAP_M = 300;
/** … et si l'altitude perdue y reste inférieure à (m). */
export const CLIMB_MAX_FLAT_LOSS_M = 10;

/** Seuils de catégorie sur le score = longueur (m) × pente moyenne (%), du plus dur au plus facile. */
export const CLIMB_CATEGORY_THRESHOLDS: readonly { category: ClimbCategory; minScore: number }[] = [
  { category: 'HC', minScore: 80000 },
  { category: '1', minScore: 64000 },
  { category: '2', minScore: 32000 },
  { category: '3', minScore: 16000 },
  { category: '4', minScore: 8000 },
];

export function climbCategory(score: number): ClimbCategory | null {
  for (const t of CLIMB_CATEGORY_THRESHOLDS) if (score >= t.minScore) return t.category;
  return null;
}

/** Détecte les montées catégorisées le long d'une trace rééchantillonnée et lissée. */
export function detectClimbs(points: RoutePoint[]): Climb[] {
  const n = points.length;
  if (n < 2) return [];

  // 1) Groupes de segments en montée, fusionnés à travers les courts replats.
  const groups: [number, number][] = []; // [indice départ, indice fin] de points
  let cur: [number, number] | null = null;
  for (let i = 0; i < n - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    const len = b.dist - a.dist;
    const g = len > 0 ? ((b.ele - a.ele) / len) * 100 : 0;
    if (g < CLIMB_SEGMENT_GRADE) continue;
    if (cur) {
      const gapLen = a.dist - points[cur[1]].dist;
      let maxEle = -Infinity;
      for (let k = cur[0]; k <= cur[1]; k++) maxEle = Math.max(maxEle, points[k].ele);
      let minGap = Infinity;
      for (let k = cur[1]; k <= i; k++) minGap = Math.min(minGap, points[k].ele);
      if (gapLen < CLIMB_MAX_FLAT_GAP_M && maxEle - minGap < CLIMB_MAX_FLAT_LOSS_M) {
        cur[1] = i + 1;
        continue;
      }
      groups.push(cur);
    }
    cur = [i, i + 1];
  }
  if (cur) groups.push(cur);

  // 2) Bornage au point bas / sommet, filtrage et catégorisation.
  const climbs: Climb[] = [];
  for (const [s0, e0] of groups) {
    let end = e0;
    for (let k = s0; k <= e0; k++) if (points[k].ele > points[end].ele) end = k;
    let start = s0;
    for (let k = s0; k <= end; k++) if (points[k].ele < points[start].ele) start = k;
    const length = points[end].dist - points[start].dist;
    const gain = points[end].ele - points[start].ele;
    if (length < CLIMB_MIN_LENGTH_M || gain <= 0) continue;
    const avgGrade = (gain / length) * 100;
    if (avgGrade < CLIMB_MIN_AVG_GRADE) continue;
    const category = climbCategory(length * avgGrade);
    if (!category) continue;
    let maxGrade = -Infinity;
    for (let k = start; k < end; k++) maxGrade = Math.max(maxGrade, points[k].grade);
    climbs.push({
      startIdx: start,
      endIdx: end,
      startDist: points[start].dist,
      endDist: points[end].dist,
      length,
      gain,
      avgGrade,
      maxGrade,
      category,
      summitEle: points[end].ele,
    });
  }
  return climbs;
}
