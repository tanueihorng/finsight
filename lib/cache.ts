// Cache for upstream data (Yahoo, FRED, World Bank, ...).
//
// `cached(key, ttl, fn, { stale, persist })`:
//   - fresh (younger than ttl)          -> served from memory
//   - stale (within ttl + stale)        -> served immediately, refreshed in the background
//   - older / missing                   -> fetched; if that fails, the last good value
//                                          (however old) is served instead of an error
//   - concurrent callers share one in-flight fetch
//   - persist: true also saves the entry to data/cache.json, so a restart (or
//     Yahoo being down) doesn't mean a cold, empty terminal.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.ts';

export interface CacheOptions { stale?: number; persist?: boolean }
interface Entry { at: number; ttl: number; keep: number; value: unknown; persist: boolean }

const CACHE_FILE = path.join(DATA_DIR, 'cache.json');
const PERSIST = process.env.FINSIGHT_CACHE_PERSIST !== '0';
const PERSIST_MAX_AGE = 30 * 24 * 60 * 60000; // drop persisted entries older than 30 days

export const cache = new Map<string, Entry>(); // key -> { at, ttl, keep, value, persist }
const inflight = new Map<string, Promise<unknown>>(); // key -> Promise

// Callers pick T per key; values of one key always come from one producer.
export function cacheGet<T>(key: string): T | null {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value as T;
  return null;
}
export function cacheSet<T>(key: string, value: T, ttl: number, { stale = 0, persist = false }: CacheOptions = {}): T {
  cache.set(key, { at: Date.now(), ttl, keep: ttl + stale, value, persist });
  if (persist) schedulePersist();
  return value;
}

function refresh<T>(key: string, ttl: number, fn: () => T | Promise<T>, opts: CacheOptions): Promise<T> {
  const running = inflight.get(key);
  if (running) return running as Promise<T>;
  const p = Promise.resolve()
    .then(fn)
    .then((v) => cacheSet(key, v, ttl, opts))
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function cached<T>(key: string, ttl: number, fn: () => T | Promise<T>, opts: CacheOptions = {}): Promise<T> {
  const hit = cache.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (hit && age < ttl) return hit.value as T;
  if (hit && age < ttl + (opts.stale || 0)) {
    refresh(key, ttl, fn, opts).catch(() => {}); // background revalidate
    return hit.value as T;
  }
  try {
    return await refresh(key, ttl, fn, opts);
  } catch (e) {
    if (hit) return hit.value as T; // upstream down / rate-limited: last good value beats an error
    throw e;
  }
}

// ---- persistence ------------------------------------------------------------
let persistTimer: NodeJS.Timeout | null = null;
function schedulePersist() {
  if (!PERSIST || persistTimer) return;
  persistTimer = setTimeout(() => { persistTimer = null; persistNow(); }, 5000);
  persistTimer.unref();
}
export function persistNow(): void {
  if (!PERSIST) return;
  try {
    const out: Record<string, Omit<Entry, 'persist'>> = {};
    for (const [k, v] of cache) if (v.persist) out[k] = { at: v.at, ttl: v.ttl, keep: v.keep, value: v.value };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = CACHE_FILE + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, CACHE_FILE);
  } catch {}
}
function loadPersisted() {
  if (!PERSIST) return;
  let raw: Record<string, Partial<Entry> | null> | null;
  try { raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return; }
  const now = Date.now();
  for (const [k, v] of Object.entries(raw || {})) {
    if (v && typeof v.at === 'number' && Number.isFinite(v.at) && now - v.at < PERSIST_MAX_AGE) {
      // Keep it around as a stale fallback for at least the persistence window.
      cache.set(k, { at: v.at, ttl: v.ttl!, keep: Math.max(v.keep || 0, PERSIST_MAX_AGE), value: v.value, persist: true });
    }
  }
}
loadPersisted();

// Sweep dead entries hourly — the LaunchAgent process runs for months.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at >= (v.keep ?? v.ttl)) cache.delete(k);
}, 60 * 60 * 1000).unref();
