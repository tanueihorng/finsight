// + ADD and wizard now use the shared trade sheet.
import { test, expect, type Page } from '@playwright/test';
import { seeded, unlock, qtyCell } from './helpers';
const pick = async (page: Page, symbol: string) => {
  await page.fill('#trade-symbol', symbol);
  await expect(page.locator('#trade-suggest [role="option"]').first()).toBeVisible();
  await page.press('#trade-symbol', 'ArrowDown'); await page.press('#trade-symbol', 'Enter');
  await expect(page.locator('#trade-qty')).toBeFocused();
};
test('+ ADD opens the sheet, focuses symbol search and Escape closes it', async ({ page }) => {
  await seeded(page); await page.click('#add-toggle');
  await expect(page.locator('#trade-sheet')).toHaveAttribute('aria-hidden', 'false');
  await expect(page.locator('#trade-symbol')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.locator('#trade-sheet')).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#add-toggle')).toBeFocused();
});
test('symbol search supports keyboard selection and fills the quote', async ({ page }) => {
  await seeded(page); await page.click('#add-toggle'); await page.fill('#trade-symbol', 'AM');
  const options = page.locator('#trade-suggest [role="option"]');
  await expect(options).toHaveCount(2);
  await page.press('#trade-symbol', 'ArrowDown'); await page.press('#trade-symbol', 'ArrowDown');
  await expect(options.nth(1)).toHaveAttribute('aria-selected', 'true');
  await page.press('#trade-symbol', 'ArrowUp'); await page.press('#trade-symbol', 'Enter');
  await expect(page.locator('#trade-symbol')).toHaveValue('AMD');
  await expect(page.locator('#trade-qty')).toBeFocused();
  await expect(page.locator('#trade-price')).not.toHaveValue('');
  await expect(options).toHaveCount(0);
});
test('new-symbol buy validates, records a dated lot and supports undo', async ({ page }) => {
  await seeded(page); await page.click('#add-toggle'); await pick(page, 'AMD');
  await page.fill('#trade-qty', '0'); await page.click('#trade-submit');
  await expect(page.locator('#trade-error')).toHaveText('Enter a share count above 0.');
  await page.fill('#trade-qty', '2'); await page.fill('#trade-price', '150'); await page.fill('#trade-date', '2025-01-02');
  await page.press('#trade-price', 'Enter');
  await expect(page.locator('#cmd-status')).toHaveText('BOUGHT 2 AMD @ 150 on 2025-01-02');
  await expect(qtyCell(page, 'AMD')).toHaveText('2');
  await page.click('#app-toast-undo'); await expect(page.locator('#positions-body tr[data-sym="AMD"]')).toHaveCount(0);
});
test('All Accounts offers an explicit destination and server errors stay in the sheet', async ({ page }) => {
  await seeded(page); await page.request.post('/api/accounts/add', { data: { name: 'Second' } }); await page.reload();
  await page.selectOption('#account-sel', 'ALL'); await page.click('#add-toggle'); await pick(page, 'AMD');
  await expect(page.locator('#trade-account option')).toHaveCount(2);
  await page.route('**/api/portfolio/buy*', (r) => r.fulfill({ status: 400, json: { error: 'Bad price' } }));
  await page.click('#trade-submit'); await expect(page.locator('#trade-error')).toHaveText('Bad price');
  await expect(page.locator('#trade-sheet')).toHaveAttribute('aria-hidden', 'false');
});
test('setup wizard Add manually opens symbol search in the sheet', async ({ page }) => {
  await unlock(page, { wizard: true }); await page.evaluate(() => localStorage.removeItem('finsight-profile')); await page.reload();
  await page.click('.setup-choice[data-action="manual"]'); await expect(page.locator('#setup-modal')).toBeHidden();
  await expect(page.locator('#trade-symbol')).toBeFocused();
});

test('a late quote cannot overwrite a newer symbol query or enable the wrong purchase', async ({ page }) => {
  await seeded(page); await page.click('#add-toggle');
  let release!: () => void, seen!: () => void;
  const held = new Promise<void>((r) => { release = r; }), requested = new Promise<void>((r) => { seen = r; });
  await page.route(/\/api\/quote\?symbols=AMD$/, async (r) => { seen(); await held; await r.continue(); });
  try {
    await page.fill('#trade-symbol', 'AMD');
    await page.locator('#trade-suggest [role="option"]').first().click(); await requested;
    await page.fill('#trade-symbol', 'MSFT'); release();
    await expect(page.locator('#trade-symbol')).toHaveValue('MSFT');
    await expect(page.locator('#trade-suggest [role="option"]').first()).toContainText('MSFT');
    await page.locator('#trade-suggest [role="option"]').first().click();
    await expect(page.locator('#trade-sheet')).toHaveAttribute('aria-label', 'Buy MSFT');
    await page.fill('#trade-symbol', 'NVDA'); await expect(page.locator('#trade-submit')).toBeDisabled();
  } finally { release(); }
});
test.describe('short screen', () => {
  test.use({ viewport: { width: 390, height: 716 } });
  test('new-symbol primary action remains fully in view', async ({ page }) => {
    await seeded(page); await page.click('#add-toggle'); await pick(page, 'AMD');
    await expect(page.locator('#trade-submit')).toBeInViewport({ ratio: 1 });
  });
});
