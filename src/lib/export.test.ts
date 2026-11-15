import { describe, expect, it } from 'vitest';
import { exportFileName, slugify } from './export';

describe('export', () => {
  it('slugify', () => {
    expect(slugify('Boucle Houilles – Vallée de Chevreuse')).toBe('boucle-houilles-vallee-de-chevreuse');
    expect(slugify('***')).toBe('trace');
  });
  it('nom de fichier daté (Europe/Paris)', () => {
    expect(exportFileName('Ma sortie', Date.UTC(2026, 10, 14, 23, 30))).toBe(
      'routecast-ma-sortie-2026-11-15.png',
    );
  });
});
