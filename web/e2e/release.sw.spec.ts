// Real SW/network/cache faults on the disposable sw-server copy only.
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { unlock, ensurePin } from './helpers';

const root = process.env.FINSIGHT_E2E_SW_ROOT!;
const publicDir = path.join(root, 'public');
const source = path.resolve('public');
const sw = fs.readFileSync(path.join(source, 'sw.js'), 'utf8');
const main = fs.readFileSync(path.join(source, 'app/main.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(source, 'app/manifest.json'), 'utf8')).files as string[];
const market = manifest.find((f) => /\/MarketsIsland-[A-Z0-9]{8}\.js$/.test(f))!;
const shell = /const SHELL = '([^']+)'/.exec(sw)![1]!; // the current cache name, whatever the release calls it
const boundary = 'This panel could not load. Reload to try again.';
function restore() { fs.cpSync(source, publicDir, { recursive: true }); }
test.beforeEach(restore);
test.afterEach(restore);
async function controlled(page: Page) {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}
// Panels mount when the browser is idle (H1), so a chunk can still be on its
// way, and be cached by the SW, after the page looks ready. Damage the deploy
// only once the page has loaded everything.
async function settled(page: Page) {
  await expect(page.locator('#markets [data-sym]').first()).toBeVisible();
  await page.waitForLoadState('networkidle');
}
// Hashed chunks are served immutable (H1, server.js), so a browser that already
// fetched one keeps using its copy even after the server lost it, which is
// correct, since the URL always names the same bytes. These tests are about a
// client that does not have the chunk: clear the browser's HTTP cache too.
async function forgetHttpCache(page: Page) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.clearBrowserCache');
  await cdp.detach();
}
async function cachePaths(page: Page) {
  return page.evaluate(async (name) => (await (await caches.open(name)).keys()).map((r) => new URL(r.url).pathname), shell);
}
async function removeMarket(page: Page) {
  fs.rmSync(path.join(publicDir, market));
  await forgetHttpCache(page);
  await page.evaluate(async (url) => {
    for (const key of await caches.keys()) await (await caches.open(key)).delete(url);
  }, market);
}
function navigations(page: Page) {
  let count = 0;
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) count++; });
  return () => count;
}
async function markers(page: Page) {
  return page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith('finsight:chunk-retry:')));
}

test('old cached deploy upgrades; stale main hits a removed chunk, reloads once and recovers', async ({ page }) => {
  const oldMarket = market.replace(/-[A-Z0-9]{8}\.js$/, '-OLDHASH1.js');
  const oldMain = main.replaceAll(path.basename(market), path.basename(oldMarket));
  fs.copyFileSync(path.join(source, market), path.join(publicDir, oldMarket));
  fs.writeFileSync(path.join(publicDir, 'app/main.js'), oldMain);
  fs.writeFileSync(path.join(publicDir, 'app/manifest.json'), JSON.stringify({ files: manifest.map((f) => f === market ? oldMarket : f) }));
  fs.writeFileSync(path.join(publicDir, 'sw.js'), sw.replaceAll(shell, 'finsight-shell-h4-old'));
  await unlock(page); await controlled(page); await settled(page);
  restore(); fs.rmSync(path.join(publicDir, oldMarket)); await forgetHttpCache(page);
  // The new deploy's worker can serve the old main.js exactly once when armed,
  // as a mixed-version client might see it. This is deterministic, unlike
  // rewriting the file from a response handler, which could lose a race with
  // the guard's reload.
  fs.writeFileSync(path.join(publicDir, 'app/main-stale.js'), oldMain);
  fs.writeFileSync(path.join(publicDir, 'sw.js'), sw.replace('e.respondWith(caches.open(SHELL)',
    `if (url.pathname === '/app/main.js' && h4StaleOnce) {
      h4StaleOnce = false; e.respondWith(fetch('/app/main-stale.js', { cache: 'no-store' })); return;
    }
    e.respondWith(caches.open(SHELL)`) +
    "\nlet h4StaleOnce = false; self.addEventListener('message', (e) => { h4StaleOnce = true; e.ports[0].postMessage('armed'); });\n");
  await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
  await expect.poll(() => page.evaluate(async () => (await caches.keys()).includes('finsight-shell-h4-old'))).toBe(false);
  await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state)).toBe('activated');
  // One stale entry response after deployment. The removed hashed URL is
  // absent from both the new cache and disk.
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? '')).toContain('/sw.js');
  await page.evaluate(() => new Promise<void>((resolve) => {
    const channel = new MessageChannel(); channel.port1.onmessage = () => resolve();
    navigator.serviceWorker.controller!.postMessage('stale-once', [channel.port2]);
  }));
  const count = navigations(page);
  await page.reload();
  await expect.poll(count).toBe(2);
  await expect(page.locator('#markets [data-sym]').first()).toBeVisible();
  await page.waitForTimeout(700); expect(count()).toBe(2);
  expect(await cachePaths(page)).not.toContain(oldMarket);
});

test('same-build transient failure: the panel retry recovers without a reload, leaving no marker', async ({ page }) => {
  // Inject exactly one real 404 inside the disposable worker. A browser event
  // listener restoring a deleted file can lose a race with the guard's reload.
  fs.writeFileSync(path.join(publicDir, 'sw.js'), sw.replace('e.respondWith(caches.open(SHELL)',
    `if (url.pathname === ${JSON.stringify(market)} && h4FailOnce) {
      h4FailOnce = false; e.respondWith(Promise.resolve(new Response('missing', { status: 404 }))); return;
    }
    e.respondWith(caches.open(SHELL)`) +
    "\nlet h4FailOnce = false; self.addEventListener('message', (e) => { h4FailOnce = true; e.ports[0].postMessage('armed'); });\n");
  await unlock(page); await controlled(page);
  await page.evaluate(() => new Promise<void>((resolve) => {
    const channel = new MessageChannel(); channel.port1.onmessage = () => resolve();
    navigator.serviceWorker.controller!.postMessage('fail-once', [channel.port2]);
  }));
  const count = navigations(page);
  await page.reload();
  // Since H1 a host loads its chunk before mounting and the mounted island
  // imports it again (App.tsx, islands.ts), so a single failed request is
  // retried in place; a chunk that stays missing still reloads once (next test).
  await expect(page.locator('#markets [data-sym]').first()).toBeVisible();
  await page.waitForTimeout(700); expect(count()).toBe(1);
  expect(await markers(page)).toEqual([]);
});

test('permanently missing chunk reloads once; later boots retain the boundary and fuse', async ({ page }) => {
  await unlock(page); await controlled(page); await settled(page); await removeMarket(page);
  const count = navigations(page);
  await page.reload();
  await expect(page.getByText(boundary, { exact: true })).toBeVisible();
  await expect.poll(count).toBe(2);
  expect(await markers(page)).toHaveLength(1);
  await page.waitForTimeout(800); expect(count()).toBe(2);
  await page.reload();
  await expect(page.getByText(boundary, { exact: true })).toBeVisible();
  await page.waitForTimeout(800); expect(count()).toBe(3);
  expect(await markers(page)).toHaveLength(1);
});

for (const mode of ['online', 'offline', 'invalid'] as const) {
  test(`activation prune: ${mode} manifest`, async ({ page, context }) => {
    fs.writeFileSync(path.join(publicDir, 'sw.js'), sw.replaceAll(shell, 'finsight-shell-h4-before-prune'));
    await unlock(page); await controlled(page);
    // Hold the next worker waiting after install (production activate unchanged)
    // so faults and stale entries exist exactly at activation time.
    fs.writeFileSync(path.join(publicDir, 'sw.js'), sw.replace('.then(() => self.skipWaiting())', '.then(() => {})') +
      "\nself.addEventListener('message', () => self.skipWaiting());\n");
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting?.state)).toBe('installed');
    await page.evaluate(async (name) => {
      const c = await caches.open(name);
      for (const url of ['/app/chunks/obsolete-ABCDEFGH.js', '/app.js', '/app/obsolete.js']) await c.put(url, new Response('old'));
    }, shell);
    if (mode === 'invalid') fs.writeFileSync(path.join(publicDir, 'app/manifest.json'), '{"files":[]}');
    if (mode === 'offline') await context.setOffline(true);
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.waiting!.postMessage('activate'));
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).includes('finsight-shell-h4-before-prune'))).toBe(false);
    // clients.claim runs after pruning, unlike cache deletion at activate start.
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state)).toBe('activated');
    const cached = await cachePaths(page);
    for (const url of ['/app.js', '/chart.js', '/app/manifest.json', ...manifest]) expect(cached).toContain(url);
    for (const url of ['/app/chunks/obsolete-ABCDEFGH.js', '/app/obsolete.js']) {
      if (mode === 'online') expect(cached).not.toContain(url); else expect(cached).toContain(url);
    }
    await context.setOffline(false);
  });
}

test('offline cold document boots cached shell and lock UI; API/auth data never cached', async ({ page, context }) => {
  await unlock(page); await controlled(page);
  await context.setOffline(true);
  await page.goto('/'); // fresh document, not a warm in-document navigation
  await expect(page.locator('.brand')).toContainText('FINSIGHT');
  await expect(page.locator('#lock-title')).toContainText("Can't reach the FinSight server");
  await expect(page.locator('body')).toHaveClass(/locked/);
  expect((await cachePaths(page)).filter((p) => p.startsWith('/api/'))).toEqual([]);
  await context.setOffline(false);
});

test('typed PIN and chat draft suppress automatic reload and retain the existing boundary', async ({ page }) => {
  await ensurePin(page.request); await page.context().clearCookies(); await page.goto('/'); await controlled(page);
  await page.locator('#lock-pin').fill('24');
  const count = navigations(page);
  async function failIsland(id: string) {
    await page.evaluate(async (id) => {
      // A new lazy host isolates a late import failure after the user typed.
      const entry = '/app/main.js';
      const { mountIslands } = await import(entry);
      const host = document.createElement('div'); host.dataset.island = id; document.body.append(host);
      mountIslands({ [id]: new Function('return import("/app/chunks/h4-missing-ABCDEFGH.js")') }, host);
    }, id);
  }
  await failIsland('pin-failure');
  await expect(page.getByText(boundary, { exact: true })).toHaveCount(1);
  await expect(page.locator('#lock-pin')).toHaveValue('24'); expect(count()).toBe(0);
  await page.locator('#lock-pin').fill('2468'); await page.locator('#lock-go').click();
  await expect(page.locator('body')).not.toHaveClass(/locked/);
  // The real composer may be closed; a textarea draft exercises the same DOM
  // protection without changing the user's saved panel configuration.
  await page.evaluate(() => { const input = document.createElement('textarea'); input.id = 'h4-chat-draft'; input.value = 'unsent chat'; document.body.append(input); });
  await failIsland('chat-failure');
  await expect(page.getByText(boundary, { exact: true })).toHaveCount(2);
  await expect(page.locator('#h4-chat-draft')).toHaveValue('unsent chat');
  expect(count()).toBe(0); expect(await markers(page)).toEqual([]);
});
