// F7: the command bar. Written against legacy first. Every command in the
// HELP line, its usage error, the status line and the footer message.
import { test, expect, type Page } from '@playwright/test';
import { seeded, cmd } from './helpers';

const status = (page: Page) => page.locator('#cmd-status');
const qty = (page: Page, sym: string) => page.locator(`#positions-body tr[data-sym="${sym}"] td`).nth(1);
const ok = async (page: Page, text: string | RegExp) => { await expect(status(page)).toHaveText(text); await expect(status(page)).toHaveClass('cmd-status ok'); };
const err = async (page: Page, text: string | RegExp) => { await expect(status(page)).toHaveText(text); await expect(status(page)).toHaveClass('cmd-status err'); };

test('HELP and ?, CLEAR, Enter and GO both run and clear the input, blank does nothing', async ({ page }) => {
  await seeded(page);
  await cmd(page, 'help');
  await ok(page, 'ADD <s> <qty> <px> [date] · SELL <s> <qty> [px] · DEL <s> · UNDO · LEDGER · CASH <ccy> <amt> · WHT <mkt> <%> · Q <s> · WATCH/UNWATCH <s> · ALERT <s> > <px> · NEWS [s] · MKT · CLEAR');
  await expect(page.locator('#cmd')).toHaveValue('');
  await cmd(page, 'CLEAR');
  await expect(status(page)).toHaveText('');
  await page.fill('#cmd', '?');
  await page.click('#cmd-go');
  await expect(status(page)).toContainText('ADD <s> <qty>');
  await expect(page.locator('#cmd')).toHaveValue('');
  await cmd(page, '   ');
  await expect(status(page)).toContainText('ADD <s> <qty>');
});

test('usage errors for every command that needs arguments', async ({ page }) => {
  await seeded(page);
  const cases: [string, string][] = [
    ['ADD AAPL 1', 'Usage: ADD <symbol> <qty> <avg price> [YYYY-MM-DD]   e.g. ADD AAPL 10 195.50'],
    ['BUY', 'Usage: ADD <symbol> <qty> <avg price> [YYYY-MM-DD]   e.g. ADD AAPL 10 195.50'],
    ['SELL AAPL', 'Usage: SELL <symbol> <qty> [price]   (price optional → uses market)'],
    ['DEL', 'Usage: DEL <symbol>'], ['remove', 'Usage: DEL <symbol>'],
    ['Q', 'Usage: Q <symbol>'], ['QUOTE', 'Usage: Q <symbol>'],
    ['WATCH', 'Usage: WATCH <symbol>'], ['UNWATCH', 'Usage: UNWATCH <symbol>'],
    ['ALERT AAPL >', 'Usage: ALERT <symbol> > <price>   (use > or <)'],
    ['CASH USD', 'Usage: CASH <currency> <amount>   e.g. CASH USD 5000   (0 clears it)'],
    ['WHT US', 'Usage: WHT <US|SG|HK|UK|EU|JP|AU|CA|OTHER> <percent>   e.g. WHT US 15'],
  ];
  for (const [text, msg] of cases) { await cmd(page, text); await err(page, msg); }
});

test('ADD with a date, SELL at market, DEL; All Accounts blocks ADD and CASH; server errors show ERROR', async ({ page }) => {
  await seeded(page);
  await cmd(page, 'buy amd 2 150 2025-01-02');
  await ok(page, 'BOUGHT 2 AMD @ 150 on 2025-01-02');
  await expect(qty(page, 'AMD')).toHaveText('2');
  await cmd(page, 'SELL amd 1');
  await expect(status(page)).toHaveText(/^SOLD 1 AMD {2}· {2}realized [+-]?[\d,.]+ $/);
  await expect(qty(page, 'AMD')).toHaveText('1');
  await cmd(page, 'DELETE amd');
  await ok(page, 'REMOVED AMD from portfolio');
  await expect(page.locator('#positions-body tr[data-sym="AMD"]')).toHaveCount(0);
  await cmd(page, 'SELL NOPE 1');
  await err(page, /^ERROR: /);

  await page.request.post('/api/accounts/add', { data: { name: 'Second' } });
  await page.reload();
  await page.locator('#account-sel').selectOption('ALL');
  await cmd(page, 'ADD AAPL 1 1');
  await err(page, 'Switch from "All Accounts" to a specific account to add or trade.');
  await cmd(page, 'CASH USD 1');
  await err(page, 'Switch from "All Accounts" to a specific account to add or trade.');
});

test('Q, bare symbols and NEWS select; NEWS alone shows market news; MKT refreshes markets', async ({ page }) => {
  await seeded(page);
  await cmd(page, 'q msft');
  await ok(page, 'Loading MSFT…');
  await expect(page.locator('#detail-title')).toHaveText('MSFT · DETAIL');
  await cmd(page, 'nvda');
  await ok(page, 'Loading NVDA…');
  await expect(page.locator('#detail-title')).toHaveText('NVDA · DETAIL');
  await cmd(page, 'NEWS aapl');
  await ok(page, 'Loading news…');
  await expect(page.locator('#detail-title')).toHaveText('AAPL · DETAIL');
  await expect(page.locator('#news-sym')).toHaveText('AAPL');
  const general = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/news' && !new URL(r.url()).searchParams.has('symbol'));
  await cmd(page, 'NEWS');
  await general;
  await expect(page.locator('#news-sym')).toHaveText('market');
  await expect(page.locator('#detail-title')).toHaveText('AAPL · DETAIL');
  const mkt = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/markets');
  await cmd(page, 'markets');
  await mkt;
  await ok(page, 'Refreshing world markets…');
});

test('WATCH/UNWATCH, ALERT (below wording), WHT, LEDGER/TRADES, UNDO, CASH', async ({ page }) => {
  await seeded(page);
  await cmd(page, 'watch tsla');
  await ok(page, 'Watching TSLA');
  await expect(page.locator('#watchlist')).toContainText('TSLA');
  await cmd(page, 'UNWATCH tsla');
  await ok(page, 'Unwatched TSLA');
  await expect(page.locator('#watchlist')).not.toContainText('TSLA');
  await cmd(page, 'ALERT aapl below 100');
  await ok(page, 'Alert set: AAPL < 100');
  await expect(page.locator('#alerts')).toContainText('AAPL');
  await cmd(page, 'WHT us 30');
  await ok(page, 'Dividend withholding for US set to 30%');
  await cmd(page, 'WHT US 15');
  await cmd(page, 'TRADES');
  await expect(page.locator('#ledger-modal')).toBeVisible();
  await page.click('#ledger-close');
  await cmd(page, 'CASH usd 100');
  await ok(page, 'Cash USD set to 100.00');
  await cmd(page, 'UNDO');
  await ok(page, /^UNDID: /);
  await expect(page.locator('#summary')).toContainText('S$92,967.48');
  for (const a of (await (await page.request.get('/api/alerts')).json()).alerts) await page.request.post('/api/alerts/remove', { data: { id: a.id } });
  await page.reload();
});

test('the footer shows the ready line and FX coverage notes', async ({ page }) => {
  await seeded(page);
  await expect(page.locator('#footer-msg')).toHaveText('READY · base SGD · live data refreshing every 15s');
  await page.route('**/api/portfolio?*', async (route) => {
    const res = await route.fetch(), body = await res.json();
    body.fxMissing = ['XYZ'];
    await route.fulfill({ response: res, json: body });
  });
  await page.evaluate(() => window.FinSight.bus.invalidate('portfolio'));
  await expect(page.locator('#footer-msg')).toHaveText('Note: no FX rate for XYZ → shown unconverted.');
});
