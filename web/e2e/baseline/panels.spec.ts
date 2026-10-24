import { test, expect } from '@playwright/test';
import { unlock, seed } from '../helpers';

test.beforeEach(async ({ page }) => { await unlock(page); await seed(page); await page.reload(); });

test('markets, news, calendar and dividends render', async ({ page }) => {
  const markets = page.locator('#markets');
  await expect(markets).toContainText('S&P 500');
  await expect(markets).toContainText('6,012.40');
  await expect(markets).toContainText('USD/SGD');
  await expect(markets).toContainText('Bitcoin');
  await expect(page.locator('#news')).toContainText('Index funds see record inflows'); // follows the selected VOO
  const cal = page.locator('#calendar');
  await expect(cal).toContainText('NEXT FED DECISION');
  await expect(cal).toContainText('NEXT DOT PLOT');
  await expect(cal).toContainText('CPI m/m');
  const div = page.locator('#dividends');
  await expect(div).toContainText('FORWARD / YR');
  await expect(div).toContainText('D05.SI');
});

test('watchlist add and remove', async ({ page }) => {
  const list = page.locator('#watchlist');
  await expect(list).toContainText('Empty');
  await page.click('#watch-toggle');
  await page.fill('#watch-symbol', 'AMD');
  await page.press('#watch-symbol', 'Enter');
  await expect(page.locator('#cmd-status')).toHaveText('Watching AMD');
  const row = list.locator('.wl-row[data-sym="AMD"]');
  await expect(row).toContainText('162.70');
  await row.locator('.wl-x').click();
  await expect(row).toHaveCount(0);
  await expect(list).toContainText('Empty');
});

test('price alert add', async ({ page }) => {
  await page.click('#alert-toggle');
  await page.fill('#alert-symbol', 'AAPL');
  await page.selectOption('#alert-op', '>');
  await page.fill('#alert-price', '300');
  await page.press('#alert-price', 'Enter');
  await expect(page.locator('#cmd-status')).toHaveText('Alert set: AAPL > 300');
  const row = page.locator('#alerts .al-row', { hasText: 'AAPL' });
  await expect(row).toContainText('armed');
  await row.locator('.al-x').click(); // leave the shared data folder clean
  await expect(row).toHaveCount(0);
});
