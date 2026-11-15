/**
 * Cache météo à deux niveaux : mémoire (Map bornée) + IndexedDB (idb-keyval, base dédiée).
 * Clé = espace (endpoint + variables + modèles) | lat | lon (arrondis 0,01°) | jour UTC.
 * Tolérant : si IndexedDB est indisponible (Node, navigation privée…), seul le cache mémoire sert.
 */
import { createStore, del, entries, get, set, type UseStore } from 'idb-keyval';

/** Bloc horaire brut (un lieu, un jour UTC). `time` en epoch ms. */
export interface HourlyBlock {
  time: number[];
  data: Record<string, (number | null)[]>;
}

export interface CacheEntry extends HourlyBlock {
  fetchedAt: number;
}

const MEMORY_MAX = 3000;
const memory = new Map<string, CacheEntry>();

let store: UseStore | null | undefined;
let cleaned = false;

function getStore(): UseStore | null {
  if (store !== undefined) return store;
  try {
    store = typeof indexedDB !== 'undefined' ? createStore('routecast-weather', 'cache') : null;
  } catch {
    store = null;
  }
  return store;
}

export const roundCoord = (x: number) => Math.round(x * 100) / 100;

export function cacheKey(ns: string, lat: number, lon: number, day: string): string {
  return `${ns}|${roundCoord(lat).toFixed(2)}|${roundCoord(lon).toFixed(2)}|${day}`;
}

function remember(key: string, entry: CacheEntry) {
  if (memory.has(key)) memory.delete(key);
  memory.set(key, entry);
  while (memory.size > MEMORY_MAX) {
    const oldest = memory.keys().next().value;
    if (oldest === undefined) break;
    memory.delete(oldest);
  }
}

/** Lecture (mémoire puis IndexedDB). Renvoie null si absent ou périmé. */
export async function cacheGet(key: string, ttlMs: number, now = Date.now()): Promise<CacheEntry | null> {
  const m = memory.get(key);
  if (m && now - m.fetchedAt < ttlMs) return m;
  const s = getStore();
  if (!s) return null;
  try {
    const v = (await get<CacheEntry>(key, s)) ?? null;
    if (v && now - v.fetchedAt < ttlMs) {
      remember(key, v);
      return v;
    }
  } catch {
    /* IndexedDB indisponible : ignore */
  }
  return null;
}

export async function cacheSet(key: string, entry: CacheEntry): Promise<void> {
  remember(key, entry);
  const s = getStore();
  if (!s) return;
  try {
    await set(key, entry, s);
  } catch {
    /* quota / navigation privée : ignore */
  }
  if (!cleaned) {
    cleaned = true;
    void purgeOld(s);
  }
}

/** Supprime les entrées vieilles de plus de 2 jours (une fois par session). */
async function purgeOld(s: UseStore) {
  try {
    const limit = Date.now() - 2 * 86_400_000;
    for (const [k, v] of await entries<string, CacheEntry>(s)) {
      if (!v || v.fetchedAt < limit) await del(k, s);
    }
  } catch {
    /* ignore */
  }
}

/** Vide le cache mémoire (tests / débogage). */
export function clearMemoryCache() {
  memory.clear();
}

/** Force l'usage (ou non) d'IndexedDB — pour les tests. */
export function __setStoreForTests(s: UseStore | null | undefined) {
  store = s;
}
