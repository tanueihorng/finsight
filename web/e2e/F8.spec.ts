// F8: topbar (account, base, profile + setup wizard, peek, appearance).
// Written against legacy first.
import { test, expect, type Page } from '@playwright/test';
import { seeded, unlock, cmd } from './helpers';

const sel = (page: Page) => page.locator('#account-sel');
const status = (page: Page) => page.locator('#cmd-status');

test('account selector options, counts and switching persist; New account… creates and selects', async ({ page }) => {
  await seeded(page);
  await expect(sel(page).locator('option')).toHaveText(['All Accounts', 'Main (9)', '＋ New account…', '⚙ Manage…']);
  page.once('dialog', (d) => { expect(d.message()).toBe('New account name (e.g. Crypto, SGX, IBKR):'); d.accept('Crypto'); });
  await sel(page).selectOption('__new');
  await expect(status(page)).toHaveText('Account "Crypto" created.');
  await expect(sel(page).locator('option:checked')).toHaveText('Crypto');
  await expect(page.locator('#positions-body')).toContainText('No positions yet');
  await page.reload();
  await expect(sel(page).locator('option:checked')).toHaveText('Crypto');
  expect(await page.evaluate(() => localStorage.getItem('finsight-account'))).toBe(await sel(page).inputValue());
  page.once('dialog', (d) => d.dismiss());
  await sel(page).selectOption('__new');
  await expect(sel(page).locator('option:checked')).toHaveText('Crypto'); // cancelled: selection unchanged
  await sel(page).selectOption({ label: 'Main (9)' });
  await expect(page.locator('#positions-body tr[data-sym]')).toHaveCount(9);
});

test('manage accounts: add with type, rename, delete the active one falls back', async ({ page }) => {
  await seeded(page);
  await sel(page).selectOption('__manage');
  await expect(page.locator('#accounts-modal')).toBeVisible();
  await expect(sel(page).locator('option:checked')).toHaveText('Main (9)');
  await expect(page.locator('#accounts-list .card-edit-row')).toHaveCount(1);
  await expect(page.locator('#accounts-list')).toContainText('9 holdings');
  await page.fill('#account-new-name', 'IBKR');
  await page.fill('#account-new-type', 'Broker');
  await page.click('#account-add-form button[type="submit"]');
  await expect(page.locator('#accounts-status')).toHaveText('Added "IBKR".');
  await expect(page.locator('#accounts-status')).toHaveClass('cmd-status ok');
  await expect(page.locator('#account-new-name')).toHaveValue('');
  await expect(page.locator('#accounts-list')).toContainText('Broker · 0 holdings');
  await expect(sel(page).locator('option')).toContainText(['IBKR']);
  await page.locator('#accounts-modal').click({ position: { x: 5, y: 5 } });
  await expect(page.locator('#accounts-modal')).toBeHidden();

  await sel(page).selectOption({ label: 'IBKR' });
  await sel(page).selectOption('__manage');
  page.once('dialog', (d) => d.accept('Interactive'));
  await page.locator('#accounts-list .card-edit-row', { hasText: 'IBKR' }).locator('.acct-rename').click();
  await expect(page.locator('#accounts-list')).toContainText('Interactive');
  await expect(sel(page).locator('option:checked')).toHaveText('Interactive');
  page.once('dialog', (d) => d.accept());
  await page.locator('#accounts-list .card-edit-row', { hasText: 'Interactive' }).locator('.acct-del').click();
  await expect(page.locator('#accounts-list .card-edit-row')).toHaveCount(1);
  await page.click('#accounts-done');
  await expect(sel(page).locator('option:checked')).toHaveText('Main (9)');
  await expect(page.locator('#positions-body tr[data-sym]')).toHaveCount(9);
});

test('base currency: status, conversion, persistence', async ({ page }) => {
  await seeded(page);
  await page.selectOption('#base-ccy', 'EUR');
  await expect(status(page)).toHaveText('Base currency → EUR. Converting…');
  await expect(page.locator('#summary')).toContainText('€');
  await page.reload();
  await expect(page.locator('#base-ccy')).toHaveValue('EUR');
  await page.selectOption('#base-ccy', 'SGD');
  await expect(page.locator('#summary')).toContainText('S$92,967.48');
});

test('profile: first launch opens the wizard; save sets name and base; reopen from Profile; skip', async ({ page }) => {
  await unlock(page, { wizard: true });
  await page.evaluate(() => localStorage.removeItem('finsight-profile'));
  await page.reload();
  await expect(page.locator('#setup-modal')).toBeVisible();
  await expect(page.locator('#setup-name')).toBeFocused();
  await expect(page.locator('#setup-base')).toHaveValue('SGD');
  await page.fill('#setup-name', 'Tan Wei');
  await page.selectOption('#setup-base', 'USD');
  await page.click('#setup-save');
  await expect(page.locator('#setup-modal')).toBeHidden();
  await expect(page.locator('#profile-name')).toHaveText('Tan');
  await expect(page.locator('#base-ccy')).toHaveValue('USD');
  await expect(page.locator('#summary')).not.toContainText('S$');
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('finsight-profile')))!)).toEqual({ name: 'Tan Wei', base: 'USD', setupDone: true });
  await page.reload();
  await expect(page.locator('#setup-modal')).toBeHidden();
  await page.click('#profile-btn');
  await expect(page.locator('#setup-name')).toHaveValue('Tan Wei');
  await page.selectOption('#setup-base', 'SGD');
  await page.click('.setup-choice[data-action="empty"]');
  await expect(page.locator('#setup-modal')).toBeHidden();
  await expect(status(page)).toHaveText('Welcome, Tan Wei.');
  await expect(page.locator('#base-ccy')).toHaveValue('SGD');
  await page.click('#profile-btn');
  await page.fill('#setup-name', '');
  await page.click('#setup-skip');
  await expect(page.locator('#setup-modal')).toBeHidden();
  await expect(page.locator('#profile-name')).toHaveText('Tan');
});

test('peek: UNPEEK blurs personal figures and persists; appearance: font and theme swatches', async ({ page }) => {
  await seeded(page);
  await expect(page.locator('#peek-btn')).toHaveText('◉ UNPEEK');
  await page.click('#peek-btn');
  await expect(page.locator('body')).toHaveClass(/\bunpeek\b/);
  await expect(page.locator('#peek-btn')).toHaveText('◌ PEEK');
  await expect(page.locator('#peek-btn')).toHaveClass(/\bactive\b/);
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/\bunpeek\b/);
  await page.click('#peek-btn');
  await expect(page.locator('body')).not.toHaveClass(/\bunpeek\b/);
  expect(await page.evaluate(() => localStorage.getItem('finsight-unpeek'))).toBe('0');

  await page.click('#cards-btn');
  await expect(page.locator('#theme-list .swatch')).toHaveText(['Violet', 'Amber', 'Teal', 'Phosphor']);
  await expect(page.locator('#theme-list .swatch.on')).toHaveText('Violet');
  await expect(page.locator('#font-list .font-btn')).toHaveText(['Mono', 'Sans', 'Serif']);
  await page.click('#font-list [data-font="sans"]');
  await expect(page.locator('html')).toHaveAttribute('data-font', 'sans');
  await expect(page.locator('#font-list .font-btn.on')).toHaveText('Sans');
  await page.click('#theme-list [data-theme="teal"]');
  await expect(page.locator('#theme-list .swatch.on')).toHaveText('Teal');
  await page.click('#cards-done');
  await expect(page.locator('#detail-body canvas').first()).toBeAttached();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-font', 'sans');
  await page.click('#cards-btn');
  await page.click('#font-list [data-font="mono"]');
  await page.click('#theme-list [data-theme="violet"]');
  await page.click('#cards-done');
});
