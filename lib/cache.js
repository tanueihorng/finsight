'use strict';
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
const fs = require('fs');
const path = require('path');
const { DATA_DIR } = require('./config');

const CACHE_FILE = path.join(DATA_DIR, 'cache.json');
const PERSIST = process.env.FINSIGHT_CACHE_PERSIST !== '0';
const PERSIST_MAX_AGE = 30 * 24 * 60 * 60000; // drop persisted entries older than 30 days

const cache = new Map(); // key -> { at, ttl, keep, value, persist }
const inflight = new Map(); // key -> Promise

function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  return null;
}
function cacheSet(key, value, ttl, { stale = 0, persist = false } = {}) {
  cache.set(key, { at: Date.now(), ttl, keep: ttl + stale, value, persist });
  if (persist) schedulePersist();
  return value;
}

function refresh(key, ttl, fn, opts) {
  if (inflight.has(key)) return inflight.get(key);
  const p = Promise.resolve()
    .then(fn)
    .then((v) => cacheSet(key, v, ttl, opts))
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

async function cached(key, ttl, fn, opts = {}) {
  const hit = cache.get(key);
  const age = hit ? Date.now() - hit.at : Infinity;
  if (age < ttl) return hit.value;
  if (hit && age < ttl + (opts.stale || 0)) {
    refresh(key, ttl, fn, opts).catch(() => {}); // background revalidate
    return hit.value;
  }
  try {
    return await refresh(key, ttl, fn, opts);
  } catch (e) {
    if (hit) return hit.value; // upstream down / rate-limited: last good value beats an error
    throw e;
  }
}

// ---- persistence ------------------------------------------------------------
let persistTimer = null;
function schedulePersist() {
  if (!PERSIST || persistTimer) return;
  persistTimer = setTimeout(() => { persistTimer = null; persistNow(); }, 5000);
  persistTimer.unref();
}
function persistNow() {
  if (!PERSIST) return;
  try {
    const out = {};
    for (const [k, v] of cache) if (v.persist) out[k] = { at: v.at, ttl: v.ttl, keep: v.keep, value: v.value };
    fs.mkdirSync(DATA_DIR, { recursive: true });
    const tmp = CACHE_FILE + '.tmp.' + process.pid;
    fs.writeFileSync(tmp, JSON.stringify(out));
    fs.renameSync(tmp, CACHE_FILE);
  } catch {}
}
function loadPersisted() {
  if (!PERSIST) return;
  let raw;
  try { raw = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8')); } catch { return; }
  const now = Date.now();
  for (const [k, v] of Object.entries(raw || {})) {
    if (v && Number.isFinite(v.at) && now - v.at < PERSIST_MAX_AGE) {
      // Keep it around as a stale fallback for at least the persistence window.
      cache.set(k, { at: v.at, ttl: v.ttl, keep: Math.max(v.keep || 0, PERSIST_MAX_AGE), value: v.value, persist: true });
    }
  }
}
loadPersisted();

// Sweep dead entries hourly — the LaunchAgent process runs for months.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at >= (v.keep ?? v.ttl)) cache.delete(k);
}, 60 * 60 * 1000).unref();

module.exports = { cache, cacheGet, cacheSet, cached, persistNow };
