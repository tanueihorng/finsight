// F9: the PIN lock screen. Written against legacy first. The lock screen's
// contents, PIN submit and the 🔒 button move to islands; startup (checkAuth,
// showLock/showApp, boot, polling) stays legacy until X1.
import { test, expect, type Page } from '@playwright/test';
import { ensurePin, seeded, PIN } from './helpers';

const title = (page: Page) => page.locator('#lock-title');
const msg = (page: Page) => page.locator('#lock-msg');

test('enter mode: format check, wrong PIN, server error text, Enter submits', async ({ page, context }) => {
  await ensurePin(page.request);
  await context.clearCookies(); // creating the PIN signs this context in
  await page.goto('/');
  await expect(page.locator('body')).toHaveClass(/\blocked\b/);
  await expect(title(page)).toHaveText('Enter your PIN');
  await expect(page.locator('#lock-go')).toHaveText('UNLOCK');
  await expect(page.locator('#lock-pin2')).toBeHidden(); // (the page starts locked, so legacy doesn't auto-focus here)
  await page.fill('#lock-pin', '12');
  await page.click('#lock-go');
  await expect(msg(page)).toHaveText('PIN must be 4–12 digits');
  await page.route('**/api/auth/login', (r) => r.fulfill({ status: 429, json: { error: 'Too many attempts. Try again in 30 s.' } }));
  await page.fill('#lock-pin', '0000');
  await page.press('#lock-pin', 'Enter');
  await expect(msg(page)).toHaveText('Too many attempts. Try again in 30 s.');
  await expect(page.locator('#lock-pin')).toHaveValue('');
  await expect(page.locator('#lock-pin')).toBeFocused();
  await page.unroute('**/api/auth/login');
  await page.fill('#lock-pin', PIN);
  await page.press('#lock-pin', 'Enter');
  await expect(page.locator('body')).not.toHaveClass(/\blocked\b/);
  await expect(page.locator('#positions-body')).toBeVisible();
});

test('create mode: second field, Enter moves to it, mismatch, then setup unlocks', async ({ page }) => {
  await ensurePin(page.request);
  await page.route('**/api/auth/status', (r) => r.fulfill({ json: { pinSet: false, authed: false } }));
  await page.route('**/api/auth/setup', (r) => r.fulfill({ json: { ok: true } }));
  await page.goto('/');
  await expect(title(page)).toHaveText('Create a PIN (4–12 digits)');
  await expect(page.locator('#lock-go')).toHaveText('SET PIN');
  await expect(page.locator('#lock-pin2')).toBeVisible();
  await page.fill('#lock-pin', '2468');
  await page.press('#lock-pin', 'Enter');
  await expect(page.locator('#lock-pin2')).toBeFocused();
  await page.fill('#lock-pin2', '1357');
  await page.press('#lock-pin2', 'Enter');
  await expect(msg(page)).toHaveText('PINs do not match');
  // The faked setup succeeds; log in for real so the app can load behind it.
  await page.request.post('/api/auth/login', { data: { pin: PIN } });
  await page.fill('#lock-pin2', '2468');
  await page.click('#lock-go');
  await expect(page.locator('body')).not.toHaveClass(/\blocked\b/);
});

test('🔒 locks the app and logs out; unlocking resumes', async ({ page }) => {
  await seeded(page);
  await page.click('#lock-btn');
  await expect(page.locator('body')).toHaveClass(/\blocked\b/);
  await expect(title(page)).toHaveText('Enter your PIN');
  expect((await page.request.get('/api/accounts')).status()).toBe(401);
  await page.fill('#lock-pin', PIN);
  await page.press('#lock-pin', 'Enter');
  await expect(page.locator('body')).not.toHaveClass(/\blocked\b/);
  await expect(page.locator('#positions-body tr[data-sym]')).toHaveCount(9);
});

test('server unreachable: offline message, no PIN field, recovers by itself', async ({ page }) => {
  test.setTimeout(45_000);
  await ensurePin(page.request);
  await page.request.post('/api/auth/login', { data: { pin: PIN } });
  let down = true;
  await page.route('**/api/auth/status', (r) => (down ? r.abort() : r.fallback()));
  await page.goto('/');
  await expect(title(page)).toHaveText("Can't reach the FinSight server");
  await expect(msg(page)).toHaveText('Start it with  node server.ts  (or start.command). Retrying…');
  await expect(page.locator('#lock-pin')).toBeHidden();
  await expect(page.locator('#lock-go')).toBeHidden();
  down = false;
  await expect(page.locator('body')).not.toHaveClass(/\blocked\b/, { timeout: 12_000 });
});
