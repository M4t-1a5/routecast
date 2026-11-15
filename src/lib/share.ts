/**
 * Lien partageable : état compact encodé dans le hash (`#s=<base64url(JSON)>`).
 * La trace (simplifiée Douglas-Peucker ~25 m + polyline Google 1e5 + altitudes arrondies) n'est incluse
 * que si le lien final reste court (< ~6000 caractères).
 */
import type { MapLayer, ParsedTrack, RideSettings, Route, Sport, SpeedModel } from '../types';

export const MAX_SHARE_LENGTH = 6000;

export interface SharePoint {
  lat: number;
  lon: number;
  ele: number;
}

export interface ShareState {
  name: string;
  startTime: number;
  speedModel: SpeedModel;
  reversed: boolean;
  layer: MapLayer;
  sport?: Sport;
  /** Trace simplifiée, absente si trop longue. */
  track?: SharePoint[];
  /** true si la trace a été omise car trop longue. */
  trackOmitted?: boolean;
}

/* ----------------------------- base64url ----------------------------- */

export function toBase64Url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function fromBase64Url(b64: string): string {
  const norm = b64.replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(norm + '='.repeat((4 - (norm.length % 4)) % 4));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/* --------------------------- polyline Google --------------------------- */

function encodeSigned(v: number): string {
  let n = v < 0 ? ~(v << 1) : v << 1;
  let out = '';
  while (n >= 0x20) {
    out += String.fromCharCode((0x20 | (n & 0x1f)) + 63);
    n >>>= 5;
  }
  return out + String.fromCharCode(n + 63);
}

/** Encode une suite d'entiers par différences (même codage que la polyline Google). */
export function encodeIntegers(values: number[]): string {
  let prev = 0;
  let out = '';
  for (const v of values) {
    out += encodeSigned(v - prev);
    prev = v;
  }
  return out;
}

export function decodeIntegers(str: string): number[] {
  let acc = 0;
  return decodeIntegersRaw(str).map((d) => (acc += d));
}

/** Polyline Google (précision 1e5) : [lat, lon][]. */
export function encodePolyline(coords: [number, number][]): string {
  let pLat = 0;
  let pLon = 0;
  let out = '';
  for (const [lat, lon] of coords) {
    const a = Math.round(lat * 1e5);
    const b = Math.round(lon * 1e5);
    out += encodeSigned(a - pLat) + encodeSigned(b - pLon);
    pLat = a;
    pLon = b;
  }
  return out;
}

export function decodePolyline(str: string): [number, number][] {
  const ints = decodeIntegersRaw(str);
  const out: [number, number][] = [];
  let lat = 0;
  let lon = 0;
  for (let i = 0; i + 1 < ints.length; i += 2) {
    lat += ints[i];
    lon += ints[i + 1];
    out.push([lat / 1e5, lon / 1e5]);
  }
  return out;
}

/** Décode les différences brutes (sans cumul). */
function decodeIntegersRaw(str: string): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < str.length) {
    let shift = 0;
    let result = 0;
    let b: number;
    do {
      b = str.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20 && i < str.length);
    out.push(result & 1 ? ~(result >> 1) : result >> 1);
  }
  return out;
}

/* --------------------------- Douglas-Peucker --------------------------- */

/** Simplification Douglas-Peucker (tolérance en mètres, projection équirectangulaire locale). Itératif. */
export function simplifyTrack<T extends { lat: number; lon: number }>(pts: T[], toleranceM = 25): T[] {
  if (pts.length <= 2) return pts.slice();
  const lat0 = (pts.reduce((s, p) => s + p.lat, 0) / pts.length) * (Math.PI / 180);
  const kx = 111_320 * Math.cos(lat0);
  const ky = 110_540;
  const xs = pts.map((p) => p.lon * kx);
  const ys = pts.map((p) => p.lat * ky);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const tol2 = toleranceM * toleranceM;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const dx = xs[b] - xs[a];
    const dy = ys[b] - ys[a];
    const len2 = dx * dx + dy * dy;
    let maxD = -1;
    let idx = -1;
    for (let i = a + 1; i < b; i++) {
      let t = len2 ? ((xs[i] - xs[a]) * dx + (ys[i] - ys[a]) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = xs[a] + t * dx - xs[i];
      const ey = ys[a] + t * dy - ys[i];
      const d = ex * ex + ey * ey;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (idx > 0 && maxD > tol2) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/* ------------------------------ Encodage ------------------------------ */

interface Compact {
  v: 1;
  n: string;
  t: number;
  m: SpeedModel;
  r?: 1;
  l: MapLayer;
  s?: 'r';
  p?: string;
  e?: string;
  x?: 1;
}

function compactJson(state: ShareState, track: SharePoint[] | null): string {
  const c: Compact = { v: 1, n: state.name, t: state.startTime, m: state.speedModel, l: state.layer };
  if (state.reversed) c.r = 1;
  if (state.sport === 'running') c.s = 'r';
  if (track && track.length >= 2) {
    c.p = encodePolyline(track.map((p) => [p.lat, p.lon]));
    c.e = encodeIntegers(track.map((p) => Math.round(p.ele)));
  } else if (state.track || state.trackOmitted) c.x = 1;
  return JSON.stringify(c);
}

/** Encode l'état → valeur de hash `s=...` (sans '#'). La trace est omise si le résultat dépasse `maxLength`. */
export function encodeShareState(state: ShareState, maxLength = MAX_SHARE_LENGTH): string {
  if (state.track && state.track.length >= 2) {
    for (const tol of [25, 50]) {
      const track = simplifyTrack(state.track, tol);
      const s = `s=${toBase64Url(compactJson(state, track))}`;
      if (s.length < maxLength) return s;
    }
  }
  return `s=${toBase64Url(compactJson(state, null))}`;
}

/** Décode un hash (`#s=...`, `s=...` ou URL complète). null si absent/invalide. */
export function decodeShareState(hash: string): ShareState | null {
  const m = /(?:^|[#&?])s=([A-Za-z0-9_-]+)/.exec(hash.startsWith('s=') ? `#${hash}` : hash);
  if (!m) return null;
  try {
    const c = JSON.parse(fromBase64Url(m[1])) as Partial<Compact>;
    if (c.v !== 1 || typeof c.t !== 'number' || !c.m || typeof c.m !== 'object' || !('kind' in c.m))
      return null;
    const layer: MapLayer = c.l === 'rain' || c.l === 'temperature' ? c.l : 'wind';
    const state: ShareState = {
      name: typeof c.n === 'string' ? c.n : 'Trace partagée',
      startTime: c.t,
      speedModel: c.m,
      reversed: c.r === 1,
      layer,
      sport: c.s === 'r' ? 'running' : 'cycling',
    };
    if (typeof c.p === 'string' && c.p) {
      const coords = decodePolyline(c.p);
      const eles = typeof c.e === 'string' ? decodeIntegers(c.e) : [];
      state.track = coords.map(([lat, lon], i) => ({ lat, lon, ele: eles[i] ?? 0 }));
    } else if (c.x === 1) state.trackOmitted = true;
    return state;
  } catch {
    return null;
  }
}

/** Construit l'état partagé à partir de la trace (sens original) et des réglages. */
export function shareStateFrom(route: Route, settings: RideSettings, layer: MapLayer): ShareState {
  return {
    name: route.name,
    startTime: settings.startTime,
    speedModel: settings.speedModel,
    reversed: settings.reversed,
    layer,
    sport: route.sport,
    track: route.points.map((p) => ({ lat: p.lat, lon: p.lon, ele: p.ele })),
  };
}

export function buildShareUrl(state: ShareState, base: string): string {
  return `${base.split('#')[0]}#${encodeShareState(state)}`;
}

/** Trace partagée → ParsedTrack (source 'gpx') à passer à `buildRoute`. */
export function shareToParsedTrack(state: ShareState): ParsedTrack | null {
  if (!state.track || state.track.length < 2) return null;
  return {
    name: state.name,
    source: 'gpx',
    sport: state.sport ?? null,
    points: state.track.map((p) => ({ lat: p.lat, lon: p.lon, ele: p.ele, time: null })),
    hasTime: false,
  };
}

export function shareSettings(state: ShareState, timezone = 'Europe/Paris'): RideSettings {
  return { startTime: state.startTime, speedModel: state.speedModel, reversed: state.reversed, timezone };
}
