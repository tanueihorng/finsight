import { test, expect } from '@playwright/test';
import { unlock, seed } from '../helpers';

test.beforeEach(async ({ page }) => { await unlock(page); await seed(page); await page.reload(); });

test('cards show net worth, day P/L and FX exposure; UNPEEK blurs them', async ({ page }) => {
  const summary = page.locator('#summary');
  await expect(summary).toContainText('NET WORTH');
  await expect(summary).toContainText('S$92,967.48');
  await expect(summary).toContainText('DAY P&L');
  await expect(summary).toContainText('+S$772.15');
  await expect(summary).toContainText('FX EXPOSURE');
  await expect(summary).toContainText('S$66.33K');
  await expect(summary).toContainText('71% in USD');

  const blur = () => summary.evaluate((el) => getComputedStyle(el).filter);
  expect(await blur()).not.toContain('blur');
  await page.click('#peek-btn');
  await expect(page.locator('body')).toHaveClass(/\bunpeek\b/);
  await expect(page.locator('#peek-btn')).toHaveText('◌ PEEK');
  expect(await blur()).toContain('blur');
  await page.click('#peek-btn');
  await expect(page.locator('body')).not.toHaveClass(/\bunpeek\b/);
});
