/**
 * Accès global à l'instance MapLibre (export PNG par l'agent UI).
 * La carte est créée avec `preserveDrawingBuffer: true` : son canvas est lisible à tout moment.
 */
import type { Map as MlMap } from 'maplibre-gl';

let instance: MlMap | null = null;
let particleCanvas: HTMLCanvasElement | null = null;

export function getMap(): MlMap | null {
  return instance;
}

/** @internal MapView */
export function registerMap(map: MlMap | null, particles: HTMLCanvasElement | null = null) {
  instance = map;
  particleCanvas = particles;
}

/**
 * Image PNG (data URL) de la carte WebGL + le canvas des particules de vent, à la taille
 * physique du canvas (devicePixelRatio inclus). Les marqueurs DOM et contrôles ne sont pas inclus.
 * null si la carte n'existe pas ou si le canvas est illisible.
 */
export function getMapCanvasDataUrl(): string | null {
  const map = instance;
  if (!map) return null;
  try {
    map.triggerRepaint();
    const base = map.getCanvas();
    const out = document.createElement('canvas');
    out.width = base.width;
    out.height = base.height;
    const ctx = out.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(base, 0, 0);
    const p = particleCanvas;
    if (p && p.width && p.height && p.style.opacity !== '0') ctx.drawImage(p, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  } catch {
    return null;
  }
}
