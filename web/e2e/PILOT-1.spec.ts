// PILOT-1: World Markets as a React island inside the legacy panel host.
// Proves the plan's gate: drag/hide/reload keep one host, one 15 s poll,
// lock stops and unlock resumes polling, removal unmounts (no more requests).
import { test, expect, type Page } from '@playwright/test';
import { seeded, cmd, dragPanel, PIN } from './helpers';

const isMarkets = (url: string) => new URL(url).pathname === '/api/markets';
function countMarkets(page: Page) {
  const times: number[] = [];
  page.on('request', (r) => { if (isMarkets(r.url())) times.push(Date.now()); });
  return times;
}
const panel = (page: Page) => page.locator('.panel[data-pid="markets"]');

test('renders like legacy: groups, prices, update label, LIVE pill; a row selects the symbol', async ({ page }) => {
  await seeded(page);
  const body = page.locator('#markets');
  await expect(body).toContainText('INDICES');
  await expect(body.locator('[data-sym="^GSPC"]')).toContainText('S&P 500');
  await expect(body.locator('[data-sym="^GSPC"]')).toContainText('6,012.40');
  await expect(body.locator('[data-sym="USDSGD=X"]')).toContainText('1.2900'); // < 10 → 4 decimals
  await expect(page.locator('#markets-time')).toHaveText(/^upd \d{2}:\d{2}:\d{2}$/);
  await expect(page.locator('#market-state')).toHaveText('LIVE');
  await expect(page.locator('#market-state')).toHaveClass('pill open');
  await body.locator('[data-sym="^GSPC"]').click();
  await expect(page.locator('#detail-title')).toHaveText('^GSPC · DETAIL');
});

test('MKT refetches now; dragged to the other column it survives reload and polls once per 15 s', async ({ page }) => {
  test.setTimeout(75_000);
  await seeded(page);
  await expect(page.locator('#markets [data-sym]').first()).toBeVisible();
  const refetch = page.waitForRequest((r) => isMarkets(r.url()));
  await cmd(page, 'MKT');
  await refetch;
  await expect(page.locator('#cmd-status')).toHaveText('Refreshing world markets…');

  await dragPanel(page, 'markets', '.col-left');
  await expect(page.locator('.col-left > .panel[data-pid="markets"]')).toHaveCount(1);
  await expect(page.locator('#markets [data-sym]').first()).toBeVisible(); // root kept across the move
  await page.reload();
  await expect(page.locator('.col-left > .panel[data-pid="markets"]')).toHaveCount(1);
  await expect(panel(page)).toHaveCount(1);
  await expect(page.locator('#markets [data-sym]').first()).toBeVisible();

  const times = countMarkets(page);
  await page.waitForTimeout(31_000);
  expect(times.length, `requests at ${times.map((t) => t - (times[0] ?? t)).join(', ')} ms`).toBe(2);
});

test('hidden in ⚙ Layout it stays hidden after reload, and shows again with content', async ({ page }) => {
  await seeded(page);
  await page.click('#cards-btn');
  await page.locator('#panels-list input[data-panel="markets"]').uncheck();
  await page.click('#cards-done');
  await expect(panel(page)).toBeHidden();
  await page.reload();
  await expect(panel(page)).toBeHidden();
  await page.click('#cards-btn');
  await page.locator('#panels-list input[data-panel="markets"]').check();
  await page.click('#cards-done');
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('#markets [data-sym]').first()).toBeVisible();
});

test('lock stops markets polling and unlock resumes it', async ({ page, context }) => {
  test.setTimeout(60_000);
  await seeded(page);
  await expect(page.locator('#markets [data-sym]').first()).toBeVisible();
  await context.clearCookies();
  await page.evaluate(() => { void (window as any).loadWatchlist(); }); // legacy-any: any API call now 401s
  await expect(page.locator('body')).toHaveClass(/\blocked\b/);
  const times = countMarkets(page);
  await page.waitForTimeout(16_000);
  expect(times).toEqual([]);
  const resumed = page.waitForRequest((r) => isMarkets(r.url()));
  await page.fill('#lock-pin', PIN);
  await page.press('#lock-pin', 'Enter');
  await resumed;
  await expect(page.locator('#markets [data-sym]').first()).toBeVisible();
});

test('removing the host unmounts the island: no further requests', async ({ page }) => {
  test.setTimeout(45_000);
  await seeded(page);
  await expect(page.locator('#markets [data-sym]').first()).toBeVisible();
  await page.evaluate(() => document.getElementById('markets')!.remove());
  const times = countMarkets(page);
  await page.waitForTimeout(16_000);
  expect(times).toEqual([]);
});
