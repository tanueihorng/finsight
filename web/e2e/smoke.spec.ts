import { test, expect } from '@playwright/test';
import { unlock } from './helpers';

test('loads / and unlocks', async ({ page }) => {
  await unlock(page);
  await expect(page.locator('#lock-screen')).toBeHidden();
});

test('the island bundle loads without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const loaded = ['/app/main.js', '/app/main.css'].map((p) =>
    page.waitForResponse((r) => new URL(r.url()).pathname === p));
  await unlock(page);
  for (const r of await Promise.all(loaded)) expect(r.status(), r.url()).toBe(200);
  expect(errors).toEqual([]);
});
