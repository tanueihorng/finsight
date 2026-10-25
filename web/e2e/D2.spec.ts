// D2: the add form + symbol search as a React island. Written against legacy first.
import { test, expect, type Page } from '@playwright/test';
import { seeded, unlock } from './helpers';

const qty = (page: Page, sym: string) => page.locator(`#positions-body tr[data-sym="${sym}"] td`).nth(1);

test('+ ADD toggles the form and focuses the symbol field', async ({ page }) => {
  await seeded(page);
  await expect(page.locator('#add-form')).toBeHidden();
  await page.click('#add-toggle');
  await expect(page.locator('#add-form')).toBeVisible();
  await expect(page.locator('#add-symbol')).toBeFocused();
  await expect(page.locator('#add-date')).toHaveAttribute('type', 'date');
  await page.click('#add-toggle');
  await expect(page.locator('#add-form')).toBeHidden();
});

test('symbol search: suggestions, keyboard pick, Escape, click outside, mouse pick', async ({ page }) => {
  await seeded(page);
  await page.click('#add-toggle');
  const box = page.locator('#add-suggest');
  await page.fill('#add-symbol', 'AM');
  await expect(box).toBeVisible();
  await expect(box.locator('div[data-i]')).toHaveText(['AMD Advanced Micro Devices, Inc. · NasdaqGS · EQUITY', 'AMZN Amazon.com, Inc. · NasdaqGS · EQUITY']);
  await page.press('#add-symbol', 'ArrowDown');
  await page.press('#add-symbol', 'ArrowDown');
  await expect(box.locator('div.active')).toHaveText(/^AMZN/);
  await page.press('#add-symbol', 'ArrowUp');
  await expect(box.locator('div.active')).toHaveText(/^AMD/);
  await page.press('#add-symbol', 'Enter');
  await expect(page.locator('#add-symbol')).toHaveValue('AMD');
  await expect(box).toBeHidden();
  await expect(page.locator('#add-qty')).toBeFocused();

  await page.fill('#add-symbol', 'TS');
  await expect(box.locator('div[data-i]').first()).toBeVisible();
  await page.press('#add-symbol', 'Escape');
  await expect(box).toBeHidden();
  await page.fill('#add-symbol', 'TSL');
  await expect(box).toBeVisible();
  await page.click('#summary');
  await expect(box).toBeHidden();
  await page.fill('#add-symbol', 'TSLA');
  await box.locator('div[data-i]').first().click();
  await expect(page.locator('#add-symbol')).toHaveValue('TSLA');
  await page.fill('#add-symbol', '');
  await expect(box).toBeHidden();
  await page.fill('#add-symbol', 'zzzz');
  await page.waitForTimeout(500);
  await expect(box).toBeHidden(); // no results
});

test('BUY validates, records the purchase, clears the form and refreshes the portfolio', async ({ page }) => {
  await seeded(page);
  await page.click('#add-toggle');
  await page.fill('#add-symbol', 'aapl');
  await page.click('#add-form button[type="submit"]');
  await expect(page.locator('#cmd-status')).toHaveText('Fill symbol, quantity and average price.');
  await expect(page.locator('#cmd-status')).toHaveClass(/\berr\b/);
  await page.fill('#add-qty', '5');
  await page.fill('#add-price', '200');
  await page.fill('#add-date', '2025-01-02');
  await page.press('#add-price', 'Enter');
  await expect(page.locator('#cmd-status')).toHaveText('BOUGHT 5 AAPL @ 200 on 2025-01-02');
  await expect(qty(page, 'AAPL')).toHaveText('30');
  for (const id of ['#add-symbol', '#add-qty', '#add-price', '#add-date']) await expect(page.locator(id)).toHaveValue('');
  await expect(page.locator('#add-form')).toBeVisible(); // stays open for the next entry
  await expect(page.locator('#summary')).not.toContainText('S$92,967.48');

  await page.fill('#add-symbol', 'AMD');
  await page.fill('#add-qty', '2');
  await page.fill('#add-price', '150');
  await page.press('#add-qty', 'Enter');
  await expect(page.locator('#cmd-status')).toHaveText('BOUGHT 2 AMD @ 150');
  await expect(qty(page, 'AMD')).toHaveText('2');
});

test('All Accounts blocks the form; a server error is reported', async ({ page }) => {
  await seeded(page);
  await page.request.post('/api/accounts/add', { data: { name: 'Second' } });
  await page.reload();
  await page.locator('#account-sel').selectOption('ALL');
  await page.click('#add-toggle');
  await page.fill('#add-symbol', 'AAPL');
  await page.fill('#add-qty', '1');
  await page.fill('#add-price', '1');
  await page.press('#add-price', 'Enter');
  await expect(page.locator('#cmd-status')).toHaveText('Switch from "All Accounts" to a specific account to add or trade.');
  await expect(page.locator('#add-symbol')).toHaveValue('AAPL'); // kept

  await page.locator('#account-sel').selectOption({ index: 1 });
  await page.route('**/api/portfolio/buy*', (r) => r.fulfill({ status: 400, json: { error: 'Bad price' } }));
  await page.press('#add-price', 'Enter');
  await expect(page.locator('#cmd-status')).toHaveText('ADD failed: Bad price');
  await expect(page.locator('#add-symbol')).toHaveValue('AAPL');
});

test('the setup wizard\'s "Add manually" opens the form with the symbol focused', async ({ page }) => {
  await unlock(page, { wizard: true });
  await page.evaluate(() => localStorage.removeItem('finsight-profile'));
  await page.reload();
  await expect(page.locator('#setup-modal')).toBeVisible();
  await page.click('.setup-choice[data-action="manual"]');
  await expect(page.locator('#setup-modal')).toBeHidden();
  await expect(page.locator('#add-form')).toBeVisible();
  await expect(page.locator('#add-symbol')).toBeFocused();
});
