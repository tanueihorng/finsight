import { test, expect } from '@playwright/test';
import { unlock, seed } from '../helpers';

test.beforeEach(async ({ page }) => { await unlock(page); await seed(page); await page.reload(); });

test('clicking a position changes the detail title and draws a chart canvas', async ({ page }) => {
  await expect(page.locator('#detail-title')).toHaveText('VOO · DETAIL');
  await page.locator('#positions-body tr[data-sym="MSFT"] td').first().click();
  await expect(page.locator('#detail-title')).toHaveText('MSFT · DETAIL');
  await expect(page.locator('#detail-body canvas').first()).toBeAttached();
});
