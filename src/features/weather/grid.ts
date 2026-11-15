import type { Route, WeatherGrid, WeatherHour, WeatherValues } from '../../types';
import { fetchForecast } from './api';
import { blendValues, valuesAtTime } from './interpolate';
import { WeatherApiError } from './errors';

const HOUR = 3_600_000;
const MAX_CELLS = 100;

/** Dimensions nx×ny adaptées au ratio de la bbox (en km), total ≤ 100. */
export function gridDims(bbox: [number, number, number, number], size: number): { nx: number; ny: number } {
  const [w, s, e, n] = bbox;
  const midLat = ((s + n) / 2) * (Math.PI / 180);
  const widthKm = Math.max((e - w) * 111.32 * Math.cos(midLat), 0.1);
  const heightKm = Math.max((n - s) * 110.57, 0.1);
  const r = Math.sqrt(widthKm / heightKm);
  let nx = Math.max(2, Math.round(size * r));
  let ny = Math.max(2, Math.round(size / r));
  while (nx * ny > MAX_CELLS) {
    if (nx >= ny) nx--;
    else ny--;
  }
  return { nx, ny };
}

/** BBox de la trace + marge 15 % (au moins ~2 km). */
export function gridBBox(route: Route): [number, number, number, number] {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const p of route.points) {
    if (p.lon < w) w = p.lon;
    if (p.lon > e) e = p.lon;
    if (p.lat < s) s = p.lat;
    if (p.lat > n) n = p.lat;
  }
  const mx = Math.max((e - w) * 0.15, 0.02);
  const my = Math.max((n - s) * 0.15, 0.02);
  return [w - mx, s - my, e + mx, n + my];
}

/** Grille régulière (≈ size×size) autour de la trace, avec marge. Requêtes groupées + cache. */
export async function fetchWeatherGrid(
  route: Route,
  startMs: number,
  endMs: number,
  size = 8,
): Promise<WeatherGrid> {
  if (!route.points.length) throw new WeatherApiError('trace vide');
  const bbox = gridBBox(route);
  const { nx, ny } = gridDims(bbox, size);
  const [w, s, e, n] = bbox;
  const nodes: { lat: number; lon: number }[] = [];
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      nodes.push({ lat: s + ((n - s) * j) / (ny - 1), lon: w + ((e - w) * i) / (nx - 1) });
    }
  }
  const series = await fetchForecast(nodes, startMs - HOUR, endMs + HOUR);
  // Heures communes à toutes les cellules.
  const sets = series.map((h) => new Set(h.map((x) => x.time)));
  const times = (series[0] ?? []).map((h) => h.time).filter((t) => sets.every((st) => st.has(t)));
  if (!times.length) throw new WeatherApiError('grille météo indisponible pour ces dates');
  const keep = new Set(times);
  const cells = nodes.map((node, k) => ({
    lat: node.lat,
    lon: node.lon,
    hours: series[k].filter((h) => keep.has(h.time)) as WeatherHour[],
  }));
  return { bbox, nx, ny, times, cells };
}

/** Interpolation bilinéaire spatiale + linéaire temporelle dans la grille (vent par composantes). null hors bbox. */
export function sampleGrid(
  grid: WeatherGrid,
  lat: number,
  lon: number,
  timeMs: number,
): WeatherValues | null {
  const [w, s, e, n] = grid.bbox;
  if (lon < w || lon > e || lat < s || lat > n || grid.nx < 2 || grid.ny < 2) return null;
  const fx = ((lon - w) / (e - w || 1)) * (grid.nx - 1);
  const fy = ((lat - s) / (n - s || 1)) * (grid.ny - 1);
  const i0 = Math.min(Math.floor(fx), grid.nx - 2);
  const j0 = Math.min(Math.floor(fy), grid.ny - 2);
  const tx = fx - i0;
  const ty = fy - j0;
  const at = (i: number, j: number) => valuesAtTime(grid.cells[j * grid.nx + i]?.hours ?? [], timeMs);
  const c00 = at(i0, j0);
  const c10 = at(i0 + 1, j0);
  const c01 = at(i0, j0 + 1);
  const c11 = at(i0 + 1, j0 + 1);
  if (!c00 || !c10 || !c01 || !c11) return null;
  return blendValues(blendValues(c00, c10, tx), blendValues(c01, c11, tx), ty);
}
