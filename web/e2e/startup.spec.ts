// Startup fallback (X1 follow-up): the inline guard in index.html reveals a
// static retry message when the React app never renders (missing/truncated
// bundle, missing bootstrap), and a successful startup removes it. The faults
// are injected with request interception, so the shared server is untouched.
import { test, expect } from '@playwright/test';

const fallback = (page: import('@playwright/test').Page) => page.locator('#boot-fallback');

test('normal startup: React renders and the fallback is removed before it can appear', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#lock-screen')).toBeVisible(); // React rendered (PIN screen on a fresh session)
  await expect(fallback(page)).toHaveCount(0);
  // Still gone after the reveal deadline would have passed.
  await page.waitForTimeout(5500);
  await expect(fallback(page)).toHaveCount(0);
});

test('missing main bundle: the fallback appears with a retry, and a retry after recovery boots the app', async ({ page }) => {
  await page.route('**/app/main.js', (r) => r.fulfill({ status: 404, body: 'missing' }));
  await page.goto('/');
  await expect(fallback(page)).toBeVisible({ timeout: 9000 });
  await expect(fallback(page)).toContainText('FinSight could not start');
  await expect(fallback(page)).toContainText('Your data is safe');
  await expect(page.locator('#boot-retry')).toBeVisible();
  // Retry while still broken: the page reloads and the fallback comes back.
  await page.locator('#boot-retry').click();
  await expect(fallback(page)).toBeVisible({ timeout: 9000 });
  // The bundle is restored: retry boots the app and the fallback is gone.
  await page.unroute('**/app/main.js');
  await page.locator('#boot-retry').click();
  await expect(page.locator('#lock-screen')).toBeVisible();
  await expect(fallback(page)).toHaveCount(0);
});

test('truncated main bundle (200 with a broken body): the fallback appears', async ({ page }) => {
  await page.route('**/app/main.js', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'syntax error ({' }));
  await page.goto('/');
  await expect(fallback(page)).toBeVisible({ timeout: 9000 });
});

test('missing bootstrap.js: the fallback appears', async ({ page }) => {
  await page.route('**/app/bootstrap.js', (r) => r.fulfill({ status: 404, body: 'missing' }));
  await page.goto('/');
  await expect(fallback(page)).toBeVisible({ timeout: 9000 });
  await expect(page.locator('#root')).toBeEmpty();
});
