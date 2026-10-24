import { test, expect } from '@playwright/test';
import { unlock } from '../helpers';

test('hiding a panel in ⚙ Layout persists after reload', async ({ page }) => {
  await unlock(page);
  const news = page.locator('.panel[data-pid="news"]');
  await expect(news).toBeVisible();
  await page.click('#cards-btn');
  await page.locator('#panels-list input[data-panel="news"]').uncheck();
  await page.click('#cards-done');
  await expect(news).toBeHidden();
  await page.reload();
  await expect(page.locator('body')).not.toHaveClass(/\blocked\b/);
  await expect(news).toBeHidden();
  await expect(page.locator('.panel[data-pid="markets"]')).toBeVisible();
});
