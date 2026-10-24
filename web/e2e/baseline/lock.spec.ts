import { test, expect } from '@playwright/test';
import { ensurePin, PIN } from '../helpers';

test('wrong PIN shows the error; the right PIN unlocks', async ({ page }) => {
  await ensurePin(page.request);
  await page.goto('/');
  await expect(page.locator('body')).toHaveClass(/\blocked\b/);
  await expect(page.locator('#lock-title')).toHaveText('Enter your PIN');
  await page.fill('#lock-pin', '0000');
  await page.click('#lock-go');
  await expect(page.locator('#lock-msg')).toHaveText('Wrong PIN');
  await page.fill('#lock-pin', PIN);
  await page.press('#lock-pin', 'Enter');
  await expect(page.locator('body')).not.toHaveClass(/\blocked\b/);
  await expect(page.locator('#lock-screen')).toBeHidden();
});
