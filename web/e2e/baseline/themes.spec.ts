import { test, expect } from '@playwright/test';
import { unlock } from '../helpers';

test('switching theme changes data-theme', async ({ page }) => {
  await unlock(page);
  const html = page.locator('html');
  await expect(html).toHaveAttribute('data-theme', 'violet');
  await page.click('#cards-btn');
  const other = page.locator('#theme-list [data-theme]:not([data-theme="violet"])').first();
  const id = await other.getAttribute('data-theme');
  await other.click();
  await expect(html).toHaveAttribute('data-theme', id!);
  await page.reload();
  await expect(html).toHaveAttribute('data-theme', id!);
});
