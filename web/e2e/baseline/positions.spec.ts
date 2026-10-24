import { test, expect, type Page } from '@playwright/test';
import { unlock, seed } from '../helpers';

test.beforeEach(async ({ page }) => { await unlock(page); await seed(page); await page.reload(); });

const rows = (page: Page) => page.locator('#positions-body tr[data-sym]');

test('row count, sort by MKT VAL, search, group by currency', async ({ page }) => {
  await expect(rows(page)).toHaveCount(9);
  // default: market value, largest first
  await expect(rows(page).first()).toHaveAttribute('data-sym', 'VOO');
  await page.click('#pos-head th[data-sort="marketValue"]');
  await expect(rows(page).first()).toHaveAttribute('data-sym', 'ES3.SI');
  await expect(rows(page).last()).toHaveAttribute('data-sym', 'VOO');

  await page.fill('#pos-search', 'NVDA');
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveAttribute('data-sym', 'NVDA');
  await page.fill('#pos-search', '');
  await expect(rows(page)).toHaveCount(9);

  await page.selectOption('#pos-group', 'currency');
  const groups = page.locator('#positions-body tr.grp-row');
  await expect(groups).toHaveCount(2);
  await expect(groups.nth(0)).toContainText('USD');
  await expect(groups.nth(1)).toContainText('SGD');
  await expect(rows(page)).toHaveCount(9);
});
