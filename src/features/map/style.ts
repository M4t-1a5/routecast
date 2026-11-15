/** Fonds de carte : OpenFreeMap (clair / sombre), OpenTopoMap (raster), et repli hors ligne. */
import type { StyleSpecification } from 'maplibre-gl';
import type { BaseMap, ThemeMode } from '../../types';

export const OFM_LIGHT = 'https://tiles.openfreemap.org/styles/liberty';
export const OFM_DARK = 'https://tiles.openfreemap.org/styles/dark';

export const OFM_ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">© OpenFreeMap</a> <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>';
export const OTM_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, SRTM | © <a href="https://opentopomap.org" target="_blank" rel="noopener">OpenTopoMap</a> (CC-BY-SA)';
export const RAINVIEWER_ATTRIBUTION =
  '<a href="https://www.rainviewer.com/" target="_blank" rel="noopener">RainViewer</a>';

export const FALLBACK_BG = '#0b1020';

export function fallbackStyle(theme: ThemeMode = 'dark'): StyleSpecification {
  return {
    version: 8,
    sources: {},
    layers: [
      {
        id: 'bg',
        type: 'background',
        paint: { 'background-color': theme === 'dark' ? FALLBACK_BG : '#e5e7eb' },
      },
    ],
  };
}

export function topoStyle(theme: ThemeMode): StyleSpecification {
  return {
    version: 8,
    sources: {
      otm: {
        type: 'raster',
        tiles: ['a', 'b', 'c'].map((s) => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
        tileSize: 256,
        maxzoom: 17,
        attribution: OTM_ATTRIBUTION,
      },
    },
    layers: [
      {
        id: 'bg',
        type: 'background',
        paint: { 'background-color': theme === 'dark' ? '#1f2937' : '#f3f4f6' },
      },
      {
        id: 'otm',
        type: 'raster',
        source: 'otm',
        // En thème sombre, on atténue la luminosité du fond topo.
        paint: theme === 'dark' ? { 'raster-brightness-max': 0.78, 'raster-saturation': -0.15 } : {},
      },
    ],
  };
}

export function vectorStyleUrl(theme: ThemeMode): string {
  return theme === 'dark' ? OFM_DARK : OFM_LIGHT;
}

/** Libellés en français quand disponibles (name:fr), sinon nom latin / local. */
export function frenchLabels(style: StyleSpecification): StyleSpecification {
  const layers = style.layers.map((l) => {
    if (l.type !== 'symbol' || !l.layout?.['text-field']) return l;
    const tf = JSON.stringify(l.layout['text-field']);
    if (!/name/.test(tf) || /ref|housenumber/.test(tf)) return l;
    return {
      ...l,
      layout: {
        ...l.layout,
        'text-field': ['coalesce', ['get', 'name:fr'], ['get', 'name:latin'], ['get', 'name']],
      },
    } as typeof l;
  });
  // Attribution compacte OpenFreeMap / OpenMapTiles / OSM sur la source vectorielle.
  const sources = Object.fromEntries(
    Object.entries(style.sources).map(([id, s]) => [
      id,
      s.type === 'vector' ? { ...s, attribution: OFM_ATTRIBUTION } : s,
    ]),
  ) as StyleSpecification['sources'];
  return { ...style, sources, layers };
}

const cache = new Map<string, StyleSpecification>();

/** Charge (et met en cache) un style JSON. Rejette si hors ligne / erreur HTTP. */
export async function fetchStyle(url: string, signal?: AbortSignal): Promise<StyleSpecification> {
  const hit = cache.get(url);
  if (hit) return hit;
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = frenchLabels((await res.json()) as StyleSpecification);
  cache.set(url, json);
  return json;
}

/** Style à appliquer pour (thème, fond). Ne rejette jamais : repli sur un fond uni. */
export async function resolveStyle(
  theme: ThemeMode,
  baseMap: BaseMap,
  signal?: AbortSignal,
): Promise<StyleSpecification> {
  if (baseMap === 'topo') return topoStyle(theme);
  try {
    return await fetchStyle(vectorStyleUrl(theme), signal);
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw e;
    return fallbackStyle(theme);
  }
}
