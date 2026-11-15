/**
 * Conversions de fuseau horaire robustes (Intl) : epoch ms ↔ { date: 'YYYY-MM-DD', time: 'HH:mm' }
 * dans un fuseau IANA (Europe/Paris par défaut). Gère les changements d'heure (heure inexistante → décalée,
 * heure ambiguë → première occurrence).
 */
export const PARIS = 'Europe/Paris';

export interface LocalDateTime {
  /** 'YYYY-MM-DD' */
  date: string;
  /** 'HH:mm' */
  time: string;
}

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string) {
  let f = dtfCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    dtfCache.set(tz, f);
  }
  return f;
}

interface Parts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function partsAt(ms: number, tz: string): Parts {
  const out: Record<string, number> = {};
  for (const p of dtf(tz).formatToParts(ms)) {
    if (p.type !== 'literal' && p.type !== 'weekday') out[p.type] = Number(p.value);
  }
  return {
    year: out.year,
    month: out.month,
    day: out.day,
    hour: out.hour === 24 ? 0 : out.hour,
    minute: out.minute,
    second: out.second,
  };
}

/** Décalage (ms) du fuseau à l'instant donné : heure locale − UTC. */
export function tzOffsetMs(ms: number, tz = PARIS): number {
  const p = partsAt(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Epoch ms → date/heure locales du fuseau. */
export function toLocalDateTime(ms: number, tz = PARIS): LocalDateTime {
  const p = partsAt(ms, tz);
  return { date: `${p.year}-${pad(p.month)}-${pad(p.day)}`, time: `${pad(p.hour)}:${pad(p.minute)}` };
}

function parseDate(date: string): [number, number, number] | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}
function parseTime(time: string): [number, number] | null {
  const m = /^(\d{1,2}):(\d{2})/.exec(time);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  if (h > 23 || mi > 59) return null;
  return [h, mi];
}

/** Date/heure locales du fuseau → epoch ms. Renvoie NaN si l'entrée est invalide. */
export function fromLocalDateTime(date: string, time: string, tz = PARIS): number {
  const d = parseDate(date);
  const t = parseTime(time);
  if (!d || !t) return NaN;
  const wall = Date.UTC(d[0], d[1] - 1, d[2], t[0], t[1]);
  const target = `${pad(t[0])}:${pad(t[1])}`;
  // Offsets possibles autour de cette date (avant / après un éventuel changement d'heure).
  const oBefore = tzOffsetMs(wall - 12 * 3600_000, tz);
  const oAfter = tzOffsetMs(wall + 12 * 3600_000, tz);
  const candidates = [...new Set([wall - oBefore, wall - oAfter])].filter((c) => {
    const l = toLocalDateTime(c, tz);
    return l.date === date && l.time === target;
  });
  // Heure ambiguë → première occurrence ; heure inexistante → décalée après le saut.
  if (candidates.length) return Math.min(...candidates);
  return wall - oBefore;
}

/** Jour de la semaine (0 = dimanche) d'une date 'YYYY-MM-DD'. */
export function weekdayOf(date: string): number {
  const d = parseDate(date);
  if (!d) return NaN;
  return new Date(Date.UTC(d[0], d[1] - 1, d[2])).getUTCDay();
}

/** Ajoute n jours à une date 'YYYY-MM-DD'. */
export function addDays(date: string, n: number): string {
  const d = parseDate(date);
  if (!d) return date;
  const x = new Date(Date.UTC(d[0], d[1] - 1, d[2] + n));
  return `${x.getUTCFullYear()}-${pad(x.getUTCMonth() + 1)}-${pad(x.getUTCDate())}`;
}

/** Prochaine date (aujourd'hui inclus) tombant le jour `weekday` (0 = dimanche, 6 = samedi), dans le fuseau. */
export function nextWeekdayDate(nowMs: number, weekday: number, tz = PARIS): string {
  const today = toLocalDateTime(nowMs, tz).date;
  const diff = (weekday - weekdayOf(today) + 7) % 7;
  return addDays(today, diff);
}

/** Garde l'heure locale de `ms` mais change la date. */
export function withDate(ms: number, date: string, tz = PARIS): number {
  return fromLocalDateTime(date, toLocalDateTime(ms, tz).time, tz);
}

/** Garde la date locale de `ms` mais change l'heure. */
export function withTime(ms: number, time: string, tz = PARIS): number {
  return fromLocalDateTime(toLocalDateTime(ms, tz).date, time, tz);
}

const HOUR = 3600_000;

/**
 * Décalages (heures, éventuellement fractionnaires) à passer à `computeDepartures` pour comparer
 * des départs à heures pleines autour du départ choisi : 9 h 30 → 8 h, 9 h, 10 h, 11 h.
 * Les créneaux déjà passés sont décalés vers l'avant.
 */
export function hourOffsetsAround(
  startMs: number,
  nowMs = Date.now(),
  count = 4,
): { offsets: number[]; starts: number[] } {
  const base = Math.floor(startMs / HOUR) * HOUR; // les offsets de Paris sont des heures entières
  let first = base - HOUR;
  const minStart = Math.ceil(nowMs / HOUR) * HOUR;
  if (first < minStart) first = minStart;
  const starts = Array.from({ length: count }, (_, k) => first + k * HOUR);
  const offsets = starts.map((s) => Math.round(((s - startMs) / HOUR) * 1000) / 1000);
  return { offsets, starts };
}
