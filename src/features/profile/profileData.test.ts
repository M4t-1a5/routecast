import { describe, expect, it } from 'vitest';
import { elevationRange, gradeRuns, overlayRange, overlaySeries } from './profileData';
import type { PointWeather } from '../../types';

describe('profileData', () => {
  it('regroupe les pentes de même couleur', () => {
    const runs = gradeRuns([1, 2, 4, 5, 10, 1, 1].map((grade) => ({ grade })));
    expect(runs.map((r) => [r.start, r.end])).toEqual([
      [0, 2],
      [2, 4],
      [4, 5],
      [5, 6],
    ]);
    expect(runs[0].color).toBe('#22c55e');
    expect(runs[2].color).toBe('#ef4444');
    expect(gradeRuns([{ grade: 0 }])).toEqual([]);
  });

  it('séries et plages de superposition', () => {
    const w = [
      { headwind: 12, temperature: 8, precipitation: 0 },
      { headwind: -20, temperature: 14, precipitation: 1.5 },
    ] as PointWeather[];
    expect(overlaySeries('none', 2, w)).toBeNull();
    expect(overlaySeries('wind', 3, w)).toEqual([-12, 20, null]);
    expect(overlayRange('wind', [-12, 20])).toEqual([-20, 20]);
    expect(overlayRange('rain', [0, 1.5])).toEqual([0, 2]);
    expect(overlayRange('temperature', [8, 14])).toEqual([6, 16]);
    expect(overlayRange('temperature', [null])).toEqual([0, 1]);
  });

  it('plage altitude', () => {
    const [a, b] = elevationRange(50, 60);
    expect(a).toBeLessThan(50);
    expect(b).toBeGreaterThan(60);
  });
});
