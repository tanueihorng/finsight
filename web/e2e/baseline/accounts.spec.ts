import { test, expect, type Page } from '@playwright/test';
import { seeded } from '../helpers';

test.beforeEach(async ({ page }) => { await seeded(page); });

const rows = (page: Page) => page.locator('#positions-body tr[data-sym]');

test('add, switch, rename and delete an account', async ({ page }) => {
  const sel = page.locator('#account-sel');
  await sel.selectOption('__manage');
  await expect(page.locator('#accounts-modal')).toBeVisible();
  await page.fill('#account-new-name', 'Crypto');
  await page.press('#account-new-name', 'Enter');
  await expect(page.locator('#accounts-status')).toHaveText('Added "Crypto".');
  await page.click('#accounts-done');

  const crypto = sel.locator('option', { hasText: 'Crypto' });
  await sel.selectOption({ label: 'Crypto' });
  await expect(page.locator('#positions-body')).toContainText('No positions yet');
  await sel.selectOption('ALL');
  await expect(rows(page)).toHaveCount(9);

  await sel.selectOption('__manage');
  const row = page.locator('#accounts-list .card-edit-row', { hasText: 'Crypto' });
  page.once('dialog', (d) => d.accept('Coins'));
  await row.locator('.acct-rename').click();
  await expect(page.locator('#accounts-list')).toContainText('Coins');
  await expect(sel.locator('option', { hasText: 'Coins' })).toHaveCount(1);
  await expect(crypto).toHaveCount(0);

  page.once('dialog', (d) => d.accept());
  await page.locator('#accounts-list .card-edit-row', { hasText: 'Coins' }).locator('.acct-del').click();
  await expect(page.locator('#accounts-list')).not.toContainText('Coins');
});

test('switching base currency converts every value', async ({ page }) => {
  const summary = page.locator('#summary');
  await expect(summary).toContainText('S$92,967.48');
  await page.selectOption('#base-ccy', 'USD');
  // SGD holdings convert at 1/1.29; USD holdings keep their value.
  await expect(summary).toContainText('$72,067.81');
  await expect(summary).not.toContainText('S$');
  await expect(page.locator('#positions-body tr[data-sym="AAPL"] td').nth(5)).toHaveText('$5,787.50');
  await page.reload();
  await expect(page.locator('#base-ccy')).toHaveValue('USD');
  await page.selectOption('#base-ccy', 'SGD');
  await expect(summary).toContainText('S$92,967.48');
});

test('a slow response for the previous account does not overwrite the new one', async ({ page }) => {
  await page.request.post('/api/accounts/add', { data: { name: 'Empty' } });
  await page.reload();
  const sel = page.locator('#account-sel');
  const first = (await sel.locator('option').nth(1).getAttribute('value'))!;
  await sel.selectOption(first);
  await expect(rows(page)).toHaveCount(9);
  // Hold the next portfolio response for the first account, then switch away.
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  let seen!: () => void;
  const intercepted = new Promise<void>((r) => { seen = r; });
  await page.route(`**/api/portfolio?base=SGD&account=${first}`, async (route) => {
    seen(); await held; await route.continue();
  }, { times: 1 });
  await page.evaluate(() => { void (window as any).loadPortfolio(); }); // legacy-any: what the 15 s poll does
  await intercepted;
  await sel.selectOption({ label: 'Empty' });
  await expect(page.locator('#positions-body')).toContainText('No positions yet');
  release();
  await page.waitForTimeout(1000);
  await expect(page.locator('#positions-body')).toContainText('No positions yet', { timeout: 1000 });
});
