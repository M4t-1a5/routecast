/*
 * Fuseaux horaires sans bibliothèque : décalage obtenu via Intl.DateTimeFormat
 * (gère les changements d'heure).
 */

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
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
    formatters.set(tz, f);
  }
  return f;
}

/** Composantes de date/heure locales d'un instant dans un fuseau. */
export function zonedParts(ms: number, tz: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of formatter(tz).formatToParts(new Date(ms))) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour) % 24,
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday] ?? 0,
  };
}

/** Décalage (ms) heure locale − UTC à l'instant donné. */
export function tzOffsetMs(ms: number, tz: string): number {
  const p = zonedParts(ms, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(ms / 1000) * 1000;
}

/** Instant UTC correspondant à une heure locale « murale » dans un fuseau. */
export function zonedToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  tz: string,
): number {
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  let guess = wall - tzOffsetMs(wall, tz);
  // Seconde passe : le décalage peut différer autour d'un changement d'heure.
  guess = wall - tzOffsetMs(guess, tz);
  return guess;
}

/** Prochain dimanche 9h (heure locale du fuseau) ; aujourd'hui 9 h si on est dimanche avant 8 h. */
export function defaultStartTime(now: Date = new Date(), timezone = 'Europe/Paris'): number {
  let tz = timezone;
  try {
    formatter(tz);
  } catch {
    tz = 'Europe/Paris';
  }
  const p = zonedParts(now.getTime(), tz);
  const days = p.weekday === 0 && p.hour < 8 ? 0 : 7 - p.weekday;
  // Normalisation calendaire via Date.UTC (gère fins de mois / d'année).
  const target = new Date(Date.UTC(p.year, p.month - 1, p.day + days));
  return zonedToUtc(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(), 9, 0, tz);
}
