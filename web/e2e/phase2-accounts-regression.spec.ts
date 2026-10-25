import { test, expect } from '@playwright/test';
import { seeded, cmd } from './helpers';

test('a newly created cash-only account is included in All Accounts wealth', async ({ page }) => {
  await seeded(page);
  await expect(page.locator('#wealth-body .w-total')).toHaveText('S$92,967.48');
  await page.waitForLoadState('networkidle');
  page.once('dialog', (d) => d.accept('Audit cash only'));
  await page.selectOption('#account-sel', '__new');
  await expect(page.locator('#positions-body')).toContainText('No positions yet');
  await cmd(page, 'CASH SGD 1000');
  await expect(page.locator('#wealth-body .w-total')).toHaveText('S$1,000.00');
  await page.selectOption('#account-sel', 'ALL');
  await expect(page.locator('#summary')).toContainText('S$93,967.48');
  await page.waitForLoadState('networkidle');
  await expect(page.locator('#wealth-body .w-total')).toHaveText('S$93,967.48', { timeout: 1500 });
});
