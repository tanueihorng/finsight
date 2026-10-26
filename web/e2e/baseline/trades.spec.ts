import { test, expect } from '@playwright/test';
import { seeded, cmd, qtyCell, answerDialog } from '../helpers';

test.beforeEach(async ({ page }) => { await seeded(page); });

test('SELL with a price records realized P/L', async ({ page }) => {
  await cmd(page, 'SELL AAPL 5 250');
  await expect(page.locator('#cmd-status')).toHaveText(/^SOLD 5 AAPL {2}· {2}realized \+/);
  await expect(qtyCell(page, 'AAPL')).toHaveText('20');
});

test('SELL without a price uses the market price', async ({ page }) => {
  await cmd(page, 'SELL MSFT 18');
  await expect(page.locator('#cmd-status')).toHaveText(/^SOLD 18 MSFT/);
  await expect(page.locator('#positions-body tr[data-sym="MSFT"]')).toHaveCount(0);
  await expect(page.locator('#positions-body tr[data-sym]')).toHaveCount(8);
});

test('row Sell opens the trade sheet; recording a sale shows an undo toast', async ({ page }) => {
  await page.locator('#positions-body tr[data-sym="NVDA"]').hover();
  await page.locator('#positions-body tr[data-sym="NVDA"] [data-act="sell"]').click();
  const sheet = page.locator('#trade-sheet');
  await expect(sheet).toHaveAttribute('aria-label', 'Sell NVDA');
  await expect(sheet.locator('#trade-qty')).toHaveValue('60'); // starts at the whole holding
  await sheet.locator('#trade-qty').fill('10');
  await expect(sheet.locator('#trade-realized')).toHaveText(/^\+/);
  await sheet.locator('#trade-submit').click();
  await expect(page.locator('#cmd-status')).toHaveText(/^SOLD 10 NVDA · realized \+/);
  await expect(qtyCell(page, 'NVDA')).toHaveText('50');
  await expect(sheet).toHaveAttribute('aria-hidden', 'true');
  await expect(page.locator('#app-toast')).toContainText('Sold 10 NVDA');
  await page.click('#app-toast-undo');
  await expect(qtyCell(page, 'NVDA')).toHaveText('60');
});

test('row Buy previews the new average and records a dated buy; B and S work on a focused row', async ({ page }) => {
  const row = page.locator('#positions-body tr[data-sym="NVDA"]');
  await row.focus();
  await page.keyboard.press('b');
  const sheet = page.locator('#trade-sheet');
  await expect(sheet).toHaveAttribute('aria-label', 'Buy NVDA');
  await expect(sheet.locator('#trade-qty')).toBeFocused();
  await sheet.locator('#trade-qty').fill('-1');
  await sheet.locator('#trade-submit').click();
  await expect(sheet.locator('#trade-error')).toHaveText('Enter a share count above 0.');
  await sheet.locator('#trade-qty').fill('2');
  await sheet.locator('#trade-price').fill('100');
  await sheet.locator('#trade-date').fill('2025-01-15');
  await expect(sheet.locator('#trade-preview')).toContainText('Position after62 sh');
  await page.keyboard.press('Enter');
  await expect(page.locator('#cmd-status')).toHaveText('BOUGHT 2 NVDA @ 100 on 2025-01-15');
  await expect(qtyCell(page, 'NVDA')).toHaveText('62');
  await row.focus();
  await page.keyboard.press('s');
  await expect(sheet).toHaveAttribute('aria-label', 'Sell NVDA');
  await page.keyboard.press('Escape');
  await expect(sheet).toHaveAttribute('aria-hidden', 'true');
});

test('DEL removes a holding; the row ✕ asks first', async ({ page }) => {
  await cmd(page, 'DEL TSM');
  await expect(page.locator('#cmd-status')).toHaveText('REMOVED TSM from portfolio');
  await expect(page.locator('#positions-body tr[data-sym="TSM"]')).toHaveCount(0);

  const del = page.locator('#positions-body tr[data-sym="VOO"] [data-act="del"]');
  await del.click();
  await answerDialog(page, { title: 'Remove VOO?', accept: false });
  await expect(page.locator('#positions-body tr[data-sym="VOO"]')).toHaveCount(1);
  await del.click();
  await answerDialog(page);
  await expect(page.locator('#cmd-status')).toHaveText('REMOVED VOO');
  await expect(page.locator('#positions-body tr[data-sym]')).toHaveCount(7);
});
