/**
 * Logique pure de la carte : GeoJSON de la trace colorée, flèches de vent, boucle,
 * padding de recentrage, plus proche point en pixels. Aucune dépendance MapLibre / DOM.
 */
import type { MapLayer, PointWeather, Route, RoutePoint, Timing } from '../../types';
import { PRECIP_STOPS, TEMP_STOPS, WIND_RELATION_COLORS, WIND_STOPS, ramp } from '../../lib/colors';

/* ------------------------------------------------------------------ */
/* GeoJSON minimal (évite une dépendance @types/geojson)               */
/* ------------------------------------------------------------------ */

export type Position = [number, number];
export interface LineFeature<P> {
  type: 'Feature';
  properties: P;
  geometry: { type: 'LineString'; coordinates: Position[] };
}
export interface PointFeature<P> {
  type: 'Feature';
  properties: P;
  geometry: { type: 'Point'; coordinates: Position };
}
export interface FC<F> {
  type: 'FeatureCollection';
  features: F[];
}

/** Couleur neutre de la trace pendant le chargement de la météo. */
export const NEUTRAL_ROUTE_COLOR = '#7dd3fc';
/** Couleur de la trace sur la couche pluie quand il ne pleut pas. */
export const DRY_ROUTE_COLOR = '#e2e8f0';

/* ------------------------------------------------------------------ */
/* Géodésie                                                             */
/* ------------------------------------------------------------------ */

const R = 6371008.8;
const toRad = (d: number) => (d * Math.PI) / 180;

export function haversine(a: { lat: number; lon: number }, b: { lat: number; lon: number }): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Boucle = départ et arrivée à moins de `threshold` m. */
export function isLoop(route: Pick<Route, 'points'>, threshold = 200): boolean {
  const pts = route.points;
  if (pts.length < 2) return false;
  return haversine(pts[0], pts[pts.length - 1]) < threshold;
}

/** Bbox [w, s, e, n] des points. */
export function pointsBounds(points: { lat: number; lon: number }[]): [number, number, number, number] {
  let w = Infinity,
    s = Infinity,
    e = -Infinity,
    n = -Infinity;
  for (const p of points) {
    if (p.lon < w) w = p.lon;
    if (p.lon > e) e = p.lon;
    if (p.lat < s) s = p.lat;
    if (p.lat > n) n = p.lat;
  }
  return [w, s, e, n];
}

/* ------------------------------------------------------------------ */
/* Trace colorée                                                        */
/* ------------------------------------------------------------------ */

/** Couleur d'un point de la trace selon la couche active (null = pas de météo). */
export function pointColor(layer: MapLayer, w: PointWeather | undefined): string | null {
  if (!w) return null;
  switch (layer) {
    case 'wind':
      return WIND_RELATION_COLORS[w.windRelation];
    case 'rain':
      // Sec (< 0.1 mm/h) : gris clair lisible sur le champ bleu ; sinon PRECIP_STOPS quantifié à 0.1 mm/h.
      return w.precipitation < 0.1
        ? DRY_ROUTE_COLOR
        : ramp(PRECIP_STOPS, Math.round(w.precipitation * 10) / 10);
    case 'temperature':
      return ramp(TEMP_STOPS, Math.round(w.temperature * 2) / 2);
  }
}

export interface SegmentProps {
  color: string;
  /** Index du premier RoutePoint du segment. */
  from: number;
  to: number;
}

/**
 * Segments de trace colorés (FeatureCollection de LineString avec propriété `color`).
 * Les points consécutifs de même couleur sont fusionnés. Sans météo : un seul segment neutre.
 */
export function buildColoredSegments(
  route: Pick<Route, 'points'>,
  weather: PointWeather[],
  layer: MapLayer,
): FC<LineFeature<SegmentProps>> {
  const pts = route.points;
  const features: LineFeature<SegmentProps>[] = [];
  if (pts.length < 2) return { type: 'FeatureCollection', features };
  const byIndex = indexWeather(weather, pts.length);
  if (!byIndex) {
    features.push({
      type: 'Feature',
      properties: { color: NEUTRAL_ROUTE_COLOR, from: 0, to: pts.length - 1 },
      geometry: { type: 'LineString', coordinates: pts.map(toPos) },
    });
    return { type: 'FeatureCollection', features };
  }
  let start = 0;
  let color = pointColor(layer, byIndex[0]) ?? NEUTRAL_ROUTE_COLOR;
  for (let i = 1; i < pts.length; i++) {
    const c = i < pts.length - 1 ? (pointColor(layer, byIndex[i]) ?? NEUTRAL_ROUTE_COLOR) : color;
    if (c !== color || i === pts.length - 1) {
      // Segment [start, i] (le point i est partagé avec le segment suivant → pas de trou).
      features.push({
        type: 'Feature',
        properties: { color, from: start, to: i },
        geometry: { type: 'LineString', coordinates: pts.slice(start, i + 1).map(toPos) },
      });
      start = i;
      color = c;
    }
  }
  return { type: 'FeatureCollection', features };
}

/** Ligne simple de la trace (casing / zone de survol). */
export function buildRouteLine(route: Pick<Route, 'points'>): LineFeature<Record<string, never>> {
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'LineString', coordinates: route.points.map(toPos) },
  };
}

function toPos(p: RoutePoint): Position {
  return [p.lon, p.lat];
}

/** weather[] → tableau indexé par routeIndex, null si vide / incohérent. */
function indexWeather(weather: PointWeather[], n: number): (PointWeather | undefined)[] | null {
  if (!weather.length) return null;
  const out: (PointWeather | undefined)[] = new Array(n);
  for (const w of weather) if (w.routeIndex >= 0 && w.routeIndex < n) out[w.routeIndex] = w;
  // Combler les trous éventuels avec la dernière valeur connue.
  let last: PointWeather | undefined;
  for (let i = 0; i < n; i++) {
    if (out[i]) last = out[i];
    else out[i] = last;
  }
  let first: PointWeather | undefined;
  for (let i = n - 1; i >= 0; i--) {
    if (out[i]) first = out[i];
    else out[i] = first;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Flèches de vent                                                      */
/* ------------------------------------------------------------------ */

export interface ArrowProps {
  routeIndex: number;
  /** Direction vers laquelle souffle le vent (°), pour `icon-rotate`. */
  rotate: number;
  speed: number;
  color: string;
}

/** Espacement des flèches selon la longueur : ~3 km pour < 60 km, 4 km < 150 km, sinon 5 km. */
export function arrowSpacing(distance: number): number {
  if (distance < 60_000) return 3000;
  if (distance < 150_000) return 4000;
  return 5000;
}

/** Points (1 tous les `spacing` m, en commençant à spacing/2) portant la direction et la vitesse du vent. */
export function buildWindArrows(
  route: Pick<Route, 'points'>,
  weather: PointWeather[],
  spacing = arrowSpacing(route.points[route.points.length - 1]?.dist ?? 0),
): FC<PointFeature<ArrowProps>> {
  const pts = route.points;
  const features: PointFeature<ArrowProps>[] = [];
  const byIndex = indexWeather(weather, pts.length);
  if (!byIndex || pts.length < 2) return { type: 'FeatureCollection', features };
  let next = spacing / 2;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].dist < next) continue;
    const w = byIndex[i];
    if (w) {
      features.push({
        type: 'Feature',
        properties: {
          routeIndex: i,
          rotate: (((w.windDirection + 180) % 360) + 360) % 360,
          speed: w.windSpeed,
          color: ramp(WIND_STOPS, w.windSpeed),
        },
        geometry: { type: 'Point', coordinates: [pts[i].lon, pts[i].lat] },
      });
    }
    while (next <= pts[i].dist) next += spacing;
  }
  return { type: 'FeatureCollection', features };
}

/* ------------------------------------------------------------------ */
/* Recentrage                                                           */
/* ------------------------------------------------------------------ */

export interface Padding {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Padding du fitBounds : desktop (≥ 1024 px) sidebar à gauche (~400 px) + profil en bas (~200 px) ;
 * mobile : bottom sheet ~45 % de la hauteur. Réduit proportionnellement si la vue est trop petite.
 */
export function recenterPadding(width: number, height: number): Padding {
  const p: Padding =
    width >= 1024
      ? { top: 90, bottom: 310, left: 430, right: 90 }
      : { top: 80, bottom: Math.round(height * 0.45), left: 32, right: 32 };
  // Garder au moins 30 % de la largeur / hauteur pour la trace.
  const fit = (a: number, b: number, total: number): [number, number] => {
    const max = total * 0.7;
    if (a + b <= max) return [a, b];
    const k = max / (a + b);
    return [Math.floor(a * k), Math.floor(b * k)];
  };
  [p.left, p.right] = fit(p.left, p.right, width);
  [p.top, p.bottom] = fit(p.top, p.bottom, height);
  return p;
}

/* ------------------------------------------------------------------ */
/* Survol                                                               */
/* ------------------------------------------------------------------ */

/**
 * Index du point projeté (x, y en pixels) le plus proche, ou -1 si aucun à moins de `maxDist` px.
 * `xy` = [x0, y0, x1, y1, …].
 */
export function nearestIndex(xy: ArrayLike<number>, x: number, y: number, maxDist = Infinity): number {
  let best = -1;
  let bestD = maxDist * maxDist;
  for (let i = 0, k = 0; k < xy.length; i++, k += 2) {
    const dx = xy[k] - x,
      dy = xy[k + 1] - y;
    const d = dx * dx + dy * dy;
    if (d <= bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/* ------------------------------------------------------------------ */
/* Position à l'instant t (repli si route/positionAtTime indisponible)  */
/* ------------------------------------------------------------------ */

export function positionFromEtas(
  route: Pick<Route, 'points'>,
  timing: Pick<Timing, 'etas'>,
  t: number,
): { index: number; lat: number; lon: number; dist: number } {
  const pts = route.points;
  const etas = timing.etas;
  const n = Math.min(pts.length, etas.length);
  if (!n) return { index: 0, lat: 0, lon: 0, dist: 0 };
  if (t <= etas[0]) return { index: 0, lat: pts[0].lat, lon: pts[0].lon, dist: pts[0].dist };
  if (t >= etas[n - 1]) {
    const p = pts[n - 1];
    return { index: n - 1, lat: p.lat, lon: p.lon, dist: p.dist };
  }
  let lo = 0,
    hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (etas[mid] <= t) lo = mid;
    else hi = mid;
  }
  const span = etas[hi] - etas[lo];
  const k = span > 0 ? (t - etas[lo]) / span : 0;
  const a = pts[lo],
    b = pts[hi];
  return {
    index: k < 0.5 ? lo : hi,
    lat: a.lat + (b.lat - a.lat) * k,
    lon: a.lon + (b.lon - a.lon) * k,
    dist: a.dist + (b.dist - a.dist) * k,
  };
}

/** Le départ est-il dans la fenêtre du radar (dans < 2 h, ou commencé depuis < 2 h) ? */
export function isRadarWindow(startTime: number, now = Date.now(), windowMs = 2 * 3600_000): boolean {
  return startTime >= now - windowMs && startTime <= now + windowMs;
}
