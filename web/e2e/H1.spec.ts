// H1 (performance budget): the startup changes behind it. index.html starts the
// session, accounts and first portfolio requests itself (web/src/api/early.ts);
// panels mount when their chunk is in, positions first; the classic chart
// scripts load when the browser is idle; hashed chunks are cached for good.
import { test, expect, type Page } from '@playwright/test';
import { ensurePin, seeded } from './helpers';

// Portfolio requests by query string, and whether index.html's startup script
// (not the app) sent each one.
async function portfolioRequests(page: Page) {
  await page.waitForLoadState('networkidle'); // the previous page's panels have all loaded
  const seen: { search: string; startup: boolean }[] = [];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent', (e) => {
    const url = new URL(e.request.url);
    if (url.pathname !== '/api/portfolio') return;
    const top = e.initiator.stack?.callFrames[0]?.url ?? '';
    seen.push({ search: url.search, startup: top !== '' && new URL(top).pathname === '/' });
  });
  return seen;
}
// Startup sends two: the one the positions table shows (index.html's) and the
// net-worth panel's own per-account request (useWealth), as before H1.
const startup = (search: string) => [{ search, startup: true }, { search, startup: false }];

test('hashed chunks are cached for good; pages, entry files and the API are not', async ({ page }) => {
  await seeded(page);
  const { files } = await (await page.request.get('/app/manifest.json')).json() as { files: string[] };
  const chunk = files.find((f) => /^\/app\/chunks\/.+-[A-Z0-9]{8}\.js$/.test(f))!;
  expect((await page.request.get(chunk)).headers()['cache-control']).toBe('public, max-age=31536000, immutable');
  for (const f of ['/', '/index.html', '/app/main.js', '/app/bootstrap.js', '/app/manifest.json', '/chart.js', '/sw.js']) {
    expect((await page.request.get(f)).headers()['cache-control'], f).toBe('no-cache');
  }
  expect((await page.request.get('/api/portfolio?base=SGD&account=main')).headers()['cache-control']).toBe('no-store');
});

test('a locked page asks only for the session status', async ({ page, context }) => {
  await ensurePin(page.request);
  await context.clearCookies();
  const api: string[] = [];
  page.on('request', (r) => { const p = new URL(r.url()).pathname; if (p.startsWith('/api/')) api.push(p); });
  await page.goto('/');
  await expect(page.locator('body')).toHaveClass(/\blocked\b/);
  await expect(page.locator('#lock-pin')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(api.filter((p) => !p.startsWith('/api/auth/'))).toEqual([]);
});

test('the positions table uses the startup request; a later refresh asks the server again', async ({ page }) => {
  await seeded(page);
  const urls = await portfolioRequests(page);
  await page.reload();
  await expect(page.locator('#positions-body tr[data-sym]')).toHaveCount(9);
  await page.waitForTimeout(1000);
  expect(urls).toEqual(startup('?base=SGD&account=main'));
  // A refresh (as after a write) is never answered from the startup request.
  await page.evaluate(() => window.FinSight.bus.invalidate('portfolio'));
  await expect.poll(() => urls.length).toBe(3);
  expect(urls[2]).toEqual({ search: '?base=SGD&account=main', startup: false });
});

test('a saved account that no longer exists falls back to the active one at startup', async ({ page }) => {
  await seeded(page);
  await page.evaluate(() => localStorage.setItem('finsight-account', 'gone'));
  const urls = await portfolioRequests(page);
  await page.reload();
  await expect(page.locator('#positions-body tr[data-sym]')).toHaveCount(9);
  await page.waitForTimeout(1000);
  // Signed in last time, so index.html asked for the saved account at once;
  // the app settled on the active one, did not use that response, and fetched.
  expect(urls).toEqual([{ search: '?base=SGD&account=gone', startup: true }, ...startup('?base=SGD&account=main').map((u) => ({ ...u, startup: false }))]);
  expect(await page.evaluate(() => localStorage.getItem('finsight-account'))).toBe('main');
  await expect(page.locator('#positions-body tr[data-sym="VOO"]')).toBeVisible();
});

test('the signed-in hint is kept while unlocked and cleared by a lock', async ({ page }) => {
  await seeded(page);
  expect(await page.evaluate(() => localStorage.getItem('finsight-signed-in'))).toBe('1');
  await page.click('#lock-btn');
  await expect(page.locator('body')).toHaveClass(/\blocked\b/);
  expect(await page.evaluate(() => localStorage.getItem('finsight-signed-in'))).toBeNull();
});

test('a hint left from an expired session: one try each for accounts and portfolio, then nothing while locked', async ({ page, context }) => {
  await seeded(page);
  await page.waitForLoadState('networkidle');
  await context.clearCookies(); // the session is gone, but this browser still says "signed in last time"
  const api: string[] = [];
  page.on('request', (r) => { const p = new URL(r.url()).pathname; if (p.startsWith('/api/') && !p.startsWith('/api/auth/')) api.push(p); });
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/\blocked\b/);
  await expect(page.locator('#lock-pin')).toBeVisible();
  await page.waitForTimeout(2000);
  expect(api.sort()).toEqual(['/api/accounts', '/api/portfolio']);
  expect(await page.evaluate(() => localStorage.getItem('finsight-signed-in'))).toBeNull();
  await page.reload(); // the hint is gone: a locked page asks only for the session status
  await expect(page.locator('#lock-pin')).toBeVisible();
  await page.waitForTimeout(1000);
  expect(api.length).toBe(2);
});

test('the saved base is the one fetched at startup', async ({ page }) => {
  await seeded(page);
  await page.evaluate(() => localStorage.setItem('finsight-base', 'USD'));
  const urls = await portfolioRequests(page);
  await page.reload();
  await expect(page.locator('#positions-body tr[data-sym]')).toHaveCount(9);
  await page.waitForTimeout(1000);
  expect(urls).toEqual(startup('?base=USD&account=main'));
});

test('the chart scripts no longer block the page; the detail chart and its grid still work', async ({ page }) => {
  await seeded(page);
  const html = await (await page.request.get('/')).text();
  for (const f of ['indicators', 'strategy', 'strategies', 'chart', 'chartgrid', 'journal']) expect(html).not.toContain(`src="/${f}.js"`);
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!window.detailChart && typeof (window as unknown as { ChartGrid?: unknown }).ChartGrid === 'function')).toBe(true);
  await expect(page.locator('#detail-chart-host canvas').first()).toBeVisible();
});

test('no panel shows its Suspense fallback at startup, so React never holds the page back 300 ms', async ({ page }) => {
  await seeded(page);
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { fallbacks: string[] }).fallbacks = seen;
    new MutationObserver(() => {
      document.querySelectorAll<HTMLElement>('[data-island] > [role="status"]').forEach((el) => {
        if (el.textContent === 'Loading…') seen.push(el.parentElement!.dataset.island!);
      });
    }).observe(document, { childList: true, subtree: true });
  });
  await page.reload();
  await expect(page.locator('#positions-body tr[data-sym]')).toHaveCount(9);
  await expect.poll(() => page.evaluate(() => !!window.detailChart)).toBe(true); // the idle-mounted panels are in too
  expect(await page.evaluate(() => (window as unknown as { fallbacks: string[] }).fallbacks)).toEqual([]);
});
