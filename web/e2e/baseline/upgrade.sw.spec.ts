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
