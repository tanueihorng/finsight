import { test, expect } from '@playwright/test';
import { seeded, cmd, qtyCell } from '../helpers';

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

test('row S button asks quantity and price', async ({ page }) => {
  const answers = ['10', ''];
  page.on('dialog', (d) => d.accept(answers.shift()));
  await page.locator('#positions-body tr[data-sym="NVDA"] [data-act="sell"]').click();
  await expect(page.locator('#cmd-status')).toHaveText(/^SOLD 10 NVDA · realized \+/);
  await expect(qtyCell(page, 'NVDA')).toHaveText('50');
});

test('DEL removes a holding; the row ✕ asks first', async ({ page }) => {
  await cmd(page, 'DEL TSM');
  await expect(page.locator('#cmd-status')).toHaveText('REMOVED TSM from portfolio');
  await expect(page.locator('#positions-body tr[data-sym="TSM"]')).toHaveCount(0);

  const del = page.locator('#positions-body tr[data-sym="VOO"] [data-act="del"]');
  page.once('dialog', (d) => { expect(d.message()).toContain('Remove VOO from your portfolio?'); d.dismiss(); });
  await del.click();
  await expect(page.locator('#positions-body tr[data-sym="VOO"]')).toHaveCount(1);
  page.once('dialog', (d) => d.accept());
  await del.click();
  await expect(page.locator('#cmd-status')).toHaveText('REMOVED VOO');
  await expect(page.locator('#positions-body tr[data-sym]')).toHaveCount(7);
});
