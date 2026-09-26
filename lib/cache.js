'use strict';
// --------------------------------------------------------------------------
// Tiny in-memory cache so we don't hammer the upstream APIs while polling.
// --------------------------------------------------------------------------
const cache = new Map(); // key -> { at, ttl, value }
function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  return null;
}
function cacheSet(key, value, ttl) {
  cache.set(key, { at: Date.now(), ttl, value });
  return value;
}

// Sweep expired entries hourly — the LaunchAgent process runs for months.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of cache) if (now - v.at >= v.ttl) cache.delete(k);
}, 60 * 60 * 1000).unref();

module.exports = { cache, cacheGet, cacheSet };
