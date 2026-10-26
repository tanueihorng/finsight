import { test, expect } from '@playwright/test';
import { seeded, qtyCell } from './helpers';
test('transfer in the sheet preserves all-account holdings; undo restores the source', async ({ page }) => {
  await seeded(page);
  const { accounts } = await (await page.request.get('/api/accounts')).json();
  const source = accounts[0].id;
  const { newId } = await (await page.request.post('/api/accounts/add', { data: { name: 'Destination' } })).json();
  await page.reload(); await page.selectOption('#account-sel', source);
  await page.locator('#positions-body tr[data-sym="NVDA"] [data-act="sell"]').click();
  await page.click('#trade-mode-transfer'); await page.selectOption('#trade-to', newId); await page.fill('#trade-qty', '10');
  await expect(page.locator('#trade-preview')).toContainText('No realized P&L');
  await page.click('#trade-submit'); await expect(qtyCell(page, 'NVDA')).toHaveText('50');
  await page.click('#app-toast-undo'); await expect(qtyCell(page, 'NVDA')).toHaveText('60');
});
test('IBKR import previews buys and sells, confirms only new fills, and repeat import is a no-op', async ({ page }) => {
  await seeded(page);
  const text = ['Trades,Header,DataDiscriminator,Asset Category,Currency,Symbol,Date/Time,Quantity,T. Price',
    'Trades,Data,Order,Stocks,USD,AMD,2025-01-02,10,150', 'Trades,Data,Order,Stocks,USD,AMD,2025-01-03,-2,160'].join('\n');
  await page.click('#import-btn'); await page.fill('#import-text', text); await page.click('#import-do');
  await expect(page.locator('#import-preview')).toContainText('AMD');
  await expect(page.locator('#import-status')).toHaveText('2 new · 0 already recorded. Review before confirming.');
  await expect(page.locator('#positions-body tr[data-sym="AMD"]')).toHaveCount(0);
  await page.click('#import-do'); await expect(qtyCell(page, 'AMD')).toHaveText('8');
  await expect(page.locator('#import-modal')).toBeHidden();
  await page.click('#import-btn'); await page.click('#import-do');
  await expect(page.locator('#import-status')).toHaveText('0 new · 2 already recorded. Review before confirming.');
  await expect(page.locator('#import-do')).toBeDisabled();
  await expect(qtyCell(page, 'AMD')).toHaveText('8');
});
