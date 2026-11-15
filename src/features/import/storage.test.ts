import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import type { Route, StoredRoute } from '../../types';
import {
  deleteStoredRoute,
  getStoredRoute,
  listStoredRoutes,
  loadPrefs,
  renameStoredRoute,
  saveStoredRoute,
  savePrefs,
} from './index';

const route = (id: string, name: string): Route => ({
  id,
  name,
  source: 'gpx',
  sport: 'cycling',
  createdAt: 1,
  points: [],
  stats: { distance: 0, ascent: 0, descent: 0, minEle: 0, maxEle: 0 },
  climbs: [],
  hasRecordedTime: false,
});
const stored = (id: string, name: string, lastOpenedAt = 1): StoredRoute => ({
  route: route(id, name),
  lastOpenedAt,
});

describe('historique IndexedDB', () => {
  it('upsert, liste, renomme, supprime', async () => {
    await saveStoredRoute(stored('a', 'A'));
    await saveStoredRoute(stored('b', 'B'));
    await saveStoredRoute(stored('a', 'A', 5)); // upsert
    let list = await listStoredRoutes();
    expect(list).toHaveLength(2);
    expect(list.find((r) => r.route.id === 'a')?.lastOpenedAt).toBe(5);

    await renameStoredRoute('a', 'Nouveau nom');
    expect((await getStoredRoute('a'))?.route.name).toBe('Nouveau nom');
    await renameStoredRoute('inconnu', 'x'); // sans effet

    await deleteStoredRoute('b');
    list = await listStoredRoutes();
    expect(list.map((r) => r.route.id)).toEqual(['a']);
    expect(await getStoredRoute('b')).toBeUndefined();
  });

  it('préférences dans une base séparée', async () => {
    expect(await loadPrefs('theme')).toBeUndefined();
    await savePrefs('theme', 'dark');
    await savePrefs('model', { kind: 'fixed', speedKmh: 27 });
    expect(await loadPrefs<string>('theme')).toBe('dark');
    expect(await loadPrefs('model')).toEqual({ kind: 'fixed', speedKmh: 27 });
    expect((await listStoredRoutes()).some((r) => (r as unknown) === 'dark')).toBe(false);
  });
});
