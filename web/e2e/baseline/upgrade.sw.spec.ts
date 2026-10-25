// Service worker on a temp copy of the app (web/e2e/sw-server.mjs): it
// precaches the shell + build manifest, serves updates network-first, and
// opens the shell offline.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { unlock } from '../helpers';

const ROOT = process.env.FINSIGHT_E2E_SW_ROOT!;

test('precache, update on reload, offline shell', async ({ page, context }) => {
  await unlock(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

  const cached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const c = await caches.open(keys.find((k) => k.startsWith('finsight-shell-'))!);
    return (await c.keys()).map((r) => new URL(r.url).pathname);
  });
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/app/manifest.json'), 'utf8')).files as string[];
  // /app.js was deleted in X1; /chart.js is a retained classic script.
  for (const f of ['/', '/chart.js', '/styles.css', ...manifest]) expect(cached).toContain(f);

  // "Deploy" a change to the copy: the next load gets it (network first).
  fs.appendFileSync(path.join(ROOT, 'public/styles.css'), '\n/* e2e-upgrade-marker */\n');
  await page.reload();
  expect(await page.evaluate(() => fetch('/styles.css').then((r) => r.text()))).toContain('e2e-upgrade-marker');

  // Offline: the shell still opens from the cache.
  await context.setOffline(true);
  await page.reload();
  await expect(page.locator('.brand')).toContainText('FINSIGHT');
  await context.setOffline(false);
});

test('a deleted hashed chunk is served from cache; a deleted main.js is not; /api is never cached', async ({ page }) => {
  await unlock(page);
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/app/manifest.json'), 'utf8')).files as string[];
  const chunk = manifest.find((f) => /^\/app\/chunks\/MarketsIsland-[A-Z0-9]{8}\.js$/.test(f))!;

  // Damaged deploy: the chunk file is gone from the server, but the SW cached
  // it at install. The hashed URL is immutable, so the cached copy is exactly
  // what this page's manifest asked for — the island still renders.
  fs.rmSync(path.join(ROOT, 'public', chunk));
  await page.reload();
  await expect(page.locator('#markets [data-sym]').first()).toBeVisible();

  // A missing unhashed entry file must NOT come back stale from the cache: a
  // cached main.js could reference chunks that no longer exist. The page gets
  // the 404 and the index.html startup fallback appears instead.
  fs.rmSync(path.join(ROOT, 'public/app/main.js'));
  await page.reload();
  await expect(page.locator('#boot-fallback')).toBeVisible({ timeout: 9000 });

  // API and auth responses are never stored in the SW cache.
  const apiCached = await page.evaluate(async () => {
    const keys = await caches.keys();
    const c = await caches.open(keys.find((k) => k.startsWith('finsight-shell-'))!);
    const hits = await Promise.all(['/api/portfolio', '/api/auth/status', '/api/accounts'].map((p) => c.match(p)));
    return hits.filter(Boolean).length;
  });
  expect(apiCached).toBe(0);
});
