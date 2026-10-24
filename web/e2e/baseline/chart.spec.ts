import { test, expect } from '@playwright/test';
import { seeded } from '../helpers';

test.beforeEach(async ({ page }) => { await seeded(page); });

declare const detailChart: { cfg: { indicators: { type: string; hidden?: boolean }[] } };

test('range buttons reload history for the selected symbol', async ({ page }) => {
  await expect(page.locator('#detail-title')).toHaveText('VOO · DETAIL');
  await expect(page.locator('#ranges [data-range="1mo"]')).toHaveClass(/\bactive\b/);
  const req = page.waitForRequest((r) => r.url().includes('/api/history?symbol=VOO') && r.url().includes('interval=1wk'));
  await page.click('#ranges [data-range="5y"]');
  expect(new URL((await req).url()).searchParams.get('range')).toMatch(/^(5y|10y)$/);
  await expect(page.locator('#ranges [data-range="5y"]')).toHaveClass(/\bactive\b/);
  await expect(page.locator('#ranges [data-range="1mo"]')).not.toHaveClass(/\bactive\b/);
});

test('indicators can be added and hidden', async ({ page }) => {
  await expect(page.locator('#detail-body canvas').first()).toBeAttached();
  const count = () => page.evaluate(() => detailChart.cfg.indicators.length);
  const n = await count();
  await page.getByRole('button', { name: 'ƒx Indicators' }).click();
  await expect(page.locator('.pc-mrow')).toHaveCount(n);
  await page.locator('.pc-madd [data-add="rsi"]').click();
  await expect.poll(count).toBe(n + 1);
  await expect(page.locator('.pc-mrow')).toHaveCount(n + 1);
  const hide = page.locator('.pc-mrow').last().locator('[data-f="hide"]');
  await expect(hide).toHaveClass(/\bon\b/);
  await hide.click();
  await expect.poll(() => page.evaluate(() => detailChart.cfg.indicators.at(-1)!.hidden)).toBe(true);
});
