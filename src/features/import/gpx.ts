import type { ParsedTrack, RawPoint } from '../../types';
import { ImportError } from './errors';
import { baseName, isValidCoord, majorityHasTime, sportFromLabel } from './common';

/*
 * Parsing GPX direct via DOM (getElementsByTagName / localName) : plus fiable que
 * togeojson pour conserver altitudes nulles et temps point par point.
 * Insensible aux préfixes de namespace (gpx:trkpt…).
 */

const localName = (n: Node): string => {
  const el = n as Element;
  return (el.localName ?? el.nodeName ?? '').replace(/^.*:/, '');
};

/** Enfants directs d'un élément ayant ce nom local. */
function childElements(el: Element, name: string): Element[] {
  const out: Element[] = [];
  const nodes = el.childNodes;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (n.nodeType === 1 && localName(n) === name) out.push(n as Element);
  }
  return out;
}

function childText(el: Element, name: string): string | null {
  const c = childElements(el, name)[0];
  const t = c?.textContent?.trim();
  return t ? t : null;
}

function readPoint(el: Element): RawPoint | null {
  const lat = parseFloat(el.getAttribute('lat') ?? '');
  const lon = parseFloat(el.getAttribute('lon') ?? '');
  if (!isValidCoord(lat, lon)) return null;
  const eleText = childText(el, 'ele');
  const ele = eleText != null ? parseFloat(eleText) : NaN;
  const timeText = childText(el, 'time');
  const time = timeText != null ? Date.parse(timeText) : NaN;
  return { lat, lon, ele: Number.isFinite(ele) ? ele : null, time: Number.isFinite(time) ? time : null };
}

function parseXml(xml: string): Document {
  if (typeof DOMParser === 'undefined') {
    throw new ImportError('Lecture XML indisponible dans cet environnement.');
  }
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, 'application/xml');
  } catch {
    throw new ImportError('Ce fichier GPX est mal formé (XML invalide).');
  }
  if (!doc || !doc.documentElement || doc.getElementsByTagName('parsererror').length > 0) {
    throw new ImportError('Ce fichier GPX est mal formé (XML invalide).');
  }
  return doc;
}

/** Parse un GPX (trk/trkseg multiples, rte, wpt ignorés). Lève ImportError si invalide. */
export function parseGpx(xml: string, fileName = 'Trace'): ParsedTrack {
  if (typeof xml !== 'string' || !xml.trim()) {
    throw new ImportError('Le fichier est vide.');
  }
  const doc = parseXml(xml);
  const root = doc.documentElement;
  if (localName(root) !== 'gpx') {
    throw new ImportError("Ce fichier n'est pas un GPX valide (élément <gpx> manquant).");
  }

  const tracks = childElements(root, 'trk');
  const routes = childElements(root, 'rte');
  const points: RawPoint[] = [];
  let typeLabel: string | null = null;
  let featureName: string | null = null;

  for (const trk of tracks) {
    featureName ??= childText(trk, 'name');
    typeLabel ??= childText(trk, 'type');
    for (const seg of childElements(trk, 'trkseg')) {
      for (const pt of childElements(seg, 'trkpt')) {
        const p = readPoint(pt);
        if (p) points.push(p);
      }
    }
  }
  // Itinéraire (rte) seulement si aucune trace exploitable.
  if (points.length < 2) {
    points.length = 0;
    for (const rte of routes) {
      featureName ??= childText(rte, 'name');
      typeLabel ??= childText(rte, 'type');
      for (const pt of childElements(rte, 'rtept')) {
        const p = readPoint(pt);
        if (p) points.push(p);
      }
    }
  }

  if (points.length < 2) {
    throw new ImportError('Ce fichier GPX ne contient aucune trace exploitable (au moins 2 points requis).');
  }

  const metadata = childElements(root, 'metadata')[0];
  const metaName = metadata ? childText(metadata, 'name') : null;
  const name = metaName ?? featureName ?? baseName(fileName);

  // Sans temps majoritaires, on ignore les quelques horodatages isolés.
  const hasTime = majorityHasTime(points);
  if (!hasTime) for (const p of points) p.time = null;

  return { name, source: 'gpx', sport: sportFromLabel(typeLabel), points, hasTime };
}
