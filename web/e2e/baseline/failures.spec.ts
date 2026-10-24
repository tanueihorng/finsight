import { test, expect } from '@playwright/test';
import { unlock, seeded, cmd } from '../helpers';

test('empty portfolio: clear all positions', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seeded(page);
  await page.click('#import-btn');
  page.once('dialog', (d) => { expect(d.message()).toContain('Clear ALL positions'); d.accept(); });
  await page.click('#import-clear');
  await expect(page.locator('#import-status')).toHaveText('Portfolio cleared.');
  await expect(page.locator('#positions-body')).toContainText('No positions yet');
  await expect(page.locator('#summary')).toContainText('S$0.00');
  expect(errors).toEqual([]);
});

test('a failing market feed leaves the rest of the page working', async ({ page }) => {
  await page.route('**/api/markets', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"upstream down"}' }));
  await seeded(page);
  await expect(page.locator('#markets')).not.toContainText('S&P 500');
  await expect(page.locator('#summary')).toContainText('S$92,967.48');
  await expect(page.locator('#news')).not.toBeEmpty();
});

test('a holding with no quote is valued at its cost', async ({ page }) => {
  await seeded(page);
  await cmd(page, 'ADD ZZZZ 10 5');
  await expect(page.locator('#cmd-status')).toHaveText('BOUGHT 10 ZZZZ @ 5');
  const row = page.locator('#positions-body tr[data-sym="ZZZZ"]');
  await expect(row).toHaveCount(1);
  await expect(row.locator('td').nth(3)).toHaveText('5.00'); // LAST falls back to the avg price
  await expect(page.locator('#positions-body tr[data-sym]')).toHaveCount(10);
});
