import { test, expect } from '@playwright/test';
import { seeded, cmd } from './helpers';

test('income forward header/withholding and recent activity follow writes and undo', async ({ page }) => {
  await seeded(page);
  await expect(page.locator('#dividends')).toContainText('Withholding assumed: US 30%');
  await expect(page.locator('#div-ttm')).toContainText('FWD');
  await expect(page.locator('#activity .line')).toHaveCount(9);
  await cmd(page, 'ADD NVDA 1 150');
  await expect(page.locator('#activity .line')).toHaveCount(10);
  await expect(page.locator('#activity .line').first()).toContainText('NVDA');
  await cmd(page, 'UNDO'); await expect(page.locator('#activity .line')).toHaveCount(9);
  try { await cmd(page, 'WHT US 15'); await expect(page.locator('#dividends')).toContainText('Withholding assumed: US 15%'); }
  finally { await cmd(page, 'WHT US 30'); }
});

test('received/forward/estimated tax text, empty income and API errors preserve legacy rendering', async ({ page }) => {
  await seeded(page);
  const report = { base: 'SGD', count: 1, received: { total: { gross: 20, tax: 5, net: 15 }, ttm: { gross: 20, tax: 5, net: 15 } }, forwardTotal: { gross: 200, tax: 60, net: 140 },
    forward: [{ symbol: 'MSFT', currency: 'USD', perShare: 4, yieldOnCost: 2, currentYield: 1, annualNet: 140, nextEx: null, nextExEstimated: true }],
    recent: [{ date: '2026-09-01', symbol: 'MSFT', baseNet: 15, baseTax: 5, whtActual: false }], withholding: { US: 30, SG: 0, HK: 0, EU: 15 } };
  await page.route('**/api/dividends?**', (route) => route.fulfill({ json: report }));
  await page.evaluate(() => (window as unknown as { loadDividends(): Promise<void> }).loadDividends());
  await expect(page.locator('#div-ttm')).toHaveText('FWD S$140/yr net');
  await expect(page.locator('#dividends')).toContainText('S$15.00');
  await expect(page.locator('#dividends')).toContainText('est.');
  await page.unroute('**/api/dividends?**');
  await page.route('**/api/dividends?**', (route) => route.fulfill({ json: { base: 'SGD', count: 0, forward: [] } }));
  await page.evaluate(() => (window as unknown as { loadDividends(): Promise<void> }).loadDividends());
  await expect(page.locator('#dividends')).toContainText('No dividends yet');
  await page.unroute('**/api/dividends?**');
  await page.route('**/api/dividends?**', (route) => route.fulfill({ status: 503, json: { error: 'income fixture failure' } }));
  await page.evaluate(() => (window as unknown as { loadDividends(): Promise<void> }).loadDividends());
  await expect(page.locator('#dividends')).toHaveText('income fixture failure');
});

test('intended fix (B3): old-account dividend responses cannot overwrite the selected account', async ({ page }) => {
  await seeded(page); await expect(page.locator('#dividends')).toContainText('FORWARD INCOME');
  const first = await page.locator('#account-sel').inputValue();
  const { newId } = await (await page.request.post('/api/accounts/add', { data: { name: 'Income Empty' } })).json();
  await page.reload(); await expect(page.locator('#dividends')).toContainText('FORWARD INCOME');
  let release!: () => void, seen!: () => void, finished!: () => void;
  const held = new Promise<void>((r) => { release = r; }), intercepted = new Promise<void>((r) => { seen = r; }), complete = new Promise<void>((r) => { finished = r; });
  await page.route(`**/api/dividends?base=SGD&account=${first}`, async (route) => {
    seen(); await held;
    try { await route.fulfill({ json: { base: 'SGD', count: 0, forward: [{ symbol: 'STALE', perShare: 1, currency: 'USD', annualNet: 500, nextEx: null }] } }); } finally { finished(); }
  }, { times: 1 });
  await page.evaluate(() => { void (window as unknown as { loadDividends(): Promise<void> }).loadDividends(); });
  await intercepted;
  try { await page.selectOption('#account-sel', newId); await expect(page.locator('#dividends')).toContainText('No dividends yet'); }
  finally { release(); }
  await complete; await page.waitForTimeout(150);
  await expect(page.locator('#dividends')).not.toContainText('STALE');
  await expect(page.locator('#dividends')).toContainText('No dividends yet');
  await page.request.post('/api/accounts/remove', { data: { id: newId } });
});

test('dividend polling is 120 seconds with no legacy duplicate, and stops after unmount', async ({ page }) => {
  await page.clock.install(); await seeded(page);
  await expect(page.locator('#dividends')).toContainText('FORWARD INCOME'); await page.waitForLoadState('networkidle');
  const calls: string[] = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/dividends') calls.push(r.url()); });
  await page.clock.fastForward(120_010);
  await expect.poll(() => calls.length).toBe(1);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => { document.getElementById('dividends')!.remove(); document.getElementById('activity')!.remove(); });
  await expect(page.locator('#div-ttm')).toBeEmpty(); calls.length = 0;
  await page.clock.fastForward(120_010);
  await page.evaluate(() => window.FinSight.bus.invalidate('dividends'));
  expect(calls).toHaveLength(0);
});
