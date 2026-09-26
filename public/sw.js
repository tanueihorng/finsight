/* FinSight service worker — makes the terminal installable and opens the UI
   shell instantly. Only static files are cached. API responses (your portfolio)
   are never stored in the browser: they stay behind the PIN on the server. */
'use strict';
const SHELL = 'finsight-shell-v1';
const FILES = ['/', '/index.html', '/styles.css', '/app.js', '/chart.js', '/icon.png', '/icon-192.png', '/manifest.webmanifest'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== SHELL).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
// Static files: serve from cache at once, refresh it in the background
// (so an update shows on the next load). /api/* always goes to the network.
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/')) return;
  e.respondWith(caches.open(SHELL).then(async (cache) => {
    const hit = await cache.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((res) => { if (res.ok) cache.put(e.request, res.clone()); return res; });
    if (hit) { net.catch(() => {}); return hit; }
    return net;
  }));
});
