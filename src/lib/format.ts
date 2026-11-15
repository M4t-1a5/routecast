/** Formatage FR (fuseau Europe/Paris par défaut). */
export const TZ = 'Europe/Paris';

export const fmtKm = (m: number, digits = 1) =>
  `${(m / 1000).toLocaleString('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits })} km`;
export const fmtM = (m: number) => `${Math.round(m).toLocaleString('fr-FR')} m`;
export const fmtTemp = (c: number) => `${Math.round(c)} °C`;
export const fmtWind = (k: number) => `${Math.round(k)} km/h`;
export const fmtPct = (p: number) => `${Math.round(p)} %`;
export const fmtSpeed = (k: number) => `${k.toLocaleString('fr-FR', { maximumFractionDigits: 1 })} km/h`;

export function fmtTime(ms: number, tz = TZ) {
  return new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: tz }).format(ms);
}
export function fmtDate(ms: number, tz = TZ) {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: tz,
  }).format(ms);
}
export function fmtDateShort(ms: number, tz = TZ) {
  return new Intl.DateTimeFormat('fr-FR', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: tz,
  }).format(ms);
}
export function fmtDuration(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.round((sec % 3600) / 60);
  return h ? `${h} h ${String(m).padStart(2, '0')}` : `${m} min`;
}
export function fmtPace(secPerKm: number) {
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, '0')} /km`;
}
/** Point cardinal FR depuis une direction (°). */
export function cardinal(deg: number) {
  const d = ['N', 'NE', 'E', 'SE', 'S', 'SO', 'O', 'NO'];
  return d[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
}
/** Libellé WMO weather_code (FR, court). */
export function weatherLabel(code: number) {
  if (code === 0) return 'Ciel clair';
  if (code <= 2) return 'Éclaircies';
  if (code === 3) return 'Couvert';
  if (code <= 48) return 'Brouillard';
  if (code <= 57) return 'Bruine';
  if (code <= 67) return 'Pluie';
  if (code <= 77) return 'Neige';
  if (code <= 82) return 'Averses';
  if (code <= 86) return 'Averses de neige';
  return 'Orage';
}
