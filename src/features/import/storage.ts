import { createStore, del, get, set, values, type UseStore } from 'idb-keyval';
import type { StoredRoute } from '../../types';

/*
 * idb-keyval ne gère qu'un object store par base : deux bases distinctes.
 * Création paresseuse (pas d'accès IndexedDB au chargement du module).
 */
let routesStore: UseStore | null = null;
let prefsStore: UseStore | null = null;
const routes = () => (routesStore ??= createStore('routecast', 'routes'));
const prefs = () => (prefsStore ??= createStore('routecast-prefs', 'prefs'));

export async function listStoredRoutes(): Promise<StoredRoute[]> {
  return values<StoredRoute>(routes());
}

/** Upsert par route.id. */
export async function saveStoredRoute(r: StoredRoute): Promise<void> {
  await set(r.route.id, r, routes());
}

export async function deleteStoredRoute(id: string): Promise<void> {
  await del(id, routes());
}

export async function renameStoredRoute(id: string, name: string): Promise<void> {
  const stored = await get<StoredRoute>(id, routes());
  if (!stored) return;
  await set(id, { ...stored, route: { ...stored.route, name } }, routes());
}

export async function getStoredRoute(id: string): Promise<StoredRoute | undefined> {
  return get<StoredRoute>(id, routes());
}

export async function loadPrefs<T>(key: string): Promise<T | undefined> {
  return get<T>(key, prefs());
}

export async function savePrefs<T>(key: string, value: T): Promise<void> {
  await set(key, value, prefs());
}
