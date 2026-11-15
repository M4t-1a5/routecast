import type { ParsedTrack } from '../../types';
import { ImportError } from './errors';
import { parseFit } from './fit';
import { parseGpx } from './gpx';

export type TrackFormat = 'gpx' | 'fit';

/** Signature « .FIT » aux octets 8–11 de l'en-tête. */
export function hasFitSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 12 && bytes[8] === 0x2e && bytes[9] === 0x46 && bytes[10] === 0x49 && bytes[11] === 0x54
  );
}

/** Détecte le format : extension d'abord, puis contenu. */
export function detectFormat(fileName: string, bytes: Uint8Array): TrackFormat | null {
  const ext = /\.([^.]+)$/.exec(fileName)?.[1]?.toLowerCase();
  if (ext === 'gpx') return 'gpx';
  if (ext === 'fit') return 'fit';
  if (hasFitSignature(bytes)) return 'fit';
  const head = new TextDecoder('utf-8').decode(bytes.subarray(0, 4096)).toLowerCase();
  if (head.includes('<gpx')) return 'gpx';
  return null;
}

/** Détecte le format (extension puis contenu) et parse. */
export async function parseTrackFile(file: File): Promise<ParsedTrack> {
  let buf: ArrayBuffer;
  try {
    buf = await file.arrayBuffer();
  } catch {
    throw new ImportError('Impossible de lire ce fichier.');
  }
  if (buf.byteLength === 0) throw new ImportError('Le fichier est vide.');
  const bytes = new Uint8Array(buf);
  const format = detectFormat(file.name, bytes);
  if (format === 'fit') return parseFit(buf, file.name);
  if (format === 'gpx') return parseGpx(new TextDecoder('utf-8').decode(bytes), file.name);
  throw new ImportError('Format non supporté : importez un fichier GPX ou FIT.');
}
