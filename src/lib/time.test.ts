import { describe, expect, it } from 'vitest';
import {
  addDays,
  fromLocalDateTime,
  hourOffsetsAround,
  nextWeekdayDate,
  toLocalDateTime,
  weekdayOf,
  withTime,
} from './time';

describe('time (Europe/Paris)', () => {
  it('epoch → local en hiver (UTC+1) et en été (UTC+2)', () => {
    expect(toLocalDateTime(Date.UTC(2026, 0, 15, 8, 30))).toEqual({ date: '2026-01-15', time: '09:30' });
    expect(toLocalDateTime(Date.UTC(2026, 6, 15, 7, 5))).toEqual({ date: '2026-07-15', time: '09:05' });
    expect(toLocalDateTime(Date.UTC(2026, 11, 31, 23, 30))).toEqual({ date: '2027-01-01', time: '00:30' });
  });

  it('local → epoch, aller-retour', () => {
    expect(fromLocalDateTime('2026-01-15', '09:30')).toBe(Date.UTC(2026, 0, 15, 8, 30));
    expect(fromLocalDateTime('2026-07-15', '09:05')).toBe(Date.UTC(2026, 6, 15, 7, 5));
    for (let h = 0; h < 24 * 400; h += 7) {
      const ms = Date.UTC(2026, 0, 1) + h * 3600_000;
      const l = toLocalDateTime(ms);
      expect(fromLocalDateTime(l.date, l.time)).toBe(ms);
    }
  });

  it("changements d'heure", () => {
    // 29 mars 2026 : 02:00 → 03:00 (02:30 n'existe pas)
    const gap = fromLocalDateTime('2026-03-29', '02:30');
    expect(Number.isFinite(gap)).toBe(true);
    expect(toLocalDateTime(gap).date).toBe('2026-03-29');
    expect(fromLocalDateTime('2026-03-29', '03:00')).toBe(Date.UTC(2026, 2, 29, 1, 0));
    // 25 octobre 2026 : 03:00 → 02:00 (02:30 ambiguë → première occurrence, UTC+2)
    expect(fromLocalDateTime('2026-10-25', '02:30')).toBe(Date.UTC(2026, 9, 25, 0, 30));
    expect(fromLocalDateTime('2026-10-25', '04:00')).toBe(Date.UTC(2026, 9, 25, 3, 0));
  });

  it('entrées invalides', () => {
    expect(fromLocalDateTime('', '09:00')).toBeNaN();
    expect(fromLocalDateTime('2026-01-01', '25:00')).toBeNaN();
  });

  it('jours de la semaine et raccourcis', () => {
    expect(weekdayOf('2026-11-14')).toBe(6); // samedi
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    const satNoon = Date.UTC(2026, 10, 14, 11);
    expect(nextWeekdayDate(satNoon, 6)).toBe('2026-11-14');
    expect(nextWeekdayDate(satNoon, 0)).toBe('2026-11-15');
    expect(nextWeekdayDate(Date.UTC(2026, 10, 16, 11), 6)).toBe('2026-11-21');
    expect(toLocalDateTime(withTime(Date.UTC(2026, 10, 14, 8), '07:15')).time).toBe('07:15');
  });

  it('offsets de comparaison à heures pleines', () => {
    const now = Date.UTC(2026, 10, 1);
    const start = fromLocalDateTime('2026-11-15', '09:00');
    expect(hourOffsetsAround(start, now).offsets).toEqual([-1, 0, 1, 2]);
    const s2 = fromLocalDateTime('2026-11-15', '09:30');
    const r = hourOffsetsAround(s2, now);
    expect(r.offsets).toEqual([-1.5, -0.5, 0.5, 1.5]);
    expect(r.starts.map((s) => toLocalDateTime(s).time)).toEqual(['08:00', '09:00', '10:00', '11:00']);
    // créneaux passés → décalés
    const r3 = hourOffsetsAround(start, fromLocalDateTime('2026-11-15', '08:20'));
    expect(r3.starts.map((s) => toLocalDateTime(s).time)).toEqual(['09:00', '10:00', '11:00', '12:00']);
  });
});
