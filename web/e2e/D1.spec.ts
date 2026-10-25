// D1: the positions table as a React island. Written against legacy first;
// these must hold before and after the port. FX-dependent cells (P&L, FX P&L)
// move with the daily FX walk, so only price/quantity-based cells are pinned.
import { test, expect, type Page } from '@playwright/test';
import { seeded, cmd, dragPanel, PIN } from './helpers';

const rows = (page: Page) => page.locator('#positions-body tr[data-sym]');
const cells = (page: Page, sym: string) => page.locator(`#positions-body tr[data-sym="${sym}"] td`);
const isPortfolio = (url: string) => new URL(url).pathname === '/api/portfolio';

test('renders like legacy: cells, chips, default sort marker, selection', async ({ page }) => {
  await seeded(page);
  await expect(page.locator('#pos-filter button')).toHaveText(['ALL', 'STOCKS 78%', 'ETFS 22%']);
  await expect(page.locator('#pos-filter button[data-cls="ALL"]')).toHaveClass('active');
  await expect(page.locator('#pos-head th[data-sort="marketValue"]')).toHaveClass(/\bsorted\b/);
  await expect(page.locator('#pos-head th[data-sort="marketValue"]')).toHaveAttribute('data-dir', '▼');
  await expect(page.locator('#pos-head th[data-sort="symbol"]')).toHaveAttribute('data-dir', '');
  await expect(page.locator('#pos-scope')).toBeHidden();
  const voo = cells(page, 'VOO');
  await expect(voo.nth(0)).toHaveText('VOOVanguard S&P 500 ETF · USD');
  await expect(voo.nth(1)).toHaveText('22');
  await expect(voo.nth(2)).toHaveText('470.00');
  await expect(voo.nth(3)).toHaveText('552.10');
  await expect(voo.nth(5)).toHaveText('S$15,668.60');
  await expect(voo.nth(9)).toHaveText('16.9');
  await expect(cells(page, 'ES3.SI').nth(1)).toHaveText('1,200');
  await expect(cells(page, 'D05.SI').nth(0)).toHaveText('D05.SIDBS Group Holdings L · SGD'); // name cut at 20
  await expect(cells(page, 'D05.SI').nth(8)).toHaveText('—'); // FX P&L is blank in the base currency
  await expect(page.locator('#positions-body tr[data-sym="NVDA"] [data-act="sell"]')).toHaveAttribute('data-qty', '60');

  // The first quoted holding is auto-selected; clicking a row moves the highlight and the detail.
  await expect(page.locator('#positions-body tr[data-sym="VOO"]')).toHaveClass(/\bselected\b/);
  await page.locator('#positions-body tr[data-sym="NVDA"]').click();
  await expect(page.locator('#detail-title')).toHaveText('NVDA · DETAIL');
  await expect(page.locator('#positions-body tr[data-sym="NVDA"]')).toHaveClass(/\bselected\b/);
  await expect(page.locator('#positions-body tr.selected')).toHaveCount(1);
  // Selecting from elsewhere (World Markets) clears the row highlight.
  await page.locator('#markets [data-sym="^GSPC"]').click();
  await expect(page.locator('#detail-title')).toHaveText('^GSPC · DETAIL');
  await expect(page.locator('#positions-body tr.selected')).toHaveCount(0);
});

test('filter shows the scope line; view settings persist after reload; groups collapse', async ({ page }) => {
  await seeded(page);
  await page.click('#pos-filter button[data-cls="ETFs"]');
  await expect(rows(page)).toHaveCount(2);
  await expect(page.locator('#pos-scope')).toBeVisible();
  await expect(page.locator('#pos-scope')).toContainText('SHOWING 2 OF 9 · S$20,372.60 (21.9% of invested) · P&L');
  await page.fill('#pos-search', 'zzz');
  await expect(page.locator('#positions-body')).toHaveText('No holdings match this filter.');
  await page.fill('#pos-search', 'straits');
  await expect(rows(page)).toHaveCount(1);
  await page.reload();
  await expect(page.locator('#pos-search')).toHaveValue('straits');
  await expect(page.locator('#pos-filter button[data-cls="ETFs"]')).toHaveClass('active');
  await expect(rows(page)).toHaveCount(1);
  await page.fill('#pos-search', '');
  await page.click('#pos-filter button[data-cls="ALL"]');

  await page.click('#pos-head th[data-sort="symbol"]');
  await expect(rows(page).first()).toHaveAttribute('data-sym', 'AAPL');
  await expect(page.locator('#pos-head th[data-sort="symbol"]')).toHaveAttribute('data-dir', '▲');
  await page.selectOption('#pos-group', 'class');
  const groups = page.locator('#positions-body tr.grp-row');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toContainText('▾ STOCKS · 7');
  await expect(groups.nth(0).locator('td').nth(1)).toHaveText('S$72,594.88');
  await expect(groups.nth(1)).toContainText('▾ ETFS · 2');
  await groups.nth(0).click();
  await expect(groups.nth(0)).toContainText('▸ STOCKS · 7');
  await expect(rows(page)).toHaveCount(2);
  await page.reload();
  await expect(page.locator('#pos-group')).toHaveValue('class');
  await expect(page.locator('#positions-body tr.grp-row').nth(0)).toContainText('▸ STOCKS · 7');
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toHaveAttribute('data-sym', 'ES3.SI'); // symbol sort kept
  await page.locator('#positions-body tr.grp-row').nth(0).click();
  await expect(rows(page)).toHaveCount(9);

  await page.selectOption('#pos-group', 'sector'); // needs /api/categories
  await expect(page.locator('#positions-body tr.grp-row')).toHaveText([/TECHNOLOGY · 4/, /FINANCIAL SERVICES · 2/, /ETF \/ FUND · 2/, /COMMUNICATION SERVICES · 1/]);
});

test('All Accounts: a symbol held twice shows "2 accts" and splits when grouped by account', async ({ page }) => {
  await seeded(page);
  const sel = page.locator('#account-sel');
  await page.request.post('/api/accounts/add', { data: { name: 'Second' } });
  await page.reload();
  await sel.selectOption({ label: 'Second' });
  await expect(page.locator('#positions-body')).toContainText('No positions yet');
  await expect(page.locator('#pos-filter button')).toHaveCount(0);
  await cmd(page, 'ADD NVDA 10 100');
  await expect(rows(page)).toHaveCount(1);
  await sel.selectOption('ALL');
  await expect(rows(page)).toHaveCount(9);
  await expect(cells(page, 'NVDA').nth(0)).toContainText('· 2 accts');
  await expect(cells(page, 'NVDA').nth(1)).toHaveText('70');
  await page.selectOption('#pos-group', 'account');
  await expect(page.locator('#positions-body tr.grp-row')).toHaveCount(2);
  await expect(rows(page)).toHaveCount(10);
  const nvda = page.locator('#positions-body tr[data-sym="NVDA"]');
  await expect(nvda).toHaveCount(2);
  await expect(nvda.nth(0).locator('td').nth(1)).toHaveText('60');
  await expect(nvda.nth(1).locator('td').nth(1)).toHaveText('10');
  await expect(nvda.nth(1).locator('td').nth(0)).not.toContainText('accts');
  await page.selectOption('#pos-group', 'none');
});

test('a new price flashes its row once; an unchanged price does not', async ({ page }) => {
  await seeded(page);
  await expect(cells(page, 'NVDA').nth(3)).toHaveText('182.40');
  await page.route((u) => isPortfolio(u.toString()), async (route) => {
    const res = await route.fetch(), body = await res.json();
    for (const p of body.positions) if (p.symbol === 'NVDA') p.last = 190;
    await route.fulfill({ response: res, json: body });
  });
  await page.evaluate(() => window.FinSight.bus.invalidate('portfolio'));
  await expect(cells(page, 'NVDA').nth(3)).toHaveText('190.00');
  await expect(page.locator('#positions-body tr[data-sym="NVDA"]')).toHaveClass(/\bflash-up\b/);
  await expect(page.locator('#positions-body tr[data-sym="MSFT"]')).not.toHaveClass(/flash/);
  expect(await page.evaluate(() => window.FinSight.store.getState().lastPrices.NVDA)).toBe(190);
  await page.evaluate(() => window.FinSight.bus.invalidate('portfolio'));
  await expect(page.locator('#positions-body tr[data-sym="NVDA"]')).not.toHaveClass(/flash/);
});

test('dragged to the right column it keeps its rows after reload, and after lock/unlock', async ({ page, context }) => {
  test.setTimeout(45_000);
  await seeded(page);
  await dragPanel(page, 'positions', '.col-right');
  await expect(page.locator('.col-right > .panel[data-pid="positions"]')).toHaveCount(1);
  await expect(rows(page)).toHaveCount(9);
  await page.reload();
  await expect(page.locator('.col-right > .panel[data-pid="positions"]')).toHaveCount(1);
  await expect(rows(page)).toHaveCount(9);

  await context.clearCookies();
  await page.evaluate(() => { void (window as any).loadWatchlist(); }); // legacy-any: any API call now 401s
  await expect(page.locator('body')).toHaveClass(/\blocked\b/);
  expect((await page.request.post('/api/auth/login', { data: { pin: PIN } })).ok()).toBe(true); // a write while locked, from another tab
  const del = await page.request.post('/api/portfolio/delete?base=SGD', { data: { symbol: 'ES3.SI' } });
  expect(del.ok(), await del.text()).toBe(true);
  expect((await del.json()).positions).toHaveLength(8);
  await context.clearCookies();
  const refetched = page.waitForRequest((r) => isPortfolio(r.url()));
  await page.fill('#lock-pin', PIN);
  await page.press('#lock-pin', 'Enter');
  await refetched;
  // Legacy redraws on its next 15 s poll; the island refetches on unlock.
  await expect(rows(page)).toHaveCount(8, { timeout: 20_000 });
});
