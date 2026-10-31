// FEAT-010 Discover: movers and earnings among holdings + watchlist, on the
// fake market. Checks the scope disclosure, sort order against the API,
// exclusions, row → detail, keyboard, watchlist fan-out and a phone layout.
import { test, expect, type Page } from '@playwright/test';
import { seeded } from './helpers';
import type { DiscoverResponse } from '../../shared/types.ts';

const body = (page: Page) => page.locator('#discover');
const api = async (page: Page) => (await (await page.request.get('/api/discover')).json()) as DiscoverResponse;

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => { if (!sessionStorage.getItem('discover-init')) { sessionStorage.setItem('discover-init', '1'); localStorage.removeItem('finsight-discover-tab'); } });
});
test.afterEach(async ({ page }) => {
  for (const symbol of ['TSLA', '^GSPC']) await page.request.post('/api/watchlist/remove', { data: { symbol } });
});

test('ranks only held and watched symbols, discloses scope and exclusions, and sorts by change', async ({ page }) => {
  await seeded(page);
  for (const symbol of ['TSLA', '^GSPC']) expect((await page.request.post('/api/watchlist/add', { data: { symbol } })).ok()).toBe(true);
  const d = await api(page);
  expect(d.scope).toMatchObject({ held: 9, watched: 2, eligible: 10 });
  expect(d.basis).toEqual({ source: 'Yahoo Finance', session: 'regular', baseline: 'previous-close', delayed: true });
  expect(d.excluded).toEqual([{ symbol: '^GSPC', reason: 'index' }]);
  const pcts = (rows: { changePct: number }[]) => rows.map((r) => r.changePct);
  expect(pcts(d.gainers)).toEqual([...pcts(d.gainers)].sort((a, b) => b - a));
  expect(pcts(d.losers)).toEqual([...pcts(d.losers)].sort((a, b) => a - b));
  expect(d.gainers.length + d.losers.length).toBe(d.scope.ranked);
  // Earnings come from the fixture's held names, nearest first, never more than 60 days out.
  expect(d.earnings.ok).toBe(true);
  expect(d.earnings.items.map((e) => e.symbol)).toEqual(['MSFT', 'GOOGL', 'AAPL', 'NVDA']);

  await page.reload();
  await expect(body(page)).toContainText('not the whole market');
  await expect(body(page)).toContainText('Excluded: 1 index');
  const first = d.gainers[0] ?? d.losers[0]!;
  await expect(body(page).locator(`[aria-label="GAINERS"] [data-row]`)).toHaveCount(Math.min(6, d.gainers.length));
  if (d.gainers[0]) await expect(body(page).locator('[aria-label="GAINERS"] [data-row]').first()).toHaveAttribute('data-sym', d.gainers[0].symbol);
  if (d.losers[0]) await expect(body(page).locator('[aria-label="LOSERS"] [data-row]').first()).toHaveAttribute('data-sym', d.losers[0].symbol);
  await expect(body(page).locator('[aria-label="Upcoming earnings"] [data-row]').first()).toContainText('MSFT');

  await body(page).locator(`[data-row][data-sym="${first.symbol}"]`).first().click();
  await expect(page.locator('#detail-title')).toHaveText(`${first.symbol} · DETAIL`);
});

test('keyboard: arrows move between rows, Enter opens the detail', async ({ page }) => {
  await seeded(page);
  const rows = body(page).locator('[data-row]');
  await expect(rows.first()).toBeVisible();
  await rows.first().focus();
  await page.keyboard.press('ArrowDown');
  const second = await rows.nth(1).getAttribute('data-sym');
  await expect(rows.nth(1)).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#detail-title')).toHaveText(`${second} · DETAIL`);
});

test('watching a symbol refreshes Discover through the shared invalidation', async ({ page }) => {
  await seeded(page);
  await expect(body(page)).toContainText('of 9 held + 0 watched');
  await page.click('#watch-toggle');
  await page.fill('#watch-symbol', 'TSLA');
  await page.press('#watch-symbol', 'Enter');
  await expect(body(page)).toContainText('of 9 held + 1 watched');
  await expect(body(page).locator('[data-row][data-sym="TSLA"]')).toContainText('watch');
});

test('phone width stacks the columns without horizontal scroll', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await seeded(page);
  await body(page).scrollIntoViewIfNeeded();
  await expect(body(page).locator('[data-row]').first()).toBeVisible();
  const [g, l] = await Promise.all(['GAINERS', 'LOSERS'].map((n) => body(page).locator(`[aria-label="${n}"]`).boundingBox()));
  expect(l!.y).toBeGreaterThan(g!.y + g!.height - 1); // stacked, not side by side
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('a failed request shows an error in the panel only', async ({ page }) => {
  await page.route('**/api/discover**', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'boom' }) }));
  await seeded(page);
  await expect(body(page).getByRole('alert')).toContainText('Discover failed');
  await expect(page.locator('#markets [data-sym]').first()).toBeVisible();
});

test('US market view: Yahoo screen rows, sorted, with scope and source; a row opens the detail', async ({ page }) => {
  await seeded(page);
  const d = await api(page);
  expect(d.market).toMatchObject({ ok: true, region: 'US', source: 'Yahoo Finance screener', stale: false, error: null });
  const pcts = (rows: { changePct: number }[]) => rows.map((r) => r.changePct);
  expect(pcts(d.market.gainers)).toEqual([...pcts(d.market.gainers)].sort((a, b) => b - a));
  expect(pcts(d.market.losers)).toEqual([...pcts(d.market.losers)].sort((a, b) => a - b));
  expect(d.market.gainers.every((r) => r.changePct > 0) && d.market.losers.every((r) => r.changePct < 0)).toBe(true);
  expect(d.market.gainers.length).toBeGreaterThan(0);

  await body(page).getByRole('tab', { name: 'US market' }).click();
  await expect(body(page)).toContainText("Yahoo's predefined Day Gainers");
  await expect(body(page)).toContainText('SG/HK not covered');
  const first = body(page).locator('[aria-label="US GAINERS"] [data-row]').first();
  await expect(first).toHaveAttribute('data-sym', d.market.gainers[0]!.symbol);
  await first.click();
  await expect(page.locator('#detail-title')).toHaveText(`${d.market.gainers[0]!.symbol} · DETAIL`);
  // The chosen view is remembered across a reload.
  await page.reload();
  await expect(body(page).getByRole('tab', { name: 'US market' })).toHaveAttribute('aria-selected', 'true');
});

test('IPO view: upcoming deals are tentative and future-only, priced deals are recent, links go to Nasdaq and SEC', async ({ page }) => {
  await seeded(page);
  const d = await api(page);
  expect(d.ipos).toMatchObject({ ok: true, source: 'Nasdaq IPO calendar', counts: { filed: 1, withdrawn: 1 } });
  expect(d.ipos.upcoming.map((x) => x.symbol)).toEqual(['NOVA', 'QRTZ']);
  expect(d.ipos.priced.map((x) => x.symbol)).toEqual(['BRKW']);

  await body(page).getByRole('tab', { name: 'IPOs' }).click();
  const up = body(page).locator('[aria-label="Upcoming IPOs"]');
  await expect(up).toContainText('expected dates tentative');
  await expect(up.locator('[data-deal="fx-1001"]')).toContainText('$250.00M');
  await expect(up.locator('[data-deal="fx-1001"]')).toContainText('$18.00–20.00');
  await expect(up.locator('[data-deal="fx-1001"]')).toContainText('~');
  await expect(up.locator('[data-deal="fx-1003"]')).toHaveCount(0);
  await expect(up.locator('[data-deal="fx-2002"]')).toHaveCount(0);
  await expect(up.locator('[data-deal="fx-1001"] a', { hasText: 'Nasdaq' })).toHaveAttribute('href', 'https://www.nasdaq.com/market-activity/ipos/overview?dealId=fx-1001');
  await expect(up.locator('[data-deal="fx-1001"] a', { hasText: 'SEC' })).toHaveAttribute('href', /^https:\/\/www\.sec\.gov\/cgi-bin\/browse-edgar\?action=getcompany&company=Novaline%20Robotics%20Inc\./);
  await expect(page.locator('[data-island-slot="discover:head"]')).toHaveText('tentative dates');
});

test('tabs: arrow keys move selection and focus, Home/End jump', async ({ page }) => {
  await seeded(page);
  const tab = (name: string) => body(page).getByRole('tab', { name });
  await tab('Your symbols').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab('US market')).toBeFocused();
  await expect(tab('US market')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('End');
  await expect(tab('IPOs')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  await expect(tab('Your symbols')).toHaveAttribute('aria-selected', 'true');
  await expect(body(page).getByRole('tabpanel')).toContainText('not the whole market');
});
