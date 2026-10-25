// D3: undo + cash editor. Written against legacy first.
import { test, expect, type Page } from '@playwright/test';
import { seeded, cmd } from './helpers';

const qty = (page: Page, sym: string) => page.locator(`#positions-body tr[data-sym="${sym}"] td`).nth(1);
const status = (page: Page) => page.locator('#cmd-status');
const cashStatus = (page: Page) => page.locator('#cash-status');

test('↶ UNDO: hover shows the last change, click reverts it everywhere; nothing left is an error', async ({ page }) => {
  await seeded(page);
  await cmd(page, 'ADD AAPL 1 100');
  await expect(qty(page, 'AAPL')).toHaveText('26');
  await page.hover('#undo-btn');
  await expect(page.locator('#undo-btn')).toHaveAttribute('title', /^Undo: /);
  await page.click('#undo-btn');
  await expect(status(page)).toHaveText(/^UNDID: .+ · \d+ more step\(s\) available$/);
  await expect(status(page)).toHaveClass(/\bok\b/);
  await expect(qty(page, 'AAPL')).toHaveText('25');
  await expect(page.locator('#summary')).toContainText('S$92,967.48');
  await page.route('**/api/undo', (r) => r.request().method() === 'POST' ? r.fulfill({ status: 400, json: { error: 'Nothing to undo' } }) : r.fallback());
  await cmd(page, 'UNDO');
  await expect(status(page)).toHaveText('UNDO: Nothing to undo');
  await expect(status(page)).toHaveClass(/\berr\b/);
});

test('cash editor: opens from CASH and the NET WORTH card, validates, saves on Enter, ✕ removes, close saves pending', async ({ page }) => {
  await seeded(page);
  await page.click('#cash-btn');
  await expect(page.locator('#cash-modal')).toBeVisible();
  await expect(page.locator('#cash-editor .cash-acct-name')).toHaveText(['Main']);
  await expect(page.locator('#cash-editor .cash-row')).toHaveCount(0);
  await page.click('#cash-editor [data-add]');
  const row = page.locator('#cash-editor .cash-row').last();
  await expect(row.locator('.cash-ccy')).toHaveValue('SGD'); // new rows start in the base currency
  await expect(row.locator('.cash-amt')).toBeFocused();
  await row.locator('.cash-ccy').fill('US');
  await row.locator('.cash-amt').fill('5');
  await row.locator('.cash-amt').press('Enter');
  await expect(cashStatus(page)).toHaveText('Main: currency must be a 3-letter code (e.g. SGD)');
  await expect(cashStatus(page)).toHaveClass(/\berr\b/);
  await row.locator('.cash-ccy').fill('usd');
  await row.locator('.cash-amt').fill('abc');
  await row.locator('.cash-amt').press('Enter');
  await expect(cashStatus(page)).toHaveText('Main: "abc" is not a number');
  await row.locator('.cash-amt').fill('5,000');
  await row.locator('.cash-amt').press('Enter');
  await expect(cashStatus(page)).toHaveText('Saved ✓ · net worth updated');
  await expect(page.locator('#summary')).toContainText('S$99,417.48');

  // typing then closing with ✕ saves the pending edit
  await row.locator('.cash-amt').fill('1000');
  await expect(cashStatus(page)).toHaveText('Editing…');
  await page.click('#cash-close');
  await expect(page.locator('#cash-modal')).toBeHidden();
  await expect(page.locator('#summary')).toContainText('S$94,257.48');

  await page.locator('#summary [data-cash-card]').first().click();
  await expect(page.locator('#cash-modal')).toBeVisible();
  await expect(page.locator('#cash-editor .cash-amt')).toHaveValue('1000');
  await page.click('#cash-editor [data-del-a="0"][data-del-r="0"]');
  await expect(page.locator('#cash-editor .cash-row')).toHaveCount(0);
  await expect(cashStatus(page)).toHaveText('Saved ✓ · net worth updated');
  await expect(page.locator('#summary')).toContainText('S$92,967.48');
  await page.click('#cash-save');
  await expect(page.locator('#cash-modal')).toBeHidden();
});

test('All Accounts lists every account; a failed save is reported; reopening reloads', async ({ page }) => {
  await seeded(page);
  await page.request.post('/api/accounts/add', { data: { name: 'Second' } });
  await page.reload();
  await page.locator('#account-sel').selectOption('ALL');
  await page.click('#cash-btn');
  await expect(page.locator('#cash-editor .cash-acct-name')).toHaveText(['Main', 'Second']);
  await page.click('#cash-editor [data-add="1"]');
  const row = page.locator('#cash-editor .cash-acct').nth(1).locator('.cash-row');
  await row.locator('.cash-amt').fill('250');
  await row.locator('.cash-amt').blur();
  await expect(cashStatus(page)).toHaveText('Saved ✓ · net worth updated');
  await expect(page.locator('#summary')).toContainText('S$93,217.48');
  await page.route('**/api/cash*', (r) => r.fulfill({ status: 500, json: { error: 'disk full' } }));
  await row.locator('.cash-amt').fill('300');
  await row.locator('.cash-amt').blur();
  await expect(cashStatus(page)).toHaveText('Save failed: disk full');
  await page.unroute('**/api/cash*');
  await page.click('#cash-save'); // retries the save, then closes
  await expect(page.locator('#cash-modal')).toBeHidden();
  await expect(page.locator('#summary')).toContainText('S$93,267.48');
  await page.click('#cash-btn');
  await expect(page.locator('#cash-editor .cash-acct').nth(1).locator('.cash-amt')).toHaveValue('300');
  await page.click('#cash-editor [data-del-a="1"][data-del-r="0"]');
  await expect(cashStatus(page)).toHaveText('Saved ✓ · net worth updated');
  await page.click('#cash-save');
});

test('CASH command reports a server error', async ({ page }) => {
  await seeded(page);
  await page.route('**/api/cash*', (r) => r.fulfill({ status: 400, json: { error: 'Bad amount' } }));
  await cmd(page, 'CASH USD 10');
  await expect(status(page)).toHaveText('CASH failed: Bad amount');
});
