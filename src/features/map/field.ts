/**
 * Champs météo interpolés depuis la WeatherGrid (pluie, température, vent pour les particules).
 * Le calcul (tableau RGBA, valeurs) est pur et testable en node ; seule `renderFieldImage`
 * touche au DOM (canvas → data URL).
 */
import type { WeatherGrid, WeatherHour } from '../../types';
import type { Stops } from '../../lib/colors';
import { rampRgb } from '../../lib/colors';

export type ValueFn = (h: WeatherHour) => number;

/** Coordonnées des 4 coins (NO, NE, SE, SO) au format MapLibre image source. */
export type Corners = [[number, number], [number, number], [number, number], [number, number]];

/* ------------------------------------------------------------------ */
/* Échantillonnage de la grille                                         */
/* ------------------------------------------------------------------ */

/** Indice + fraction temporelle de t dans `times` (clampé). */
export function timeFraction(times: number[], t: number): { k: number; f: number } {
  const n = times.length;
  if (n <= 1 || t <= times[0]) return { k: 0, f: 0 };
  if (t >= times[n - 1]) return { k: n - 1, f: 0 };
  let lo = 0,
    hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid;
    else hi = mid;
  }
  return { k: lo, f: (t - times[lo]) / (times[hi] - times[lo]) };
}

/** Valeur de chaque cellule à l'instant t (interpolation linéaire temporelle). NaN si manquante. */
export function cellValuesAt(grid: WeatherGrid, t: number, valueFn: ValueFn): Float64Array {
  const { k, f } = timeFraction(grid.times, t);
  const out = new Float64Array(grid.nx * grid.ny);
  for (let c = 0; c < out.length; c++) {
    const hours = grid.cells[c]?.hours;
    const a = hours?.[k];
    if (!a) {
      out[c] = NaN;
      continue;
    }
    const b = f > 0 ? hours[k + 1] : undefined;
    const va = valueFn(a);
    out[c] = b ? va + (valueFn(b) - va) * f : va;
  }
  return out;
}

/** Axes (lon des colonnes, lat des lignes, sud → nord) déduits des cellules. */
export function gridAxes(grid: WeatherGrid): { lons: number[]; lats: number[] } {
  const lons: number[] = [];
  const lats: number[] = [];
  for (let i = 0; i < grid.nx; i++)
    lons.push(grid.cells[i]?.lon ?? lerp(grid.bbox[0], grid.bbox[2], i / Math.max(1, grid.nx - 1)));
  for (let j = 0; j < grid.ny; j++)
    lats.push(grid.cells[j * grid.nx]?.lat ?? lerp(grid.bbox[1], grid.bbox[3], j / Math.max(1, grid.ny - 1)));
  return { lons, lats };
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Position fractionnaire (clampée) d'une coordonnée dans un axe croissant. */
function axisPos(axis: number[], v: number): { i: number; f: number } {
  const n = axis.length;
  if (n <= 1 || v <= axis[0]) return { i: 0, f: 0 };
  if (v >= axis[n - 1]) return { i: n - 1, f: 0 };
  let i = 0;
  while (i < n - 2 && axis[i + 1] <= v) i++;
  return { i, f: (v - axis[i]) / (axis[i + 1] - axis[i]) };
}

/** Interpolation bilinéaire d'un tableau de valeurs de cellules (NaN ignorés). */
export function bilinear(values: ArrayLike<number>, nx: number, ny: number, fx: number, fy: number): number {
  const i0 = Math.max(0, Math.min(nx - 1, Math.floor(fx)));
  const j0 = Math.max(0, Math.min(ny - 1, Math.floor(fy)));
  const i1 = Math.min(nx - 1, i0 + 1);
  const j1 = Math.min(ny - 1, j0 + 1);
  const tx = Math.max(0, Math.min(1, fx - i0));
  const ty = Math.max(0, Math.min(1, fy - j0));
  const w = [(1 - tx) * (1 - ty), tx * (1 - ty), (1 - tx) * ty, tx * ty];
  const v = [values[j0 * nx + i0], values[j0 * nx + i1], values[j1 * nx + i0], values[j1 * nx + i1]];
  let s = 0,
    ws = 0;
  for (let k = 0; k < 4; k++) {
    if (Number.isFinite(v[k]) && w[k] > 0) {
      s += v[k] * w[k];
      ws += w[k];
    }
  }
  return ws > 0 ? s / ws : NaN;
}

/** Échantillonneur (lat, lon) → valeur, pré-calculé pour un instant donné. */
export function makeGridSampler(
  grid: WeatherGrid,
  t: number,
  valueFn: ValueFn,
): (lat: number, lon: number) => number {
  const vals = cellValuesAt(grid, t, valueFn);
  const { lons, lats } = gridAxes(grid);
  return (lat, lon) => {
    const x = axisPos(lons, lon);
    const y = axisPos(lats, lat);
    return bilinear(vals, grid.nx, grid.ny, x.i + x.f, y.i + y.f);
  };
}

/**
 * Échantillonneur de vent (u = vers l'est, v = vers le nord, km/h) à l'instant t.
 * Les composantes sont interpolées (et non la direction) pour éviter les sauts 359° → 0°.
 */
export function makeWindSampler(
  grid: WeatherGrid,
  t: number,
): (lat: number, lon: number) => { u: number; v: number } | null {
  const u = makeGridSampler(grid, t, (h) => -h.windSpeed * Math.sin((h.windDirection * Math.PI) / 180));
  const v = makeGridSampler(grid, t, (h) => -h.windSpeed * Math.cos((h.windDirection * Math.PI) / 180));
  return (lat, lon) => {
    const a = u(lat, lon),
      b = v(lat, lon);
    return Number.isFinite(a) && Number.isFinite(b) ? { u: a, v: b } : null;
  };
}

/* ------------------------------------------------------------------ */
/* Image de champ                                                       */
/* ------------------------------------------------------------------ */

export interface FieldOptions {
  /** Taille de l'image en pixels (défaut 256 × 256). */
  width?: number;
  height?: number;
  /** Transparent sous ce seuil (ex. 0.1 mm/h pour la pluie). */
  minValue?: number;
  /** Alpha 0–1 selon la valeur (défaut 1). Multiplié par 255. */
  alpha?: (v: number) => number;
  /** Fondu des bords (fraction de la largeur / hauteur, ex. 0.12) : évite un rectangle net. Défaut 0. */
  edgeFeather?: number;
}

export interface FieldRGBA {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  /** Coins de l'image (NO, NE, SE, SO). */
  coordinates: Corners;
}

const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const invMercY = (y: number) => (360 / Math.PI) * Math.atan(Math.exp(y)) - 90;

/** LUT de couleurs (n entrées) sur la plage des stops. */
function colorLut(stops: Stops, n = 512): { lut: Uint8Array; min: number; max: number } {
  const min = stops[0][0],
    max = stops[stops.length - 1][0];
  const lut = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const [r, g, b] = rampRgb(stops, min + ((max - min) * i) / (n - 1));
    lut[i * 3] = r;
    lut[i * 3 + 1] = g;
    lut[i * 3 + 2] = b;
  }
  return { lut, min, max };
}

/**
 * Calcule l'image RGBA d'un champ couvrant la bbox de la grille (rangée 0 = nord).
 * Lignes espacées en Mercator pour coller exactement à la projection de la carte.
 */
export function computeFieldRGBA(
  grid: WeatherGrid,
  time: number,
  valueFn: ValueFn,
  stops: Stops,
  opts: FieldOptions = {},
): FieldRGBA {
  const width = opts.width ?? 256;
  const height = opts.height ?? 256;
  const [w, s, e, n] = grid.bbox;
  const vals = cellValuesAt(grid, time, valueFn);
  const { lons, lats } = gridAxes(grid);
  const { lut, min, max } = colorLut(stops);
  const lutN = lut.length / 3;
  const data = new Uint8ClampedArray(width * height * 4);

  // Positions fractionnaires pré-calculées par colonne / ligne.
  const fxs = new Float64Array(width);
  for (let x = 0; x < width; x++) {
    const p = axisPos(lons, w + ((e - w) * (x + 0.5)) / width);
    fxs[x] = p.i + p.f;
  }
  const yN = mercY(n),
    yS = mercY(s);
  const fys = new Float64Array(height);
  for (let y = 0; y < height; y++) {
    const p = axisPos(lats, invMercY(yN + ((yS - yN) * (y + 0.5)) / height));
    fys[y] = p.i + p.f;
  }

  const feather = Math.max(0, Math.min(0.5, opts.edgeFeather ?? 0));
  const edge = (i: number, n: number) => {
    if (!feather) return 1;
    const d = Math.min(i + 0.5, n - i - 0.5) / n / feather;
    return d >= 1 ? 1 : d * d * (3 - 2 * d); // smoothstep
  };
  const ex = Float64Array.from({ length: width }, (_, x) => edge(x, width));
  const ey = Float64Array.from({ length: height }, (_, y) => edge(y, height));

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const v = bilinear(vals, grid.nx, grid.ny, fxs[x], fys[y]);
      const o = (y * width + x) * 4;
      if (!Number.isFinite(v) || (opts.minValue !== undefined && v < opts.minValue)) continue; // transparent
      const li = Math.max(0, Math.min(lutN - 1, Math.round(((v - min) / (max - min)) * (lutN - 1))));
      data[o] = lut[li * 3];
      data[o + 1] = lut[li * 3 + 1];
      data[o + 2] = lut[li * 3 + 2];
      data[o + 3] = Math.round(
        255 * ex[x] * ey[y] * Math.max(0, Math.min(1, opts.alpha ? opts.alpha(v) : 1)),
      );
    }
  }
  return {
    data,
    width,
    height,
    coordinates: [
      [w, n],
      [e, n],
      [e, s],
      [w, s],
    ],
  };
}

/** Rend le champ dans un canvas et renvoie une data URL PNG (navigateur uniquement). */
export function renderFieldImage(
  grid: WeatherGrid,
  time: number,
  valueFn: ValueFn,
  stops: Stops,
  opts: FieldOptions = {},
): { url: string; coordinates: Corners } | null {
  if (typeof document === 'undefined' || !grid.cells.length) return null;
  const f = computeFieldRGBA(grid, time, valueFn, stops, opts);
  const canvas = document.createElement('canvas');
  canvas.width = f.width;
  canvas.height = f.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.putImageData(new ImageData(f.data as Uint8ClampedArray<ArrayBuffer>, f.width, f.height), 0, 0);
  return { url: canvas.toDataURL('image/png'), coordinates: f.coordinates };
}

/* Réglages par couche */
export const precipValue: ValueFn = (h) => h.precipitation;
export const tempValue: ValueFn = (h) => h.temperature;
/** Pluie : apparition progressive de 0.1 à 1 mm/h. */
export const precipAlpha = (v: number) => 0.35 + 0.65 * Math.min(1, Math.max(0, (v - 0.1) / 0.9));

/* ------------------------------------------------------------------ */
/* Champ de vent écran (particules)                                     */
/* ------------------------------------------------------------------ */

export interface ScreenWindField {
  cols: number;
  rows: number;
  step: number;
  /** Composantes écran (px de l'écran, x → droite, y → bas) en km/h ; NaN = hors grille. */
  u: Float32Array;
  v: Float32Array;
}

/**
 * Grille écran (1 échantillon tous les `step` px) du vent, à partir d'un échantillonneur
 * pixel → (u est, v nord). `bearing` = rotation de la carte (°) pour passer en repère écran.
 */
export function buildScreenWindField(
  width: number,
  height: number,
  step: number,
  sampleAtPixel: (x: number, y: number) => { u: number; v: number } | null,
  bearing = 0,
): ScreenWindField {
  const cols = Math.ceil(width / step) + 1;
  const rows = Math.ceil(height / step) + 1;
  const u = new Float32Array(cols * rows);
  const v = new Float32Array(cols * rows);
  const b = (bearing * Math.PI) / 180;
  const cos = Math.cos(b),
    sin = Math.sin(b);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const k = r * cols + c;
      const s = sampleAtPixel(c * step, r * step);
      if (!s) {
        u[k] = NaN;
        v[k] = NaN;
        continue;
      }
      // Vecteur géographique (est, nord) → écran : rotation de -bearing, y vers le bas.
      u[k] = s.u * cos - s.v * sin;
      v[k] = -(s.u * sin + s.v * cos);
    }
  }
  return { cols, rows, step, u, v };
}

/** Vent écran interpolé au pixel (x, y), null hors champ. */
export function windAtPixel(f: ScreenWindField, x: number, y: number): { u: number; v: number } | null {
  const fx = x / f.step,
    fy = y / f.step;
  if (fx < 0 || fy < 0 || fx > f.cols - 1 || fy > f.rows - 1) return null;
  const u = bilinear(f.u, f.cols, f.rows, fx, fy);
  const v = bilinear(f.v, f.cols, f.rows, fx, fy);
  return Number.isFinite(u) && Number.isFinite(v) ? { u, v } : null;
}
