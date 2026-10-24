import { test, expect, type Page } from '@playwright/test';
import fs from 'node:fs';
import { seeded } from '../helpers';

declare const csvCell: (v: unknown) => string; // app.js top-level const (global lexical scope)

test.beforeEach(async ({ page }) => { await seeded(page); });

async function importCsv(page: Page, csv: string, replace: boolean) {
  await page.click('#import-btn');
  await page.fill('#import-text', csv);
  await page.locator('#import-replace').setChecked(replace);
  await page.click('#import-do');
}

test('import merges by default', async ({ page }) => {
  await importCsv(page, 'symbol,quantity,avg price\nAMD,10,150', false);
  await expect(page.locator('#import-status')).toHaveText('Imported 1/1');
  await expect(page.locator('#positions-body tr[data-sym]')).toHaveCount(10);
  await expect(page.locator('#import-modal')).toBeHidden();
});

test('import with replace drops existing positions; a symbol without a quote is still imported', async ({ page }) => {
  await importCsv(page, 'symbol,quantity,avg price\nAAPL,1,100\nNOPE,5,1', true);
  await expect(page.locator('#import-status')).toHaveText('Imported 2/2');
  await expect(page.locator('#positions-body tr[data-sym]')).toHaveCount(2);
  await expect(page.locator('#positions-body tr[data-sym="NOPE"]')).toHaveCount(1);
});

test('export downloads the holdings as CSV', async ({ page }) => {
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#export-btn')]);
  expect(download.suggestedFilename()).toBe('portfolio.csv');
  const lines = fs.readFileSync(await download.path(), 'utf8').split('\n');
  expect(lines[0]).toBe('symbol,quantity,avg_price,currency,last,market_value_sgd,unrealized_pnl');
  expect(lines).toHaveLength(10);
  expect(lines.find((l) => l.startsWith('AAPL,'))).toMatch(/^AAPL,25,188,USD,231\.5,7465\.88,/);
  await expect(page.locator('#footer-msg')).toHaveText('Exported portfolio.csv');
});

test('csvCell neutralises spreadsheet formulas', async ({ page }) => {
  const out = await page.evaluate(() => {
    const f = csvCell;
    return [f('=1+1'), f('+SUM(A1)'), f('-2'), f('@x'), f('a,b'), f('say "hi"'), f(5), f(null)];
  });
  expect(out).toEqual([`"'=1+1"`, `"'+SUM(A1)"`, `"'-2"`, `"'@x"`, '"a,b"', '"say ""hi"""', '5', '']);
});
