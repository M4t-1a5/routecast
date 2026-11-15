import type { RawPoint, Sport } from '../../types';

/** Nom de fichier sans chemin ni extension. */
export function baseName(fileName: string): string {
  const name = fileName.split(/[\\/]/).pop() ?? fileName;
  const clean = name.replace(/\.[^.]+$/, '').trim();
  return clean || 'Trace';
}

/** Déduit le sport d'un libellé libre (GPX <type>, FIT sport). */
export function sportFromLabel(label: string | null | undefined): Sport | null {
  if (label == null) return null;
  const s = String(label).trim().toLowerCase();
  if (!s) return null;
  // Codes numériques historiques Strava : 1 = vélo, 9 = course.
  if (s === '1') return 'cycling';
  if (s === '9') return 'running';
  if (/run|course|trail|jog|walk|hik|marche|rando/.test(s)) return 'running';
  if (/cycl|bik|ride|road|velo|vélo|gravel|vtt/.test(s)) return 'cycling';
  return null;
}

/** Coordonnées plausibles (écarte NaN, hors bornes et le (0,0) typique d'un GPS sans fix). */
export function isValidCoord(lat: number, lon: number): boolean {
  return (
    Number.isFinite(lat) &&
    Number.isFinite(lon) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lon) <= 180 &&
    !(lat === 0 && lon === 0)
  );
}

/** true si la majorité des points ont un horodatage. */
export function majorityHasTime(points: RawPoint[]): boolean {
  if (points.length === 0) return false;
  const n = points.reduce((acc, p) => acc + (p.time != null ? 1 : 0), 0);
  return n > points.length / 2;
}
