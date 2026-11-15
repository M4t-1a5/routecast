import type { ParsedTrack, RawPoint } from '../../types';
import { ImportError } from './errors';
import { baseName, isValidCoord, majorityHasTime, sportFromLabel } from './common';

/** Sous-ensemble utile de la sortie de fit-file-parser (mode 'list', lengthUnit 'm'). */
export interface FitPositionLike {
  position_lat?: number;
  position_long?: number;
  altitude?: number;
  enhanced_altitude?: number;
  timestamp?: Date | string | number;
}

export interface FitDataLike {
  records?: FitPositionLike[];
  course_points?: FitPositionLike[];
  sessions?: { sport?: string | number }[];
  sports?: { sport?: string | number; name?: string }[];
  course?: { sport?: string | number; name?: string };
  file_ids?: { type?: string | number }[];
  file_id?: { type?: string | number };
}

function toMs(t: FitPositionLike['timestamp']): number | null {
  if (t == null) return null;
  const ms = t instanceof Date ? t.getTime() : typeof t === 'number' ? t : Date.parse(t);
  return Number.isFinite(ms) ? ms : null;
}

function toPoints(list: FitPositionLike[] | undefined, keepTime: boolean): RawPoint[] {
  const out: RawPoint[] = [];
  for (const r of list ?? []) {
    const lat = Number(r.position_lat);
    const lon = Number(r.position_long);
    if (r.position_lat == null || r.position_long == null || !isValidCoord(lat, lon)) continue;
    const altRaw = r.enhanced_altitude ?? r.altitude;
    const ele = altRaw != null && Number.isFinite(Number(altRaw)) ? Number(altRaw) : null;
    out.push({ lat, lon, ele, time: keepTime ? toMs(r.timestamp) : null });
  }
  return out;
}

/** Normalise l'objet décodé par fit-file-parser en ParsedTrack (fonction pure). */
export function fitDataToTrack(data: FitDataLike, fileName = 'Trace'): ParsedTrack {
  const fileType = data.file_ids?.[0]?.type ?? data.file_id?.type;
  // Fichier « course » (parcours planifié) : les temps éventuels sont fictifs, on les ignore.
  const isCourse = fileType === 'course' || fileType === 6 || (data.course != null && !data.sessions?.length);

  let points = toPoints(data.records, !isCourse);
  if (points.length < 2) points = toPoints(data.course_points, false);
  if (points.length < 2) {
    throw new ImportError('Ce fichier FIT ne contient aucune position GPS exploitable.');
  }

  const hasTime = majorityHasTime(points);
  if (!hasTime) for (const p of points) p.time = null;

  const sport =
    sportFromLabel(data.sessions?.[0]?.sport as string | undefined) ??
    sportFromLabel(data.course?.sport as string | undefined) ??
    sportFromLabel(data.sports?.[0]?.sport as string | undefined);

  const name = data.course?.name?.trim() || baseName(fileName);
  return { name, source: 'fit', sport, points, hasTime };
}

/** Parse un FIT (activité ou course). Lève ImportError si invalide. */
export async function parseFit(buf: ArrayBuffer, fileName = 'Trace'): Promise<ParsedTrack> {
  if (!buf || buf.byteLength < 12) throw new ImportError('Ce fichier FIT est vide ou tronqué.');
  // Import dynamique : le profil FIT est volumineux, chargé seulement si besoin.
  const { default: FitParser } = await import('fit-file-parser');
  const parser = new FitParser({
    force: true,
    speedUnit: 'km/h',
    lengthUnit: 'm',
    elapsedRecordField: true,
    mode: 'list',
  });
  let data: unknown;
  try {
    data = await parser.parseAsync(buf);
  } catch (e) {
    const msg = typeof e === 'string' ? e : (e as Error)?.message;
    throw new ImportError(`Ce fichier FIT est illisible ou corrompu${msg ? ` (${msg})` : ''}.`);
  }
  return fitDataToTrack(data as FitDataLike, fileName);
}
