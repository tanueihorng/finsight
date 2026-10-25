import { test, expect } from '@playwright/test';
import { seeded, cmd, PIN } from './helpers';

test('calendar anchors and company rows render; a company selects detail', async ({ page }) => {
  await page.route('**/api/events?**', (route) => route.fulfill({ json: { ok: true, events: [{ symbol: 'MSFT', kind: 'EARNINGS', t: Date.now() + 86400000, estimated: true, held: false }] } }));
  await seeded(page);
  await expect(page.locator('#calendar')).toContainText('NEXT FED DECISION');
  await expect(page.locator('#calendar')).toContainText('NEXT DOT PLOT');
  await expect(page.locator('#calendar')).toContainText('YOUR HOLDINGS');
  await page.locator('#calendar [data-sym="MSFT"]').click();
  await expect(page.locator('#detail-title')).toHaveText('MSFT · DETAIL');
});
test('world bank country Enter, indicator and LOAD preserve values, chart, empty/error text', async ({ page }) => {
  await seeded(page);
  await expect(page.locator('#wb-body svg')).toBeAttached();
  await page.fill('#wb-country', 'SG'); await page.press('#wb-country', 'Enter');
  await expect(page.locator('#wb-body')).toContainText('Singapore');
  await page.selectOption('#wb-indicator', 'NY.GDP.MKTP.KD.ZG');
  await expect(page.locator('#wb-body')).toContainText('%');
  await page.route('**/api/worldbank?**', (route) => route.fulfill({ json: { series: [] } }));
  await page.click('#wb-go'); await expect(page.locator('#wb-body')).toHaveText('No data for SG.');
  await page.unroute('**/api/worldbank?**');
  await page.route('**/api/worldbank?**', (route) => route.fulfill({ status: 503, json: { error: 'fixture failure' } }));
  await page.click('#wb-go'); await expect(page.locator('#wb-body')).toHaveText('World Bank error: fixture failure');
});
test('FRED selection and LOAD preserve label, chart, empty/error states', async ({ page }) => {
  await seeded(page);
  await expect(page.locator('#fred-body')).toContainText('10-Year Treasury Yield');
  await page.selectOption('#fred-series', 'GDPC1|lin');
  await expect(page.locator('#fred-body')).toContainText('Real GDP (level)');
  await expect(page.locator('#fred-body svg')).toBeAttached();
  await page.route('**/api/fred?**', (route) => route.fulfill({ json: { points: [] } }));
  await page.click('#fred-go'); await expect(page.locator('#fred-body')).toHaveText('No data.');
  await page.unroute('**/api/fred?**');
  await page.route('**/api/fred?**', (route) => route.fulfill({ status: 503, json: { error: 'fixture failure' } }));
  await page.click('#fred-go'); await expect(page.locator('#fred-body')).toHaveText('FRED error: fixture failure');
});
test('inflation loads only on request, tolerates missing gauges and includes funds note', async ({ page }) => {
  await seeded(page);
  await expect(page.locator('#infl-body')).toContainText('Press LOAD');
  let calls = 0;
  await page.route('**/api/fred?**', async (route) => {
    calls++;
    const series = new URL(route.request().url()).searchParams.get('series');
    await route.fulfill({ json: { points: series === 'CPIAUCSL' ? [] : [{ date: '2026-08-01', value: 2.5 }, { date: '2026-09-01', value: 2.4 }] } });
  });
  await page.click('#infl-go');
  await expect(page.locator('#infl-body')).toContainText('Fed funds: 2.40%');
  await expect(page.locator('#infl-body .infl-row')).toHaveCount(7);
  await expect(page.locator('#infl-body .infl-row').first()).toContainText('n/a');
  expect(calls).toBe(8);
  await cmd(page, 'Q NVDA');
  expect(calls).toBe(8);
});

test('macro polling is 15 minutes; inflation remains manual', async ({ page }) => {
  await page.clock.install(); await seeded(page);
  await expect(page.locator('#wb-body svg')).toBeAttached();
  await expect(page.locator('#fred-body svg')).toBeAttached();
  await page.waitForLoadState('networkidle');
  const calls: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (['/api/worldbank', '/api/fred', '/api/calendar', '/api/events'].includes(u.pathname)) calls.push(u.pathname); });
  await page.clock.fastForward(900_010);
  await expect.poll(() => calls.filter((x) => x === '/api/worldbank').length).toBe(1);
  await expect.poll(() => calls.filter((x) => x === '/api/calendar').length).toBe(1);
  expect(calls.filter((x) => x === '/api/fred')).toHaveLength(1);
  await expect(page.locator('#infl-body')).toContainText('Press LOAD');
});
test('lock gates macro requests; removed islands release subscriptions', async ({ page, context }) => {
  await seeded(page); await expect(page.locator('#wb-body svg')).toBeAttached();
  await page.waitForLoadState('networkidle'); await context.clearCookies();
  await page.evaluate(() => window.FinSight.bus.invalidate('markets'));
  await expect(page.locator('body')).toHaveClass(/\blocked\b/);
  const calls: string[] = [];
  page.on('request', (r) => { if (/\/api\/(worldbank|fred|calendar|events)/.test(r.url())) calls.push(r.url()); });
  await page.evaluate(async () => { for (const key of ['worldbank', 'fred', 'calendar', 'events']) await window.FinSight.bus.invalidate(key); });
  expect(calls).toHaveLength(0);
  await page.fill('#lock-pin', PIN); await page.press('#lock-pin', 'Enter');
  await expect.poll(() => calls.length).toBeGreaterThan(0);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => { for (const id of ['calendar', 'wb-body', 'fred-body', 'infl-body']) document.getElementById(id)!.remove(); });
  await page.waitForTimeout(100); calls.length = 0;
  await page.evaluate(async () => { for (const key of ['worldbank', 'fred', 'calendar', 'events']) await window.FinSight.bus.invalidate(key); });
  expect(calls).toHaveLength(0);
});
