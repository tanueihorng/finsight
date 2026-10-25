import { test, expect } from '@playwright/test';
import { seeded, cmd } from './helpers';

test('watchlist search picks a symbol, submit adds it, row selects detail, remove deletes it', async ({ page }) => {
  await seeded(page);
  await page.request.post('/api/watchlist/remove', { data: { symbol: 'NVDA' } });
  await page.evaluate(() => window.FinSight.bus.invalidate('watchlist'));
  await page.click('#watch-toggle'); await page.fill('#watch-symbol', 'nvd');
  await expect(page.locator('#watch-suggest [data-i]').first()).toBeVisible();
  await page.locator('#watch-suggest [data-i]').first().click();
  await expect(page.locator('#watch-symbol')).toHaveValue('NVDA');
  await page.locator('#watch-form button[type=submit]').click();
  await expect(page.locator('#cmd-status')).toHaveText('Watching NVDA');
  const row = page.locator('#watchlist .wl-row[data-sym="NVDA"]');
  await expect(row).toContainText('182.40');
  await row.click(); await expect(page.locator('#detail-title')).toHaveText('NVDA · DETAIL');
  await row.locator('.wl-x').click(); await expect(row).toHaveCount(0);
});
test('command WATCH/UNWATCH and unavailable quote/empty states preserve legacy rendering', async ({ page }) => {
  await seeded(page); await cmd(page, 'WATCH NVDA');
  await expect(page.locator('#watchlist .wl-row[data-sym="NVDA"]')).toBeVisible();
  await cmd(page, 'UNWATCH NVDA');
  await expect(page.locator('#watchlist .wl-row[data-sym="NVDA"]')).toHaveCount(0);
  await page.route('**/api/watchlist', (route) => route.fulfill({ json: { watchlist: [{ symbol: 'MISSING', error: 'no quote' }] } }));
  await page.evaluate(() => window.FinSight.bus.invalidate('watchlist'));
  await expect(page.locator('#watchlist')).toContainText('n/a');
  await page.unroute('**/api/watchlist');
  await page.route('**/api/watchlist', (route) => route.fulfill({ json: { watchlist: [] } }));
  await page.evaluate(() => window.FinSight.bus.invalidate('watchlist'));
  await expect(page.locator('#watchlist')).toContainText('Empty — add a symbol above');
});

test('watchlist query feeds the chart adapter and unmount releases polling', async ({ page }) => {
  await seeded(page);
  const adapterCalls: string[][] = [];
  await page.exposeFunction('recordWatch', (symbols: string[]) => adapterCalls.push(symbols));
  await page.evaluate(() => {
    const bridge = (window as unknown as { FinSightLegacy: { setChartWatch: (list: { symbol: string }[]) => void } }).FinSightLegacy;
    const original = bridge.setChartWatch;
    bridge.setChartWatch = (list) => { void (window as unknown as { recordWatch: (syms: string[]) => Promise<void> }).recordWatch(list.map((x) => x.symbol)); original(list); };
  });
  await cmd(page, 'WATCH NVDA');
  await expect.poll(() => adapterCalls.some((list) => list.includes('NVDA'))).toBe(true);
  await expect(page.locator('#watchlist .wl-row[data-sym="NVDA"]')).toBeVisible();
  await page.evaluate(() => document.getElementById('watchlist')!.remove());
  await page.waitForTimeout(100);
  const calls: string[] = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/watchlist') calls.push(r.url()); });
  await page.evaluate(() => window.FinSight.bus.invalidate('watchlist'));
  expect(calls).toHaveLength(0);
  await page.request.post('/api/watchlist/remove', { data: { symbol: 'NVDA' } });
});
