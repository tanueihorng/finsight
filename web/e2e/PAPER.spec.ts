// FEAT-012 paper trading: REAL/PAPER switch in the top bar and on the lock
// screen, Alpaca paper connect (offline fake broker), the trade desk (chart
// linked to the ticket, fills and open limit orders on it), an order that
// fills and lands in the book, and Kestrel's order as a live pending ticket
// the user approves, and the desk's watchlist, key stats and news before
// any keys are entered. The book choice is server-wide, so every test returns to REAL.
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { unlock, PIN } from './helpers.ts';

const KEY = { keyId: 'PKE2ETEST1234567890', secret: 'e2eSecretKey0123456789abcdefghijklmnopq' };
const agentToken = () => JSON.parse(fs.readFileSync(path.join(process.env.FINSIGHT_E2E_DIR!, 'agent-link.json'), 'utf8')).token as string;

async function toPaper(page: Page) {
  await page.locator('#book-paper').click();
  await expect(page.locator('html')).toHaveAttribute('data-book', 'paper');
  await expect(page.locator('.brand-paper')).toBeVisible();
}
test.afterEach(async ({ page }) => {
  await page.request.post('/api/paper/disconnect');
  await page.request.post('/api/book', { data: { book: 'real' } });
});

test('switch to PAPER, connect, place an order and see it fill into the book', async ({ page }) => {
  await unlock(page);
  await expect(page.locator('#paper-panel')).toBeHidden();
  await toPaper(page);
  const panel = page.locator('#paper-panel');
  await expect(panel).toBeVisible();
  await expect(page.locator('#cash-btn')).toBeHidden();

  await panel.getByLabel('API key id').fill('AKLIVE1234567890ABCD');
  await panel.getByLabel('Secret key').fill(KEY.secret);
  await panel.getByRole('button', { name: 'Connect paper' }).click();
  await expect(panel.getByRole('alert')).toContainText('live-trading key');
  await panel.getByLabel('API key id').fill(KEY.keyId);
  await panel.getByRole('button', { name: 'Connect paper' }).click();
  await expect(panel).toContainText('Order stream live');

  await page.locator('#paper-symbol').fill('aapl');
  await page.locator('#paper-symbol').press('Enter');
  await page.locator('#paper-amount').fill('3');
  await expect(panel.getByRole('form', { name: 'Paper order ticket' })).toContainText(/Est\. cost\s*US\$694\.50/);
  await expect(page.locator('#paper-submit')).toHaveText('Buy 3 AAPL');
  await page.locator('#paper-submit').click();
  await panel.getByRole('tab', { name: 'History' }).click();
  await expect(panel.getByRole('region', { name: 'Recent paper orders' })).toContainText(/BUY 3 AAPL · market · day\s*3 @ 231\.50/);
  await panel.getByRole('tab', { name: /Positions/ }).click();
  await expect(panel.getByRole('region', { name: 'Paper positions' })).toContainText('AAPL');
  await expect(page.locator('#positions-view')).toContainText('AAPL');
});

test('the desk chart follows the ticket and shows fills and open limit orders', async ({ page }) => {
  await unlock(page);
  await toPaper(page);
  expect((await page.request.post('/api/paper/connect', { data: KEY })).ok()).toBe(true);
  await page.reload();
  const panel = page.locator('#paper-panel');
  const chart = () => page.evaluate(() => {
    const c = (document.querySelector('#paper-chart .pc-root') as unknown as { __priceChart: { symbol: string; tradeData: { trades?: unknown[]; orders?: { side: string; price: number }[] } | null } }).__priceChart;
    return { symbol: c.symbol, trades: c.tradeData?.trades?.length ?? 0, orders: c.tradeData?.orders ?? [] };
  });
  await page.locator('#paper-symbol').fill('MSFT');
  await page.locator('#paper-symbol').press('Enter');
  await expect.poll(async () => (await chart()).symbol).toBe('MSFT');
  await page.locator('#paper-amount').fill('2');
  await page.locator('#paper-submit').click();
  await expect.poll(async () => (await chart()).trades).toBe(1);

  await panel.getByRole('button', { name: 'Limit', exact: true }).click();
  await panel.getByLabel('Limit price').fill('300');
  await page.locator('#paper-amount').fill('1');
  await page.locator('#paper-submit').click();
  await expect.poll(async () => (await chart()).orders).toEqual([{ side: 'buy', price: 300, label: 'BUY LMT 1 @ 300.00' }]);
  await panel.getByRole('tab', { name: /Open orders/ }).click();
  const open = panel.getByRole('region', { name: 'Open paper orders' });
  await open.getByRole('button', { name: 'Cancel' }).click();
  await expect(open).toContainText('No open orders.');
  await expect.poll(async () => (await chart()).orders).toEqual([]);
});

test('Kestrel\'s order waits as a live ticket until the user approves it', async ({ page }) => {
  await unlock(page);
  await toPaper(page);
  expect((await page.request.post('/api/paper/connect', { data: KEY })).ok()).toBe(true);
  await page.reload();
  const panel = page.locator('#paper-panel');
  await expect(panel).toContainText('Order stream live');

  const r = await page.request.post('/api/paper/orders', { headers: { authorization: `Bearer ${agentToken()}` },
    data: { symbol: 'MSFT', side: 'buy', qty: 2, note: 'E2E: Kestrel proposes MSFT' } });
  expect((await r.json()).pendingApproval).toBe(true);
  const pending = panel.getByRole('region', { name: 'Kestrel orders awaiting approval' });
  await expect(pending).toContainText('BUY 2 MSFT'); // arrives over the event stream, no reload
  await expect(pending).toContainText('E2E: Kestrel proposes MSFT');
  await pending.getByRole('button', { name: 'Approve' }).click();
  await expect(pending).toBeHidden();
  await panel.getByRole('tab', { name: 'History' }).click();
  const recent = panel.getByRole('region', { name: 'Recent paper orders' });
  await expect(recent.locator('tr').filter({ hasText: 'KESTREL' }).filter({ hasText: 'BUY 2 MSFT' })).toContainText('2 @'); // the earlier test also traded MSFT
});

test('the lock screen opens the terminal in the chosen book', async ({ page }) => {
  await unlock(page);
  await toPaper(page);
  await page.click('#lock-btn');
  await expect(page.locator('#lock-book-paper')).toHaveAttribute('aria-pressed', 'true');
  await page.locator('#lock-book-real').click();
  await page.locator('#lock-pin').fill(PIN);
  await page.locator('#lock-go').click();
  await expect(page.locator('html')).toHaveAttribute('data-book', 'real');
  await expect(page.locator('.brand-real')).toBeVisible();
  await expect(page.locator('body')).not.toHaveClass(/\blocked\b/);
});

test('before connecting, the desk still shows a watchlist, key stats, news and follows the terminal', async ({ page }) => {
  await unlock(page);
  await toPaper(page);
  const panel = page.locator('#paper-panel');
  await expect(panel).toContainText('Not connected');
  await expect(panel.getByRole('form', { name: 'Connect Alpaca paper' })).toBeVisible();
  const watch = panel.getByRole('complementary', { name: 'Watchlist' });

  await page.locator('#paper-watch-add').fill('aapl');
  await page.locator('#paper-watch-add').press('Enter');
  await expect(watch.getByRole('button', { name: /^AAPL/ })).toBeVisible();
  await expect(panel.getByRole('button', { name: '★ Watching' })).toHaveAttribute('aria-pressed', 'true');
  await expect(panel.locator('dl[aria-label="AAPL key stats"]')).toContainText('Mkt cap');
  await panel.getByRole('tab', { name: 'News' }).click();
  await expect(panel.getByRole('region', { name: 'AAPL news' }).getByRole('link').first()).toBeVisible();

  // A symbol picked elsewhere in the terminal becomes the desk's symbol.
  await page.evaluate(() => (window as unknown as { FinSight: { store: { setState: (s: object) => void } } }).FinSight.store.setState({ selected: 'MSFT' }));
  await expect(panel.locator('dl[aria-label="MSFT key stats"]')).toBeVisible();
  await panel.getByRole('button', { name: '☆ Watch' }).click();
  await expect(watch.getByRole('button', { name: /^MSFT/ })).toBeVisible();
  await watch.getByRole('button', { name: 'Remove AAPL from the watchlist' }).click();
  await watch.getByRole('button', { name: 'Remove MSFT from the watchlist' }).click();
  await expect(watch).toContainText('Add symbols above');
});
