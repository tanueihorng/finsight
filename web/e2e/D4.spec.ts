// D4: ledger + CSV import/export. Written against legacy first.
import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { seeded, cmd, unlock, answerDialog } from './helpers';

const body = (page: Page) => page.locator('#ledger-body');
const lstatus = (page: Page) => page.locator('#ledger-status');

test('ledger: open from LEDGER button, filter by type, cancel an edit, dismiss a delete, backdrop closes', async ({ page }) => {
  await seeded(page);
  await cmd(page, 'SELL AAPL 5 250');
  await page.click('#ledger-btn');
  await expect(page.locator('#ledger-modal')).toBeVisible();
  await expect(page.locator('#ledger-tabs button.active')).toHaveText('TRADES');
  await expect(body(page).locator('tr')).toHaveCount(10);
  await page.fill('#ledger-filter', 'SELL');
  await expect(body(page).locator('tr')).toHaveCount(1);
  const sell = body(page).locator('tr').first();
  await expect(sell.locator('td').nth(1)).toHaveText('SELL');
  await expect(sell.locator('td').nth(1)).toHaveClass('t-sell');
  await expect(sell.locator('td').nth(3)).toHaveText('5');
  await expect(sell.locator('td').nth(4)).toHaveText('250.00 USD');
  await expect(sell.locator('[data-act]')).toHaveCount(0); // sells are not editable
  await page.fill('#ledger-filter', 'zzz');
  await expect(body(page)).toHaveText('No transactions.');

  await page.fill('#ledger-filter', 'msft');
  await body(page).locator('[data-act="edit"]').click();
  await expect(body(page).locator('.le-date')).toHaveValue('2025-01-15');
  await expect(body(page).locator('.le-qty')).toHaveValue('18');
  await body(page).locator('[data-act="cancel"]').click();
  await expect(body(page).locator('.le-date')).toHaveCount(0);
  await body(page).locator('[data-act="delete"]').click();
  await answerDialog(page, { accept: false });
  await expect(body(page).locator('tr')).toHaveCount(1);
  await expect(lstatus(page)).toHaveText('');

  await page.locator('#ledger-modal').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#ledger-modal')).toBeHidden();
});

test('ledger: edit a date, realized tab and its CSV, ↶ UNDO refreshes the open ledger', async ({ page }) => {
  await seeded(page);
  await cmd(page, 'SELL NVDA 10 200');
  await cmd(page, 'LEDGER');
  await page.fill('#ledger-filter', 'TSM');
  await body(page).locator('[data-act="edit"]').click();
  await body(page).locator('.le-date').fill('2025-03-10');
  await body(page).locator('.le-qty').fill('41');
  await body(page).locator('[data-act="save"]').click();
  await expect(lstatus(page)).toHaveText('Updated TSM buy. UNDO reverts it.');
  await expect(body(page).locator('tr td').first()).toHaveText('Mar 10, 25');
  await expect(page.locator('#positions-body tr[data-sym="TSM"] td').nth(1)).toHaveText('41');

  await page.click('#ledger-tabs [data-tab="realized"]');
  await expect(page.locator('#ledger-tabs button.active')).toHaveText('REALIZED GAINS');
  await expect(page.locator('#ledger-trades')).toBeHidden();
  const rz = page.locator('#ledger-realized');
  await expect(rz.locator('table').first().locator('tbody tr')).toHaveCount(1);
  await expect(rz).toContainText('CLOSED TRADES');
  await expect(rz.locator('table').nth(1).locator('tbody tr td').nth(1)).toHaveText('NVDA');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#rz-export')]);
  expect(download.suggestedFilename()).toBe('realized-gains.csv');
  const lines = fs.readFileSync(await download.path(), 'utf8').split('\n');
  expect(lines[0]).toBe('date,symbol,quantity,price,currency,proceeds_sgd,cost_sgd,stock_pnl_sgd,fx_pnl_sgd,realized_sgd,held_days');
  expect(lines[1]).toMatch(/^\d{4}-\d{2}-\d{2},NVDA,10,200,USD,/);

  await page.click('#ledger-tabs [data-tab="trades"]');
  await page.fill('#ledger-filter', 'TSM');
  await page.click('#ledger-undo');
  await expect(page.locator('#cmd-status')).toHaveText(/^UNDID: /);
  await expect(page.locator('#positions-body tr[data-sym="TSM"] td').nth(1)).toHaveText('40');
  await expect(body(page).locator('.le-date')).toHaveCount(0);
  await expect(body(page).locator('tr td').first()).toHaveText('Mar 03, 25');
});

test('ledger in All Accounts shows each trade\'s account', async ({ page }) => {
  await seeded(page);
  await page.request.post('/api/accounts/add', { data: { name: 'Second' } });
  await page.reload();
  await page.locator('#account-sel').selectOption('ALL');
  await cmd(page, 'LEDGER');
  await page.fill('#ledger-filter', 'VOO');
  await expect(body(page).locator('tr td').first().locator('.dim')).toHaveText('Main');
});

test('import: needs text, refuses All Accounts, reads a file, reports failures; CLEAR ALL empties', async ({ page }) => {
  await seeded(page);
  await page.click('#import-btn');
  await expect(page.locator('#import-modal')).toBeVisible();
  await expect(page.locator('#import-text')).toBeFocused();
  await page.click('#import-do');
  await expect(page.locator('#import-status')).toHaveText('Paste CSV or choose a file first.');
  await page.locator('#import-file').setInputFiles({ name: 'h.csv', mimeType: 'text/csv', buffer: Buffer.from('symbol,quantity,avg price\nAMD,3,100') });
  await expect(page.locator('#import-text')).toHaveValue('symbol,quantity,avg price\nAMD,3,100');
  await page.route('**/api/portfolio/import*', (r) => r.fulfill({ status: 400, json: { error: 'No rows' } }));
  await page.click('#import-do');
  await expect(page.locator('#import-status')).toHaveText('Import failed: No rows');
  await expect(page.locator('#import-status')).toHaveClass(/\berr\b/);
  await page.unroute('**/api/portfolio/import*');
  await page.click('#import-close');
  await expect(page.locator('#import-modal')).toBeHidden();

  await page.request.post('/api/accounts/add', { data: { name: 'Second' } });
  await page.reload();
  await page.locator('#account-sel').selectOption('ALL');
  await page.click('#import-btn');
  await page.fill('#import-text', 'AMD,1,1');
  await page.click('#import-do');
  await expect(page.locator('#import-status')).toHaveText('Switch to a specific account first (ACCT, top-right).');
  await page.locator('#import-modal').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#import-modal')).toBeHidden();

  await page.locator('#account-sel').selectOption({ label: 'Main (9)' });
  await expect(page.locator('#positions-body tr[data-sym]')).toHaveCount(9);
  await page.click('#positions-body tr[data-sym="NVDA"]');
  await page.click('#import-btn');
  await page.click('#import-clear');
  await answerDialog(page, { title: /Clear ALL positions/ });
  await expect(page.locator('#import-status')).toHaveText('Portfolio cleared.');
  await expect(page.locator('#positions-body')).toContainText('No positions yet');
  expect(await page.evaluate(() => window.FinSight.store.getState().selected)).toBeNull();
});

test('export of an empty portfolio says so', async ({ page }) => {
  await seeded(page);
  await page.request.post('/api/portfolio/reset?base=SGD');
  await page.click('#export-btn');
  await expect(page.locator('#footer-msg')).toHaveText('Nothing to export — portfolio is empty.');
});

test('the setup wizard\'s import choice opens the import modal', async ({ page }) => {
  await unlock(page, { wizard: true });
  await page.evaluate(() => localStorage.removeItem('finsight-profile'));
  await page.reload();
  await page.click('.setup-choice[data-action="import"]');
  await expect(page.locator('#import-modal')).toBeVisible();
});
