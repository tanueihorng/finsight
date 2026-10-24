import { test, expect, type Page } from '@playwright/test';
import { seeded, cmd } from '../helpers';

test.beforeEach(async ({ page }) => { await seeded(page); });

const avgCell = (page: Page, sym: string) => page.locator(`#positions-body tr[data-sym="${sym}"] td`).nth(2);

test('ledger lists every buy; edit and delete a buy', async ({ page }) => {
  await cmd(page, 'LEDGER');
  const body = page.locator('#ledger-body');
  await expect(page.locator('#ledger-modal')).toBeVisible();
  await expect(body.locator('tr')).toHaveCount(9);
  await page.fill('#ledger-filter', 'AAPL');
  await expect(body.locator('tr')).toHaveCount(1);

  await body.locator('tr [data-act="edit"]').click();
  await body.locator('.le-px').fill('200');
  await body.locator('[data-act="save"]').click();
  await expect(page.locator('#ledger-status')).toHaveText('Updated AAPL buy. UNDO reverts it.');
  await expect(avgCell(page, 'AAPL')).toHaveText('200.00');

  await page.fill('#ledger-filter', 'GOOGL');
  page.once('dialog', (d) => { expect(d.message()).toContain('Delete this buy of 30 GOOGL?'); d.accept(); });
  await body.locator('tr [data-act="delete"]').click();
  await expect(page.locator('#ledger-status')).toHaveText('Deleted GOOGL buy. UNDO restores it.');
  await expect(page.locator('#positions-body tr[data-sym="GOOGL"]')).toHaveCount(0);
  await page.click('#ledger-close');
  await expect(page.locator('#ledger-modal')).toBeHidden();
});
