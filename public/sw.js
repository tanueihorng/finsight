/* FinSight service worker — makes the terminal installable and opens the UI
   shell instantly. Only static files are cached. API responses (your portfolio)
   are never stored in the browser: they stay behind the PIN on the server. */
'use strict';
const SHELL = 'finsight-shell-v23';
const FILES = ['/', '/index.html', '/styles.css', '/app.js', '/chart.js', '/chartgrid.js', '/strategy.js', '/strategies.js', '/indicators.js', '/journal.js', '/agent-panel.js', '/agent-panel.css', '/app/manifest.json', '/icon.png', '/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  // Island files (bootstrap, main.js/css, lazy chunks) come from the build manifest.
  const islandFiles = () => fetch('/app/manifest.json', { cache: 'no-cache' }).then((r) => r.json()).then((m) => m.files);
  e.waitUntil(caches.open(SHELL)
    .then(async (c) => c.addAll([...FILES, ...(await islandFiles())]))
    .then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Static files: network first (the server is local, so this is instant) so an
// update always shows on the next load; the cache is only the offline fallback.
// /api/* always goes to the network and is never cached.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(caches.open(SHELL).then(async (cache) => {
    try {
      const res = await fetch(e.request, { cache: 'no-cache' });
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch (err) {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  }));
});
