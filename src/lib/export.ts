/**
 * Export PNG : carte (canvas MapLibre) + panneau profil/stats (html-to-image), composés sur un canvas
 * avec titre, date, stats clés et crédits.
 */
import type { RideStats, Route, Timing } from '../types';
import { fmtDate, fmtDuration, fmtKm, fmtM, fmtTime } from './format';
import { toLocalDateTime } from './time';

/** Nom de fichier ASCII sûr. */
export function slugify(name: string): string {
  return (
    name
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48) || 'trace'
  );
}

export function exportFileName(name: string, startTime: number): string {
  return `routecast-${slugify(name)}-${toLocalDateTime(startTime).date}.png`;
}

// Module de la carte (agent Carte) : résolu à la compilation s'il existe, sinon {}.
const mapModules = import.meta.glob<{ getMapCanvasDataUrl?: () => string | null | Promise<string | null> }>(
  '../features/map/mapInstance.ts',
);

/** Capture de la carte en data URL, ou null si indisponible. Ne lève jamais. */
export async function captureMap(): Promise<string | null> {
  try {
    const loader = Object.values(mapModules)[0];
    if (loader) {
      const mod = await loader();
      const url = await mod.getMapCanvasDataUrl?.();
      if (url) return url;
    }
  } catch {
    /* ignore */
  }
  try {
    const c = document.querySelector<HTMLCanvasElement>('[data-testid="map"] canvas');
    return c ? c.toDataURL('image/png') : null;
  } catch {
    return null; // canvas « tainted » ou preserveDrawingBuffer absent
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('image'));
    img.src = src;
  });
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export interface ExportInput {
  route: Route;
  startTime: number;
  timing: Timing | null;
  stats: RideStats | null;
  /** Élément DOM du panneau profil (capturé via html-to-image). */
  profileEl: HTMLElement | null;
  dark: boolean;
}

export async function exportPng(input: ExportInput): Promise<void> {
  const { route, startTime, timing, stats, profileEl, dark } = input;
  const W = 1600;
  const pad = 48;
  const headerH = 200;
  const mapH = 860;

  const [mapUrl, profileUrl] = await Promise.all([
    captureMap(),
    profileEl
      ? import('html-to-image')
          .then(({ toPng }) =>
            toPng(profileEl, {
              pixelRatio: 2,
              cacheBust: true,
              backgroundColor: dark ? '#0f172a' : '#ffffff',
              filter: (n) => !(n instanceof HTMLElement && n.dataset.exportIgnore != null),
            }),
          )
          .catch(() => null)
      : Promise.resolve(null),
  ]);
  const mapImg = mapUrl ? await loadImage(mapUrl).catch(() => null) : null;
  const profImg = profileUrl ? await loadImage(profileUrl).catch(() => null) : null;
  const profH = profImg ? Math.round(((W - pad * 2) / profImg.width) * profImg.height) : 0;
  const H = headerH + mapH + (profImg ? profH + pad : 0) + 90;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const bg = ctx.createLinearGradient(0, 0, W, H);
  bg.addColorStop(0, dark ? '#0b1020' : '#eef4ff');
  bg.addColorStop(1, dark ? '#161b3d' : '#e0e7ff');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, W, H);

  const fg = dark ? '#f8fafc' : '#0f172a';
  const muted = dark ? 'rgba(226,232,240,0.72)' : 'rgba(30,41,59,0.72)';
  const font = "'Inter Variable', Inter, system-ui, sans-serif";

  // En-tête
  ctx.fillStyle = '#60a5fa';
  ctx.font = `600 26px ${font}`;
  ctx.fillText('RouteCast', pad, 64);
  ctx.fillStyle = fg;
  ctx.font = `700 46px ${font}`;
  ctx.fillText(route.name.slice(0, 60), pad, 120);
  ctx.fillStyle = muted;
  ctx.font = `500 26px ${font}`;
  const dateLine = `${fmtDate(startTime)} · départ ${fmtTime(startTime)}${timing ? ` · arrivée ${fmtTime(timing.arrival)}` : ''}`;
  ctx.fillText(dateLine.charAt(0).toUpperCase() + dateLine.slice(1), pad, 162);

  const chips: string[] = [fmtKm(route.stats.distance), `D+ ${fmtM(route.stats.ascent)}`];
  if (timing) chips.push(fmtDuration(timing.durationSec));
  if (stats) {
    chips.push(`${Math.round(stats.minTemp)}–${Math.round(stats.maxTemp)} °C`);
    chips.push(`Vent de face ${Math.round(stats.headwindShare * 100)} %`);
    chips.push(`Pluie ${Math.round(stats.maxPrecipProbability)} %`);
  }
  ctx.font = `600 22px ${font}`;
  let cx = W - pad;
  for (const c of chips.slice().reverse()) {
    const w = ctx.measureText(c).width + 32;
    if (cx - w < pad + 220) break;
    cx -= w;
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.08)' : 'rgba(15,23,42,0.06)';
    roundRect(ctx, cx, 40, w, 44, 22);
    ctx.fill();
    ctx.fillStyle = fg;
    ctx.fillText(c, cx + 16, 70);
    cx -= 10;
  }

  // Carte
  const mx = pad;
  const my = headerH;
  const mw = W - pad * 2;
  ctx.save();
  roundRect(ctx, mx, my, mw, mapH, 28);
  ctx.clip();
  if (mapImg) {
    const s = Math.max(mw / mapImg.width, mapH / mapImg.height);
    const dw = mapImg.width * s;
    const dh = mapImg.height * s;
    ctx.drawImage(mapImg, mx + (mw - dw) / 2, my + (mapH - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = dark ? '#111827' : '#cbd5e1';
    ctx.fillRect(mx, my, mw, mapH);
    ctx.fillStyle = muted;
    ctx.font = `500 26px ${font}`;
    ctx.fillText('Carte indisponible pour l’export', mx + 32, my + 56);
  }
  ctx.restore();

  // Profil
  if (profImg) {
    const py = my + mapH + pad;
    ctx.save();
    roundRect(ctx, pad, py, mw, profH, 24);
    ctx.clip();
    ctx.drawImage(profImg, pad, py, mw, profH);
    ctx.restore();
  }

  // Crédits
  ctx.fillStyle = muted;
  ctx.font = `400 20px ${font}`;
  ctx.fillText(
    'Météo : Open-Meteo.com (CC BY 4.0) · Fond : © OpenStreetMap contributors, OpenFreeMap · Généré avec RouteCast',
    pad,
    H - 40,
  );

  const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/png'));
  if (!blob) throw new Error('Export impossible');
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = exportFileName(route.name, startTime);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
