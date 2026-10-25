// C3: performance, net-worth breakdown, allocation and sector heatmap as
// React islands. Written against legacy first. Performance numbers move with
// the daily FX/price walk, so only the end value and the structure are pinned.
import { test, expect, type Page } from '@playwright/test';
import { seeded, cmd, dragPanel } from './helpers';

const legend = (page: Page) => page.locator('#alloc-body .lg');
const isPerf = (url: string) => new URL(url).pathname === '/api/portfolio/performance';

test('allocation: holding, sector, class and account modes; legend selects a holding', async ({ page }) => {
  await seeded(page);
  await expect(legend(page)).toHaveText(['VOO16.9%', 'NVDA15.2%', 'D05.SI14.4%', 'MSFT11.7%', 'TSM11.4%', 'O39.SI9.2%', 'GOOGL8.2%', 'AAPL8.0%', 'ES3.SI5.1%']);
  await expect(page.locator('#alloc-body svg path')).toHaveCount(9);
  await expect(page.locator('#alloc-mode button.active')).toHaveText('HOLDING');
  await page.click('#alloc-mode [data-mode="sector"]');
  await expect(page.locator('#alloc-mode button.active')).toHaveText('SECTOR');
  await expect(legend(page)).toHaveText(['Technology46.3%', 'Financial Services23.6%', 'ETF / Fund21.9%', 'Communication Serv8.2%']);
  await page.click('#alloc-mode [data-mode="class"]');
  await expect(legend(page)).toHaveText(['Stocks78.1%', 'ETFs21.9%']);
  await page.click('#alloc-mode [data-mode="account"]');
  await expect(legend(page)).toHaveText(['Main100.0%']);
  await expect(page.locator('#alloc-body svg circle')).toHaveCount(2); // a single 100% slice is drawn as a ring
  await legend(page).first().click();
  await expect(page.locator('#detail-title')).toHaveText('VOO · DETAIL'); // not a holding: no selection change
  await page.click('#alloc-mode [data-mode="holding"]');
  await legend(page).nth(1).click();
  await expect(page.locator('#detail-title')).toHaveText('NVDA · DETAIL');
  await page.locator('#alloc-body svg path').nth(2).click();
  await expect(page.locator('#detail-title')).toHaveText('D05.SI · DETAIL');
});

test('heatmap: tiles grouped by sector, DAY/TOTAL metric, a tile selects', async ({ page }) => {
  await seeded(page);
  const tiles = page.locator('#heatmap-body .hm-tile');
  await expect(tiles).toHaveCount(9);
  await expect(page.locator('#heatmap-body')).toContainText('TECHNOLOGY');
  await expect(page.locator('#heatmap-body .hm-tile[data-sym="NVDA"]')).toContainText('+1.68%');
  await page.click('#heat-metric [data-metric="total"]');
  await expect(page.locator('#heat-metric button.active')).toHaveText('TOTAL %');
  await expect(page.locator('#heatmap-body')).toHaveAttribute('data-metric', 'total');
  await expect(page.locator('#heatmap-body .hm-tile[data-sym="NVDA"]')).not.toContainText('+1.68%');
  await expect(page.locator('#heatmap-body .hm-tile[data-sym="NVDA"]')).toContainText('%');
  await page.locator('#heatmap-body .hm-tile[data-sym="MSFT"]').click();
  await expect(page.locator('#detail-title')).toHaveText('MSFT · DETAIL');
});

test('net worth breakdown: classes, cash note, per-account rows, EDIT CASH', async ({ page }) => {
  await seeded(page);
  const box = page.locator('#wealth-body');
  await expect(box.locator('.w-total')).toHaveText('S$92,967.48');
  await expect(box.locator('.w-lg')).toHaveText(['STOCKSS$72,594.8878.1%', 'ETFSS$20,372.6021.9%']);
  await expect(box.locator('.w-seg')).toHaveCount(2);
  await expect(box.locator('.w-note')).toHaveCount(0);
  await cmd(page, 'CASH USD 1000');
  await expect(box.locator('.w-total')).toHaveText('S$94,257.48');
  await expect(box.locator('.w-note')).toHaveText('CASH · USD 1,000.00');
  await expect(box.locator('.w-lg').last()).toHaveText('CASHS$1,290.001.4%');
  await page.click('#wealth-cash-btn');
  await expect(page.locator('#cash-modal')).toBeVisible();
  await page.click('#cash-save');

  await page.request.post('/api/accounts/add', { data: { name: 'Second' } });
  await page.reload();
  await page.locator('#account-sel').selectOption({ label: 'Second' });
  await cmd(page, 'ADD AMD 10 100');
  await page.locator('#account-sel').selectOption('ALL');
  await expect(box.locator('.w-row .w-name')).toHaveText(['Main', 'Second']);
  await expect(box.locator('.fxr-sub')).toHaveText('BY ACCOUNT');
  await expect(box.locator('.w-total')).toHaveText('S$96,356.31');
  await cmd(page, 'CASH USD 0');
  await page.locator('#account-sel').selectOption({ label: 'Main (9)' });
  await cmd(page, 'CASH USD 0');
});

test('performance: headline, stats, ranges, benchmark choice persists, hover tooltip', async ({ page }) => {
  await seeded(page);
  const box = page.locator('#perf-body');
  await expect(box.locator('.perf-headline .pv')).toHaveText('S$92,967.48');
  await expect(box.locator('.pf-stat .k')).toHaveText(['GAIN', 'TWR p.a.', 'XIRR p.a.', 'S&P 500', 'VS INDEX']);
  await expect(box.locator('.pf-legend span')).toHaveText(['Portfolio', 'Net invested', 'Same cash in S&P 500']);
  await expect(box).toContainText('Replays your actual buys & sells with historical prices and FX.');

  let req = page.waitForRequest((r) => isPerf(r.url()) && new URL(r.url()).searchParams.get('range') === '1mo');
  await page.click('#perf-ranges [data-range="1mo"]');
  await req;
  await expect(page.locator('#perf-ranges button.active')).toHaveText('1M');
  await expect(box.locator('.pf-stat .k').nth(1)).toHaveText('TWR');
  await expect(box.locator('.pf-stat .k').nth(2)).toHaveText('MONEY-WTD');

  req = page.waitForRequest((r) => isPerf(r.url()) && new URL(r.url()).searchParams.get('benchmark') === 'none');
  await page.selectOption('#perf-bench', 'none');
  await req;
  await expect(box.locator('.pf-stat .k')).toHaveText(['GAIN', 'TWR', 'MONEY-WTD']);
  await expect(box.locator('.pf-legend span')).toHaveCount(2);
  await page.reload();
  await expect(page.locator('#perf-bench')).toHaveValue('none');
  await expect(page.locator('#perf-ranges button.active')).toHaveText('1Y'); // range is not saved

  const svg = box.locator('.pf-chart');
  await expect(svg).toBeVisible();
  const r = (await svg.boundingBox())!;
  await page.mouse.move(r.x + r.width / 2, r.y + r.height / 2);
  await expect(page.locator('#pf-tip')).toBeVisible();
  await expect(page.locator('#pf-tip')).toContainText('Portfolio S$');
  await expect(page.locator('#pf-cross')).toHaveAttribute('visibility', 'visible');
  await page.mouse.move(r.x + r.width / 2, r.y - 40);
  await expect(page.locator('#pf-tip')).toBeHidden();
  await page.selectOption('#perf-bench', '^GSPC');
});

test('writes and account switches refresh performance; an empty account shows the empty states', async ({ page }) => {
  await seeded(page);
  await expect(page.locator('#perf-body .pv')).toHaveText('S$92,967.48');
  let req = page.waitForRequest((r) => isPerf(r.url()));
  await cmd(page, 'ADD AAPL 1 100');
  await req;
  await expect(page.locator('#perf-body .pv')).not.toHaveText('S$92,967.48');
  req = page.waitForRequest((r) => isPerf(r.url()));
  await cmd(page, 'UNDO');
  await req;
  await expect(page.locator('#perf-body .pv')).toHaveText('S$92,967.48');
  await expect(page.locator('#alloc-body .lg').first()).toHaveText('VOO16.9%');

  await page.request.post('/api/accounts/add', { data: { name: 'Empty' } });
  await page.reload();
  await page.locator('#account-sel').selectOption({ label: 'Empty' });
  await expect(page.locator('#perf-body')).toHaveText('Add positions to see performance over time.');
  await expect(page.locator('#alloc-body')).toHaveText('Add positions to see allocation.');
  await expect(page.locator('#heatmap-body')).toHaveText('Add positions to see the heatmap.');
  await expect(page.locator('#wealth-body')).toHaveText('Add positions or cash to see your breakdown.');
});

test('panels keep their place after drag + reload, and hide/show from ⚙ Layout', async ({ page }) => {
  await seeded(page);
  await dragPanel(page, 'allocation', '.col-right');
  await expect(page.locator('.col-right > .panel[data-pid="allocation"]')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.col-right > .panel[data-pid="allocation"]')).toHaveCount(1);
  await expect(page.locator('#alloc-body .lg')).toHaveCount(9);
  for (const pid of ['performance', 'wealth', 'heatmap']) await expect(page.locator(`.panel[data-pid="${pid}"]`)).toHaveCount(1);
  await page.click('#cards-btn');
  await page.locator('#panels-list input[data-panel="heatmap-body"]').uncheck();
  await page.click('#cards-done');
  await expect(page.locator('.panel[data-pid="heatmap"]')).toBeHidden();
  await page.reload();
  await expect(page.locator('.panel[data-pid="heatmap"]')).toBeHidden();
  await page.click('#cards-btn');
  await page.locator('#panels-list input[data-panel="heatmap-body"]').check();
  await page.click('#cards-done');
  await expect(page.locator('#heatmap-body .hm-tile')).toHaveCount(9);
});
