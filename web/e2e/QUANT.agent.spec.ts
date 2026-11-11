// FEAT-014 Quant Lab against the fake agent: the guided first run, what the
// views show against the agent's figures, failure paths, keyboard and phone.
import { test, expect, type Page } from '@playwright/test';
import { seeded } from './helpers';

const FAKE_AGENT = `http://127.0.0.1:${Number(process.env.E2E_PORT_BASE || 8096) + 1}`;
const lab = (page: Page) => page.getByRole('dialog', { name: 'QUANT LAB' });
const SYMBOLS = 'AAA, BBB, CCC, DDD';

async function open(page: Page) {
  await page.addInitScript(() => { localStorage.removeItem('finsight-quant-tab'); localStorage.removeItem('finsight-quant-run'); });
  expect((await page.request.post(`${FAKE_AGENT}/v1/__test/quant-reset`)).ok()).toBe(true);
  await seeded(page);
  await page.click('#quant-open');
  await expect(lab(page)).toBeVisible();
}
async function runBacktest(page: Page, strategy: string, symbols = SYMBOLS, wait: RegExp | string = /passed/) {
  if (await lab(page).getByRole('button', { name: 'New backtest' }).isVisible()) await lab(page).getByRole('button', { name: 'New backtest' }).click();
  await lab(page).getByLabel('Strategy', { exact: true }).selectOption({ label: strategy });
  await lab(page).getByLabel(/^Stocks/).fill(symbols);
  await lab(page).getByRole('button', { name: 'Run backtest and checks' }).click();
  await expect(lab(page).getByLabel('Saved runs').getByRole('button', { name: new RegExp(strategy) }).first()).toContainText(wait);
}

test('a first run goes from the guided empty state to checked results, with the figures from the agent', async ({ page }) => {
  await open(page);
  await expect(lab(page)).toContainText('Test a strategy on history');
  await expect(lab(page).getByLabel('Strategy', { exact: true }).locator('option')).toHaveText(['MA trend', 'Breakout', 'RSI-2']);

  await lab(page).getByRole('button', { name: 'Run backtest and checks' }).click();
  await expect(lab(page)).toContainText('Add at least one ticker.');
  await expect(lab(page).getByLabel(/^Stocks/)).toHaveAttribute('aria-invalid', 'true');

  await lab(page).getByRole('button', { name: '13 large US stocks' }).click();
  await expect(lab(page).getByText('Stocks (13)')).toBeVisible();
  await lab(page).getByLabel(/^Stocks/).fill(SYMBOLS);
  await lab(page).getByRole('button', { name: 'Run backtest and checks' }).click();

  const panel = lab(page).getByRole('tabpanel');
  await expect(lab(page).getByLabel('Checks')).toContainText('1 PASS · 5 FAIL');
  await expect(panel).toContainText('18.19%');
  await expect(panel).toContainText('+6.71 pts');
  await expect(lab(page)).toContainText('NOT OUT-OF-SAMPLE PROOF');
  await expect(lab(page)).toContainText('SURVIVORSHIP BIAS');
  await expect(lab(page)).toContainText('BACKTESTED, NOT ACCEPTED');
  await expect(lab(page).getByRole('button', { name: /order|buy|sell|approve/i })).toHaveCount(0);

  await lab(page).getByRole('tab', { name: 'Evidence' }).click();
  await expect(panel).toContainText('1 of 6');
  await expect(panel).toContainText('Not met: recent period beat the benchmark');
  const tiles = panel.locator('article');
  await expect(tiles).toHaveCount(6);
  await expect(tiles.filter({ hasText: 'Lead is clear of zero' })).toContainText('−5.9 to +19.9');
  await expect(tiles.filter({ hasText: 'Survives higher costs' })).toContainText('PASS');
  await expect(tiles.filter({ hasText: 'No single stock carries it' })).toContainText('CCC: −1.6 pts');

  await lab(page).getByRole('tab', { name: 'Details' }).click();
  await lab(page).getByRole('button', { name: 'Recompute' }).click();
  await expect(panel).toContainText('It matches the saved run exactly.');
});

test('the rail opens the matching plain-English answer, which reports results without causes', async ({ page }) => {
  await open(page);
  await runBacktest(page, 'MA trend');
  await lab(page).getByLabel('Checks').getByRole('button', { name: /Lead is clear of zero/ }).click();
  await expect(lab(page).getByRole('tab', { name: 'Plain English' })).toHaveAttribute('aria-selected', 'true');
  const panel = lab(page).getByRole('tabpanel');
  await expect(panel.getByRole('heading', { name: '5. Could the result be chance?' })).toBeInViewport();
  await expect(panel).toContainText('Cannot rule it out.');
  await expect(panel).toContainText('which includes zero');
  await expect(panel).toContainText('not a p-value');
  await expect(panel).not.toContainText(/because/i);
});

test('compare sorts by checks passed, not return, and leaves out runs of a different test or different price data', async ({ page }) => {
  test.setTimeout(60_000); // six backtests in one test
  await open(page);
  await runBacktest(page, 'RSI-2');
  await runBacktest(page, 'Breakout');
  await runBacktest(page, 'MA trend');
  await runBacktest(page, 'MA trend', 'AAA, ZZZ', /passed/);
  expect((await page.request.post(`${FAKE_AGENT}/v1/__test/quant-revise`)).ok()).toBe(true);
  await runBacktest(page, 'RSI-2');
  await lab(page).getByLabel('Saved runs').getByRole('button', { name: /Breakout/ }).click();
  await lab(page).getByRole('tab', { name: 'Compare' }).click();
  const panel = lab(page).getByRole('tabpanel');
  await expect(panel).toContainText('raises the odds that it won by luck');
  const names = panel.locator('table').first().locator('tbody th');
  await expect(names).toHaveText(['MA trend', 'Breakout', 'RSI-2']);
  await expect(panel).toContainText('2 other saved runs are left out');
  await names.nth(0).getByRole('button').click();
  await expect(lab(page).getByRole('heading', { name: /MA trend/ })).toBeVisible();
});

test('failures explain themselves: refused data, checks that fail after the save, and cancel', async ({ page }) => {
  await open(page);
  await lab(page).getByLabel(/^Stocks/).fill('REFUSE');
  await lab(page).getByRole('button', { name: 'Run backtest and checks' }).click();
  await expect(lab(page).getByRole('alert')).toContainText('None of the symbols have enough usable history.');
  await lab(page).getByRole('button', { name: 'Dismiss' }).click();

  await lab(page).getByLabel(/^Stocks/).fill('NOCHECK');
  await lab(page).getByRole('button', { name: 'Run backtest and checks' }).click();
  await expect(lab(page).getByRole('alert')).toContainText('The backtest is saved, but its checks did not finish.');
  await expect(lab(page).getByRole('tabpanel')).toContainText('These numbers have not been stress-tested.');
  await expect(lab(page).getByLabel('Saved runs')).toContainText('Not checked');

  await lab(page).getByRole('button', { name: 'New backtest' }).click();
  await lab(page).getByLabel(/^Stocks/).fill('SLOW');
  await lab(page).getByRole('button', { name: 'Run backtest and checks' }).click();
  await expect(lab(page).getByRole('status').first()).toContainText('Step 1 of 2: Running the backtest');
  await lab(page).getByRole('button', { name: 'Cancel' }).click();
  await expect(lab(page).getByRole('button', { name: 'Cancel' })).toHaveCount(0);
  await expect(lab(page).getByRole('alert')).toHaveCount(0);
  await expect(lab(page).getByLabel('Saved runs').locator('li')).toHaveCount(1);
});

test('keyboard: tabs, chart reading, Escape, focus return, and the LAB command', async ({ page }) => {
  await open(page);
  await runBacktest(page, 'MA trend');
  const overview = lab(page).getByRole('tab', { name: 'Overview' });
  await overview.focus();
  await page.keyboard.press('ArrowRight');
  await expect(lab(page).getByRole('tab', { name: 'Evidence' })).toBeFocused();
  await expect(lab(page).getByRole('tab', { name: 'Evidence' })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(overview).toBeFocused();

  const chart = lab(page).getByRole('img', { name: /Strategy ended at \$230,566/ });
  await chart.focus();
  await page.keyboard.press('Home');
  await expect(lab(page).locator('[role=status]').filter({ hasText: 'Jan 2024' })).toContainText('$100,000');
  await chart.hover({ position: { x: 300, y: 100 } });
  await expect(lab(page).locator('[role=status]').filter({ hasText: 'Strategy $' })).toBeVisible();
  await lab(page).getByRole('button', { name: 'Show table' }).click();
  await expect(lab(page).getByRole('tabpanel').locator('table').first()).toContainText('$230,566');

  await page.keyboard.press('Escape');
  await expect(lab(page)).toBeHidden();
  await expect(page.locator('#quant-open')).toBeFocused();

  await page.fill('#cmd', 'LAB');
  await page.keyboard.press('Enter');
  await expect(lab(page)).toBeVisible();
  await expect(lab(page).getByLabel('Saved runs')).toContainText('MA trend');
});

test('fits a phone without sideways scrolling', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await open(page);
  await runBacktest(page, 'MA trend');
  for (const name of ['Overview', 'Evidence', 'Compare', 'Plain English', 'Details']) {
    await lab(page).getByRole('tab', { name }).click();
    expect(await lab(page).evaluate((el) => el.scrollWidth - el.clientWidth), name).toBeLessThanOrEqual(0);
  }
});
