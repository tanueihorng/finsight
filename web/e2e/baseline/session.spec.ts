import { test, expect } from '@playwright/test';
import { seeded, PIN } from '../helpers';

test('an expired session locks the app, stops polling, keeps a typed PIN, and unlock resumes', async ({ page, context }) => {
  test.setTimeout(60_000);
  await seeded(page);
  await context.clearCookies(); // the server no longer knows this browser
  // The next API call gets 401 (a poll may get there first; either way the app locks).
  await page.evaluate(() => { void (window as any).loadMarkets(); }); // legacy-any
  await expect(page.locator('body')).toHaveClass(/\blocked\b/);
  await expect(page.locator('#lock-title')).toHaveText('Enter your PIN');

  // Type part of the PIN, then sit through a full 15 s poll cycle.
  await page.fill('#lock-pin', PIN.slice(0, 2));
  const calls: string[] = [];
  page.on('request', (r) => { const p = new URL(r.url()).pathname; if (p.startsWith('/api/') && !p.startsWith('/api/auth/')) calls.push(p); });
  await page.waitForTimeout(16_000);
  expect(calls).toEqual([]);
  await expect(page.locator('#lock-pin')).toHaveValue(PIN.slice(0, 2));

  const resumed = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/portfolio');
  await page.locator('#lock-pin').pressSequentially(PIN.slice(2));
  await page.press('#lock-pin', 'Enter');
  await expect(page.locator('body')).not.toHaveClass(/\blocked\b/);
  await resumed;
  await expect(page.locator('#positions-body tr[data-sym]')).toHaveCount(9);
});
