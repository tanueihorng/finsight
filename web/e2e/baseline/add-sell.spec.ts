import { test, expect } from '@playwright/test';
import { unlock, seed } from '../helpers';

test.beforeEach(async ({ page }) => { await unlock(page); await seed(page); await page.reload(); });

test('command bar ADD AAPL 1 100, then UNDO restores it', async ({ page }) => {
  const qty = page.locator('#positions-body tr[data-sym="AAPL"] td').nth(1);
  await expect(qty).toHaveText('25');
  await page.fill('#cmd', 'ADD AAPL 1 100');
  await page.press('#cmd', 'Enter');
  await expect(page.locator('#cmd-status')).toHaveText('BOUGHT 1 AAPL @ 100');
  await expect(qty).toHaveText('26');
  await page.fill('#cmd', 'UNDO');
  await page.press('#cmd', 'Enter');
  await expect(page.locator('#cmd-status')).toContainText('UNDID:');
  await expect(qty).toHaveText('25');
});
