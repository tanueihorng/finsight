// PILOT-2: summary cards as a React island, and mutation fan-out. After each
// kind of write the React summary, the legacy positions table, dividends,
// FX risk and (when open) the ledger show the new values without a reload.
import { test, expect, type Page } from '@playwright/test';
import { seeded, cmd, qtyCell } from './helpers';

const netWorth = (page: Page) => page.locator('#summary .card', { hasText: 'NET WORTH' }).locator('.value');
const fxCard = (page: Page) => page.locator('#summary .card', { hasText: 'FX EXPOSURE' });
const rows = (page: Page) => page.locator('#positions-body tr[data-sym]');
const text = (page: Page, sel: string) => page.locator(sel).innerText();

test('summary renders from React with the legacy values and cash click', async ({ page }) => {
  await seeded(page);
  await expect(netWorth(page)).toHaveText('S$92,967.48');
  await expect(fxCard(page).locator('.value')).toHaveText('S$66.33K');
  await expect(fxCard(page).locator('.sub')).toHaveText('71% in USD');
  await expect(page.locator('#summary .card', { hasText: 'DAY P&L' }).locator('.value')).toHaveClass(/\bup\b/);
  await page.locator('#summary [data-cash-card]').first().click();
  await expect(page.locator('#cash-modal')).toBeVisible();
});

test('ADD, SELL, CASH, import and UNDO update summary, positions, dividends and FX risk', async ({ page }) => {
  test.setTimeout(60_000);
  await seeded(page);
  await expect(netWorth(page)).toHaveText('S$92,967.48');
  await expect(page.locator('#dividends')).toContainText('FORWARD / YR');
  const div0 = await text(page, '#dividends'), fx0 = await text(page, '#fxrisk');

  await cmd(page, 'ADD AAPL 10 100');                // +10 × 231.50 USD × 1.29
  await expect(netWorth(page)).toHaveText('S$95,953.83');
  await expect(fxCard(page).locator('.value')).toHaveText('S$69.32K');
  await expect(qtyCell(page, 'AAPL')).toHaveText('35');
  await expect.poll(() => text(page, '#dividends')).not.toBe(div0);
  await expect.poll(() => text(page, '#fxrisk')).not.toBe(fx0);
  const div1 = await text(page, '#dividends');

  await cmd(page, 'SELL AAPL 10');
  await expect(qtyCell(page, 'AAPL')).toHaveText('25');
  await expect(netWorth(page)).toHaveText('S$92,967.48');
  await expect(fxCard(page).locator('.value')).toHaveText('S$66.33K');
  await expect.poll(() => text(page, '#dividends')).not.toBe(div1); // FIFO sale changes cost, so yield-on-cost differs from div0

  await cmd(page, 'CASH USD 1000');
  await expect(netWorth(page)).toHaveText('S$94,257.48');
  await expect(page.locator('#summary .card', { hasText: 'NET WORTH' }).locator('.sub')).toHaveText('incl. cash S$1.29K');

  await page.click('#import-btn');
  await page.fill('#import-text', 'symbol,quantity,avg price\nAMD,10,150');
  await page.click('#import-do');
  await expect(rows(page)).toHaveCount(10);
  await expect(netWorth(page)).toHaveText('S$96,356.31');

  await cmd(page, 'UNDO');
  await expect(page.locator('#cmd-status')).toContainText('UNDID:');
  await expect(rows(page)).toHaveCount(9);
  await expect(netWorth(page)).toHaveText('S$94,257.48');
  await cmd(page, 'CASH USD 0');
  await expect(netWorth(page)).toHaveText('S$92,967.48');
});

test('the open ledger refreshes after a ledger undo, with summary and positions', async ({ page }) => {
  await seeded(page);
  await cmd(page, 'ADD MSFT 2 400');
  await expect(qtyCell(page, 'MSFT')).toHaveText('20');
  await cmd(page, 'LEDGER');
  const ledger = page.locator('#ledger-body tr');
  await expect(ledger).toHaveCount(10);
  await page.click('#ledger-undo');
  await expect(ledger).toHaveCount(9);
  await expect(qtyCell(page, 'MSFT')).toHaveText('18');
  await expect(netWorth(page)).toHaveText('S$92,967.48');
});

test('account and base switches re-key the summary; a slow old-account response never shows', async ({ page }) => {
  await page.request.post('/api/accounts/add', { data: { name: 'Empty' } });
  await seeded(page); // seeded() removes extra accounts; add one after it
  await page.request.post('/api/accounts/add', { data: { name: 'Empty' } });
  await page.reload();
  const sel = page.locator('#account-sel');
  const first = (await sel.locator('option').nth(1).getAttribute('value'))!;
  await sel.selectOption(first);
  await expect(netWorth(page)).toHaveText('S$92,967.48');

  // Hold the next portfolio responses for the first account, then switch away.
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  await page.route(`**/api/portfolio?base=SGD&account=${first}`, async (route) => { await held; await route.continue(); });
  await page.evaluate(() => { void (window as any).loadPortfolio(); }); // legacy-any: the 15 s poll
  await sel.selectOption({ label: 'Empty' });
  await expect(netWorth(page)).toHaveText('S$0.00');
  await expect(page.locator('#positions-body')).toContainText('No positions yet');
  release();
  await page.waitForTimeout(1000);
  await expect(netWorth(page)).toHaveText('S$0.00');
  await expect(page.locator('#positions-body')).toContainText('No positions yet');
  await page.unroute(`**/api/portfolio?base=SGD&account=${first}`);

  await sel.selectOption(first);
  await expect(netWorth(page)).toHaveText('S$92,967.48');
  await page.selectOption('#base-ccy', 'USD');
  await expect(netWorth(page)).toHaveText('$72,067.81');
  await expect(fxCard(page).locator('.sub')).toContainText('in SGD');
  await page.selectOption('#base-ccy', 'SGD');
  await expect(netWorth(page)).toHaveText('S$92,967.48');
});

test('card editor: toggle, reorder and reset update the React summary and persist', async ({ page }) => {
  await seeded(page);
  const labels = () => page.locator('#summary .card .label').allInnerTexts();
  await expect.poll(async () => (await labels())[0]).toBe('NET WORTH');
  await page.click('#cards-btn');
  await page.locator('#cards-list input[data-id="cost_basis"]').check();
  await expect.poll(labels).toContain('COST BASIS');
  await page.locator('#cards-list button[data-dir="down"][data-id="net_worth"]').click();
  await expect.poll(async () => (await labels())[0]).toBe('TOTAL VALUE');
  await page.click('#cards-done');
  await page.reload();
  await expect.poll(async () => (await labels())[0]).toBe('TOTAL VALUE');
  await expect.poll(labels).toContain('COST BASIS');
  await page.click('#cards-btn');
  await page.click('#cards-reset');
  await expect.poll(labels).not.toContain('COST BASIS');
  await expect.poll(async () => (await labels())[0]).toBe('NET WORTH');
});
