import { test, expect } from '@playwright/test';
import { seeded, cmd } from './helpers';

test('6M to 1Y changes actual chart context, not just the button', async ({ page }) => {
  await seeded(page);
  await expect(page.locator('#detail-hdr .detail-sym')).toHaveText('VOO');
  await page.click('#ranges [data-range="6mo"]');
  await expect(page.locator('#detail-hdr')).toContainText('6M');
  await page.click('#ranges [data-range="1y"]');
  await expect(page.locator('#ranges button.active')).toHaveText('1Y');
  const observed = await page.evaluate(() => ({ range: (window as any).detailChart.range, header: document.querySelector('#detail-hdr')!.textContent }));
  expect(observed.range).toBe('1y');
  await expect(page.locator('#detail-hdr')).toContainText('1Y');
  await page.click('#ranges [data-range="6mo"]');
  await expect.poll(() => page.evaluate(() => (window as any).detailChart.range)).toBe('6mo');
  await expect(page.locator('#detail-hdr')).toContainText('6M');
});

test('account switch refreshes chart markers for the unchanged symbol', async ({ page }) => {
  await seeded(page);
  const added = await (await page.request.post('/api/accounts/add', { data: { name: 'Audit empty' } })).json();
  await page.reload();
  await expect(page.locator('#detail-hdr .detail-sym')).toHaveText('VOO');
  await expect.poll(() => page.evaluate(() => !!(window as any).detailChart.tradeData)).toBe(true);
  const requests: string[] = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/chart-trades') requests.push(r.url()); });
  await page.selectOption('#account-sel', added.newId);
  await expect(page.locator('#positions-body')).toContainText('No positions yet');
  await page.waitForLoadState('networkidle');
  expect(requests.some((u) => new URL(u).searchParams.get('account') === added.newId)).toBe(true);
  await expect.poll(() => page.evaluate(() => (window as any).detailChart.tradeData?.account)).toBe(added.newId);
  expect(await page.evaluate(() => (window as any).detailChart.tradeData.position)).toBeNull();
});

test('late old-account marker response cannot replace the current account', async ({ page }) => {
  await seeded(page);
  await expect(page.locator('#detail-hdr .detail-sym')).toHaveText('VOO');
  await page.waitForLoadState('networkidle');
  const old = await page.locator('#account-sel').inputValue();
  const added = await (await page.request.post('/api/accounts/add', { data: { name: 'Audit race' } })).json();
  let release!: () => void, seen!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const intercepted = new Promise<void>((r) => { seen = r; });
  await page.route((u) => u.pathname === '/api/chart-trades', async (route) => {
    const account = new URL(route.request().url()).searchParams.get('account');
    if (account === old) { seen(); await held; }
    await route.fulfill({ json: { symbol: 'VOO', account, trades: [], lots: [] } });
  });
  await page.evaluate(() => { (window as any).__auditOld = (window as any).FinSightChartHooks.trades((window as any).detailChart, 'VOO'); });
  await intercepted;
  await page.evaluate((id) => window.FinSight.store.setState({ account: id }), added.newId);
  await page.evaluate(() => (window as any).FinSightChartHooks.trades((window as any).detailChart, 'VOO'));
  expect(await page.evaluate(() => (window as any).detailChart.tradeData.account)).toBe(added.newId);
  release();
  await page.evaluate(() => (window as any).__auditOld);
  const actual = await page.evaluate(() => (window as any).detailChart.tradeData.account);
  expect(actual).toBe(added.newId);
});


test('watchlist changes refresh the watched-company calendar on add and remove', async ({ page }) => {
  await seeded(page);
  await page.waitForLoadState('networkidle');
  await page.request.post('/api/watchlist/remove', { data: { symbol: 'AMD' } });
  await page.evaluate(() => window.FinSight.bus.invalidate('watchlist'));
  await page.route((u) => u.pathname === '/api/events', async (route) => {
    const { watchlist } = await (await page.request.get('/api/watchlist')).json();
    const watching = watchlist.some((w: { symbol: string }) => w.symbol === 'AMD');
    await route.fulfill({ json: { ok: true, events: watching ? [{ symbol: 'AMD', kind: 'EARNINGS', t: Date.now() + 86400000, estimated: false, held: false }] : [] } });
  });
  await cmd(page, 'WATCH AMD');
  await expect(page.locator('#watchlist')).toContainText('AMD');
  await expect(page.locator('#calendar .cal-row[data-sym="AMD"]')).toHaveCount(1);
  await cmd(page, 'UNWATCH AMD');
  await expect(page.locator('#watchlist')).not.toContainText('AMD');
  await expect(page.locator('#calendar .cal-row[data-sym="AMD"]')).toHaveCount(0);
});

test('account switching clears and refreshes both charts in the grid', async ({ page }) => {
  await seeded(page);
  await expect(page.locator('#detail-hdr .detail-sym')).toHaveText('VOO');
  const added = await (await page.request.post('/api/accounts/add', { data: { name: 'Grid empty' } })).json();
  await page.evaluate(() => (window as any).detailChart.onGrid({ n: 2 }));
  await expect.poll(() => page.evaluate(() => (window as any).allCharts().filter((c: any) => c.tradeData?.account === 'main').length)).toBe(2);
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  let intercepted = 0;
  await page.route((u) => u.pathname === '/api/chart-trades' && u.searchParams.get('account') === added.newId, async (route) => {
    intercepted++; await held; await route.continue();
  });
  // The full-screen grid hides the selector; use its shared account store.
  await page.evaluate((account) => window.FinSight.store.setState({ account }), added.newId);
  await expect.poll(() => intercepted).toBe(2);
  expect(await page.evaluate(() => (window as any).allCharts().map((c: any) => c.tradeData))).toEqual([null, null]);
  release();
  await expect.poll(() => page.evaluate((id) => (window as any).allCharts().filter((c: any) => c.tradeData?.account === id && c.tradeData.position === null).length, added.newId)).toBe(2);
  await page.evaluate(() => (window as any).detailChart.onGrid({ n: 1 }));
});

test('switching A to B to A cannot revive an older request for A', async ({ page }) => {
  await seeded(page);
  await expect(page.locator('#detail-hdr .detail-sym')).toHaveText('VOO');
  await page.waitForLoadState('networkidle');
  const account = await page.locator('#account-sel').inputValue();
  const added = await (await page.request.post('/api/accounts/add', { data: { name: 'Round trip' } })).json();
  let release!: () => void, seen!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  const intercepted = new Promise<void>((r) => { seen = r; });
  let oldRequest = true;
  await page.route((u) => u.pathname === '/api/chart-trades', async (route) => {
    const id = new URL(route.request().url()).searchParams.get('account');
    const old = oldRequest; oldRequest = false;
    if (old) { seen(); await held; }
    await route.fulfill({ json: { account: id, symbol: 'VOO', trades: [], dividends: [], position: null, version: old ? 'old' : 'latest' } });
  });
  await page.evaluate(() => { (window as any).__pendingTrade = (window as any).FinSightChartHooks.trades((window as any).detailChart, 'VOO'); });
  await intercepted;
  await page.evaluate((id) => window.FinSight.store.setState({ account: id }), added.newId);
  await expect.poll(() => page.evaluate(() => (window as any).detailChart.tradeData?.version)).toBe('latest');
  await page.evaluate((id) => window.FinSight.store.setState({ account: id }), account);
  await expect.poll(() => page.evaluate(() => (window as any).detailChart.tradeData?.account)).toBe(account);
  release(); await page.evaluate(() => (window as any).__pendingTrade);
  expect(await page.evaluate(() => (window as any).detailChart.tradeData.version)).toBe('latest');
});
