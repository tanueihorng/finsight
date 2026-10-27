/* FinSight service worker — makes the terminal installable and opens the UI
   shell instantly. Only static files are cached. API responses (your portfolio)
   are never stored in the browser: they stay behind the PIN on the server. */
'use strict';
const SHELL = 'finsight-shell-v53'; // v53: source-bound in-chat charts; v52: reproducible canonical/worktree bundle; v51: integrated feature bundle and modal focus repair; v50: app dialogs above Kestrel and charts (styles.css); v49: reserve chat-row delete space beside date; v48: chat deletion and trade sheet flows; v47: thinking pill menu replaces the slider (agent-panel.css); v46: thinking effort slider merged with the start screen (agent-panel.css); v45: Kestrel start screen (briefing, colour-coded questions, jump list); v44: qualified OpenAI views and clearer table guidance; v43: Kestrel Markdown and qualified view discovery; v42: trade sheet row actions (styles.css); v41: verified Kestrel stat/table snapshots; v40: Kestrel answer font (bundled Source Serif 4); v39: opening-bell landing on the PIN screen (styles.css); v38: Kestrel panel redesign (new agent-panel.css); v37: activity keyboard access from first render; v36: Phase 6 S1 (offline and start-up guidance names server.ts); v35: Phase 5 (H1 startup and bundling, H3 accessibility, H4 cache pruning)
const FILES = ['/', '/index.html', '/styles.css', '/chart.js', '/chartgrid.js', '/strategy.js', '/strategies.js', '/indicators.js', '/journal.js', '/agent-panel.css', '/fonts/source-serif-4/SourceSerif4Variable-Roman.ttf.woff2', '/fonts/source-serif-4/SourceSerif4Variable-Italic.ttf.woff2', '/app/manifest.json', '/icon.png', '/icon-192.png', '/manifest.webmanifest'];
// Content-hashed chunk URLs (esbuild 8-char hash): immutable, so a cached copy
// is exactly the bytes the loaded manifest asked for.
const HASHED_CHUNK = /^\/app\/chunks\/.+-[A-Z0-9]{8}\.(js|css)$/;

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
    .then(async () => {
      // Fetch the deploy's manifest, never a stale SW/cache response. Offline or
      // malformed manifests must not delete working assets or block activation.
      try {
        const response = await fetch('/app/manifest.json', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
        if (!response.ok) return;
        const manifest = await response.json();
        if (!Array.isArray(manifest.files) || !manifest.files.length ||
            !manifest.files.every((f) => typeof f === 'string' && f.startsWith('/app/'))) return;
        const keep = new Set([...manifest.files, '/app/manifest.json'].map((f) => new URL(f, location.origin).href));
        const cache = await caches.open(SHELL);
        await Promise.all((await cache.keys()).filter((r) => {
          const url = new URL(r.url);
          return url.origin === location.origin && url.pathname.startsWith('/app/') && !keep.has(url.href);
        }).map((r) => cache.delete(r)));
      } catch { /* offline activation keeps the precached shell intact */ }
    })
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
      if (res.ok) { cache.put(e.request, res.clone()); return res; }
      // A damaged/partial deploy (404/500) may serve a hashed chunk from the
      // cache — never an unhashed file (html, manifest, main.js, classic
      // scripts), whose stale copy could mismatch the loaded page.
      if (HASHED_CHUNK.test(url.pathname)) {
        const hit = await cache.match(e.request);
        if (hit) return hit;
      }
      return res;
    } catch (err) {
      const hit = await cache.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      throw err;
    }
  }));
});
