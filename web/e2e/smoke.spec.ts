import { test, expect } from '@playwright/test';
import { unlock } from './helpers';

test('loads / and unlocks', async ({ page }) => {
  await unlock(page);
  await expect(page.locator('#lock-screen')).toBeHidden();
});
