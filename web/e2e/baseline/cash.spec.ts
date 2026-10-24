import { test, expect } from '@playwright/test';
import { seeded, cmd } from '../helpers';

test.beforeEach(async ({ page }) => { await seeded(page); });

// Demo holdings are S$92,967.48; USD cash converts at the fixture 1.29.
test('CASH command sets and clears cash; net worth follows', async ({ page }) => {
  const summary = page.locator('#summary');
  await cmd(page, 'CASH USD 5000');
  await expect(page.locator('#cmd-status')).toHaveText('Cash USD set to 5,000.00');
  await expect(summary).toContainText('S$99,417.48');
  await cmd(page, 'CASH USD 0');
  await expect(page.locator('#cmd-status')).toHaveText('Cleared USD cash');
  await expect(summary).toContainText('S$92,967.48');
});

test('cash editor auto-saves and updates net worth', async ({ page }) => {
  await page.click('#cash-btn');
  await expect(page.locator('#cash-modal')).toBeVisible();
  await page.click('#cash-editor [data-add]');
  const row = page.locator('#cash-editor .cash-row').last();
  await row.locator('.cash-ccy').fill('SGD');
  await row.locator('.cash-amt').fill('1000');
  await row.locator('.cash-amt').blur();
  await expect(page.locator('#cash-status')).toHaveText('Saved ✓ · net worth updated');
  await page.click('#cash-save');
  await expect(page.locator('#cash-modal')).toBeHidden();
  await expect(page.locator('#summary')).toContainText('S$93,967.48');
});
