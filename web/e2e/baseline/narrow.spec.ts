import { test, expect } from '@playwright/test';
import { seeded } from '../helpers';

test.use({ viewport: { width: 390, height: 844 } });

test('narrow screen: core panels render without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await seeded(page);
  await expect(page.locator('#summary')).toContainText('S$92,967.48');
  await expect(page.locator('#positions-body tr[data-sym]').first()).toBeVisible();
  await expect(page.locator('#cmd')).toBeVisible();
  await expect(page.locator('.panel[data-pid="markets"]')).toBeAttached();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(errors).toEqual([]);
});
