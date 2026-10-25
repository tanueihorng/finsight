// F10: the layout system (⚙ Layout modal frame, panels editor, drag order,
// reset). Written against legacy first.
import { test, expect } from '@playwright/test';
import { seeded, dragPanel } from './helpers';

test('⚙ Layout opens and closes three ways; panels editor lists every panel with its state', async ({ page }) => {
  await seeded(page);
  const modal = page.locator('#cards-modal');
  await page.click('#cards-btn');
  await expect(modal).toBeVisible();
  const rows = page.locator('#panels-list .card-edit-row');
  await expect(rows).toHaveText(['Performance', 'Allocation', 'Sector Heatmap', 'FX Risk', 'Dividends', 'Watchlist', 'Price Alerts', 'Recent Activity',
    'News', 'World Markets', 'Econ Calendar', 'World Bank', 'US Fed (FRED)', 'US Inflation Gauges']);
  await page.locator('#panels-list input[data-panel="news"]').uncheck();
  await expect(rows.filter({ hasText: 'News' })).toHaveClass(/\boff\b/);
  await expect(page.locator('.panel[data-pid="news"]')).toBeHidden();
  await page.locator('#panels-list input[data-panel="news"]').check();
  await expect(rows.filter({ hasText: 'News' })).not.toHaveClass(/\boff\b/);
  await expect(page.locator('.panel[data-pid="news"]')).toBeVisible();
  await page.click('#cards-close');
  await expect(modal).toBeHidden();
  await page.click('#cards-btn');
  await modal.click({ position: { x: 5, y: 5 } });
  await expect(modal).toBeHidden();
  await page.click('#cards-btn');
  await expect(page.locator('#theme-list .swatch')).toHaveCount(4); // appearance lives in the same modal
  await expect(page.locator('#cards-list .card-edit-row').first()).toBeVisible(); // so does the summary card editor
  await page.click('#cards-done');
  await expect(modal).toBeHidden();
});

test('every panel gets a grip and a pid; Reset order restores the default layout', async ({ page }) => {
  await seeded(page);
  const pids = await page.locator('.panel.draggable-block').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.pid));
  expect(pids).toEqual(expect.arrayContaining(['positions', 'wealth', 'performance', 'allocation', 'heatmap', 'fxrisk', 'dividends', 'watchlist', 'alerts', 'activity', 'detail', 'news', 'markets', 'calendar', 'worldbank', 'fred', 'inflation']));
  await expect(page.locator('.panel.draggable-block .panel-head > .drag-grip')).toHaveCount(pids.length);
  const leftBefore = await page.locator('.col-left > .panel').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.pid));
  await dragPanel(page, 'news', '.col-left');
  await expect(page.locator('.col-left > .panel[data-pid="news"]')).toHaveCount(1);
  expect(JSON.parse((await page.evaluate(() => localStorage.getItem('finsight-layout')))!).left).toContain('news');
  await page.click('#cards-btn');
  await Promise.all([page.waitForEvent('load'), page.click('#layout-reset')]);
  expect(await page.evaluate(() => localStorage.getItem('finsight-layout'))).toBeNull();
  await expect(page.locator('.col-right > .panel[data-pid="news"]')).toHaveCount(1);
  await expect.poll(() => page.locator('.col-left > .panel').evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.pid))).toEqual(leftBefore);
});
