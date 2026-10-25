// E1 + E2: the security detail (header, stats, ranges) and the chart host.
// Written against legacy first.
import { test, expect, type Page } from '@playwright/test';
import { seeded, cmd } from './helpers';

declare const detailChart: { symbol: string; maxed?: boolean; root: HTMLElement; toggleMax(v?: boolean): void;
  onRequest(r: { interval: string }): void; onGrid(o: { n: number }): void };
const path = (u: string) => new URL(u).pathname;
const hist = (page: Page, test: (q: URLSearchParams) => boolean) =>
  page.waitForRequest((r) => path(r.url()) === '/api/history' && test(new URL(r.url()).searchParams));
const hdr = (page: Page) => page.locator('#detail-hdr');

test('header and stats for the auto-selected holding; Q selects; reselecting refreshes', async ({ page }) => {
  await seeded(page);
  await expect(page.locator('#detail-title')).toHaveText('VOO · DETAIL');
  await expect(hdr(page).locator('.detail-sym')).toHaveText('VOO');
  await expect(hdr(page).locator('.detail-name')).toHaveText('Vanguard S&P 500 ETF');
  await expect(hdr(page).locator('.detail-price')).toHaveText('552.10');
  await expect(hdr(page)).toContainText('1M');
  await expect(hdr(page)).toContainText('USD · NYSEArca');
  await expect(page.locator('#detail-stats .stat-row .k')).toHaveText(['Prev Close', 'Day Range', '52W High', '52W Low', 'Volume', 'Type']);
  await expect(page.locator('#detail-stats .stat-row').last().locator('.v')).toHaveText('ETF');
  await expect(page.locator('#detail-body canvas').first()).toBeAttached();
  expect(await page.evaluate(() => detailChart.symbol)).toBe('VOO');

  await cmd(page, 'Q MSFT');
  await expect(page.locator('#detail-title')).toHaveText('MSFT · DETAIL');
  await expect(hdr(page).locator('.detail-price')).toHaveText('468.20');
  await expect.poll(() => page.evaluate(() => detailChart.symbol)).toBe('MSFT');
  const again = page.waitForRequest((r) => path(r.url()) === '/api/quote' && r.url().includes('MSFT'));
  await cmd(page, 'Q MSFT');
  await again;
});

test('ranges: warm-up history, active button, chart timeframe clears it; the range % hides for 1D', async ({ page }) => {
  await seeded(page);
  await expect(page.locator('#ranges [data-range="1mo"]')).toHaveClass(/\bactive\b/);
  let req = hist(page, (q) => q.get('interval') === '5m');
  await page.click('#ranges [data-range="1d"]');
  expect((await req).url()).toContain('range=5d'); // 1D fetches 5 days for indicator warm-up
  await expect(page.locator('#ranges button.active')).toHaveText('1D');
  await expect(hdr(page)).not.toContainText(' 1D');
  req = hist(page, (q) => q.get('interval') === '1d' && q.get('range') === '2y');
  await page.click('#ranges [data-range="6mo"]');
  await req;
  await expect(hdr(page)).toContainText('6M');
  req = hist(page, (q) => q.get('interval') === '60m' && q.get('range') === '1y');
  await page.evaluate(() => detailChart.onRequest({ interval: '60m' }));
  await req;
  await expect(page.locator('#ranges button.active')).toHaveCount(0);
  await expect(hdr(page)).not.toContainText('6M');
});

test('a manual holding shows its valuation instead of a chart; a quoted symbol brings the chart back', async ({ page }) => {
  await seeded(page);
  await page.request.post('/api/portfolio/import?base=SGD', { data: { csv: 'symbol,quantity,avg price\nNOPE,5,2', replace: false } });
  await page.reload();
  await page.click('#positions-body tr[data-sym="NOPE"]');
  await expect(page.locator('#detail-title')).toHaveText('NOPE · DETAIL');
  await expect(page.locator('#detail-body')).toContainText('Manual holding · no market data feed.');
  await expect(page.locator('#detail-body')).toContainText('× 5.0000 =');
  await expect(page.locator('#detail-body canvas')).toHaveCount(0);
  await page.click('#positions-body tr[data-sym="AAPL"]');
  await expect(page.locator('#detail-body canvas').first()).toBeAttached();
  await expect(hdr(page).locator('.detail-sym')).toHaveText('AAPL');
  await page.request.post('/api/portfolio/delete?base=SGD', { data: { symbol: 'NOPE' } });
});

test('a slow response for the previous symbol never replaces the new one; errors are shown', async ({ page }) => {
  await seeded(page);
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  await page.route((u) => u.pathname === '/api/history' && u.searchParams.get('symbol') === 'MSFT', async (route) => { await held; await route.fallback(); });
  await page.click('#positions-body tr[data-sym="MSFT"]');
  await page.click('#positions-body tr[data-sym="AAPL"]');
  await expect(hdr(page).locator('.detail-sym')).toHaveText('AAPL');
  release();
  await page.waitForTimeout(800);
  await expect(hdr(page).locator('.detail-sym')).toHaveText('AAPL');
  expect(await page.evaluate(() => detailChart.symbol)).toBe('AAPL');
  await page.unroute('**/*');

  await page.route((u) => u.pathname === '/api/history' && u.searchParams.get('symbol') === 'TSM', (r) => r.fulfill({ status: 500, json: { error: 'feed down' } }));
  await page.click('#positions-body tr[data-sym="TSM"]');
  await expect(hdr(page)).toHaveText('Could not load TSM: feed down');
});

test('removing the selected holding selects the first one again; a sale reloads the chart trades', async ({ page }) => {
  test.setTimeout(60_000);
  await seeded(page);
  await expect(page.locator('#detail-title')).toHaveText('VOO · DETAIL');
  // Legacy reloads the overlay on its next 30 s refresh; the island on the 'chart-trades' key.
  const trades = page.waitForRequest((r) => path(r.url()) === '/api/chart-trades' && r.url().includes('symbol=VOO'), { timeout: 35_000 });
  await cmd(page, 'SELL VOO 1');
  await trades;
  page.once('dialog', (d) => d.accept());
  await page.locator('#positions-body tr[data-sym="VOO"]').hover();
  await page.locator('#positions-body tr[data-sym="VOO"] [data-act="del"]').click();
  await expect(page.locator('#detail-title')).toHaveText('NVDA · DETAIL');
  await expect(hdr(page).locator('.detail-sym')).toHaveText('NVDA');
});

test('expand and the 2-chart grid move the chart out and back; a theme change keeps it', async ({ page }) => {
  await seeded(page);
  await expect(page.locator('#detail-body canvas').first()).toBeAttached();
  await page.evaluate(() => detailChart.toggleMax(true));
  await expect(page.locator('body > #detail-chart-host')).toHaveCount(1);
  await page.evaluate(() => detailChart.toggleMax(false));
  await expect(page.locator('#detail-body #detail-chart-host')).toHaveCount(1);
  await page.evaluate(() => detailChart.onGrid({ n: 2 }));
  await expect(page.locator('.pc-grid .pc-gslot')).toHaveCount(2);
  await page.evaluate(() => detailChart.onGrid({ n: 1 }));
  await expect(page.locator('.pc-grid')).toHaveCount(0);
  await expect(page.locator('#detail-body #detail-chart-host')).toHaveCount(1);
  await page.click('#cards-btn'); // theme swatches live in ⚙ Layout (F8 moved setTheme into the appearance island)
  await page.click('#theme-list [data-theme="teal"]');
  await expect(page.locator('#detail-body canvas').first()).toBeAttached();
  await page.click('#theme-list [data-theme="violet"]');
  await page.click('#cards-done');
});

test('the 30 s refresh re-reads the quote but not daily history', async ({ page }) => {
  test.setTimeout(60_000);
  await seeded(page);
  await expect(page.locator('#detail-body canvas').first()).toBeAttached();
  const quotes: string[] = [], hists: string[] = [];
  page.on('request', (r) => { if (path(r.url()) === '/api/quote') quotes.push(r.url()); if (path(r.url()) === '/api/history') hists.push(r.url()); });
  await page.waitForTimeout(31_000);
  expect(quotes.filter((u) => u.includes('VOO')).length).toBeGreaterThanOrEqual(1);
  expect(hists).toEqual([]);
});
