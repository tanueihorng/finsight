import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seeded, PIN } from './helpers';
const input = (p: Page) => p.locator('.agent-input:visible');
async function open(p: Page) {
  await seeded(p);
  await p.evaluate(() => { localStorage.setItem('finsight-agent-mode', 'side'); localStorage.removeItem('finsight-agent-thread'); });
  await p.reload(); await p.click('#agent-toggle'); await expect(input(p)).toBeVisible();
}
async function send(p: Page, s: string) { await input(p).fill(s); await input(p).press('Enter'); }
async function reopen(p: Page, title: string) {
  await p.getByRole('button', { name: 'Show chats', exact: true }).click();
  await p.locator('.agent-thread-open:visible').filter({ hasText: title }).first().click();
}
test('verified cards/table, numeric keyboard sorting, faithful copy, duplicate replay and reload', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page); await send(page, 'uiview snapshot');
  const view = page.locator('.kx-ui:visible');
  await expect(view).toHaveCount(1); await expect(view.locator('dd')).toHaveText('SGD 4,350.00');
  await expect(view.locator('tbody tr').first()).toContainText('USD 1,000.00');
  const sort = view.getByRole('button', { name: 'Cash value' });
  await sort.focus(); await page.keyboard.press('Enter');
  await expect(sort.locator('..')).toHaveAttribute('aria-sort', 'ascending');
  await page.keyboard.press('Enter');
  await expect(view.locator('tbody tr').first()).toContainText('SGD 3,000.00');
  await expect(page.locator('.agent-send:visible')).toHaveAttribute('aria-label', 'Send');
  await page.getByTitle('Copy answer', { exact: true }).last().click();
  await expect(page.getByTitle('Copy answer', { exact: true }).last()).toHaveText('copied');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('SGD 4,350.00');
  await page.reload(); await reopen(page, 'uiview snapshot');
  await expect(view).toHaveCount(1); await expect(view.locator('dd')).toHaveText('SGD 4,350.00');
  await expect(page.locator('.agent-tool').filter({ hasText: 'render_ui' })).toHaveCount(0);
  if (process.env.IUI_SCREENSHOT) await view.screenshot({ path: process.env.IUI_SCREENSHOT });
  const a = await new AxeBuilder({ page }).include('.kx-ui').analyze();
  expect(a.violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''))).toEqual([]);
});
test('UNPEEK removes snapshot text including copy and equivalent; responsive table scrolls locally', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await open(page); await send(page, 'uiview privacy');
  await expect(page.locator('.kx-ui dd')).toHaveText('SGD 4,350.00');
  await page.evaluate(() => window.FinSight.store.setState({ peek: false }));
  await expect(page.locator('.kx-ui-hidden')).toHaveText('Snapshot hidden by UNPEEK.');
  await expect(page.locator('.kx-ui')).toHaveCount(0);
  await expect(page.locator('.agent-send:visible')).toHaveAttribute('aria-label', 'Send');
  await page.getByTitle('Copy answer', { exact: true }).last().click();
  await expect(page.getByTitle('Copy answer', { exact: true }).last()).toHaveText('copied');
  const copy = await page.evaluate(() => navigator.clipboard.readText());
  expect(copy).toContain('[Snapshot hidden by UNPEEK]'); expect(copy).not.toContain('4,350');
  await page.evaluate(() => window.FinSight.store.setState({ peek: true }));
  await page.setViewportSize({ width: 320, height: 844 });
  await expect(page.locator('.kx-ui')).toBeVisible();
  const width = await page.locator('.kx-ui-scroll').evaluate((e) => ({ outer: e.clientWidth, inner: e.scrollWidth }));
  expect(width.outer).toBeLessThanOrEqual(320); expect(width.inner).toBeGreaterThan(width.outer);
  await page.locator('.kx-ui-scroll').focus(); await expect(page.locator('.kx-ui-scroll')).toBeFocused();
});
test('rejected raw tool args never render, including reload; unsupported versions degrade safely', async ({ page }) => {
  await open(page); await send(page, 'uibad rejected');
  await expect(page.locator('.agent-tool.err')).toHaveCount(1); await expect(page.locator('.kx-ui')).toHaveCount(0);
  await page.reload(); await reopen(page, 'uibad rejected');
  await expect(page.locator('.agent-tool.err')).toHaveCount(1); await expect(page.locator('.kx-ui')).toHaveCount(0);
  await send(page, 'uiunknown future');
  await expect(page.locator('.agent-notice.warn').last()).toContainText('unavailable in this version');
  await expect(page.locator('.kx-ui')).toHaveCount(0);
});
test('late snapshot events while locked are ignored; accepted snapshot reloads after unlock', async ({ page }) => {
  await open(page); await send(page, 'uidelay slow');
  await expect(page.locator('.agent-tool')).toHaveCount(1); await page.click('#lock-btn');
  await expect(page.locator('body')).toHaveClass(/locked/);
  await page.waitForTimeout(2200);
  await expect(page.locator('.kx-ui')).toHaveCount(0);
  await page.fill('#lock-pin', PIN); await page.press('#lock-pin', 'Enter');
  await expect(page.locator('body')).not.toHaveClass(/locked/);
  await expect(page.locator('.kx-ui')).toHaveCount(1); // unlock replays the accepted event, without reload
  await page.reload(); await reopen(page, 'uidelay slow');
  await expect(page.locator('.kx-ui')).toHaveCount(1);
});

test('stock chart shows source prices, supports keyboard inspection and survives reload', async ({ page }) => {
  await open(page); await send(page, 'uichart price');
  const view = page.locator('.kx-ui:visible');
  await expect(view.getByRole('img', { name: 'AMD historical closing prices in USD' })).toBeVisible();
  const slider = view.getByRole('slider', { name: 'AMD chart date' });
  await expect(slider).toHaveAttribute('aria-valuetext', '2024-01-11: USD 120.00');
  await expect(view.locator('polyline')).toHaveAttribute('points', /^0\.00,[\d.]+ 60\.00,[\d.]+ 600\.00,[\d.]+$/);
  await slider.focus(); await page.keyboard.press('ArrowLeft');
  await expect(slider).toHaveAttribute('aria-valuetext', '2024-01-02: USD 110.00');
  await expect(view).toContainText('Historical close prices; snapshot, not a live quote.');
  await page.reload(); await reopen(page, 'uichart price');
  await expect(page.getByRole('img', { name: 'AMD historical closing prices in USD' })).toBeVisible();
  await page.evaluate(() => window.FinSight.store.setState({ peek: false }));
  await expect(page.locator('.kx-ui-hidden')).toBeVisible();
});

test('price chart range and safe actions prepare an editable alert without saving', async ({ page }) => {
  await open(page); await send(page, 'uichart actions');
  const view = page.locator('.kx-ui:visible');
  await view.getByRole('button', { name: '1M', exact: true }).click();
  await expect(view.getByRole('button', { name: '1M', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await expect(view).toContainText('Ranges filter this saved snapshot');
  await view.getByRole('button', { name: 'Open full chart' }).click();
  await expect(page.locator('#detail-title')).toContainText('AMD');
  let writes = 0; page.on('request', (r) => { if (r.url().includes('/api/alerts/add')) writes++; });
  await view.getByRole('button', { name: 'Prepare price alert' }).click();
  await expect(page.locator('#alert-form')).toBeVisible();
  await expect(page.getByLabel('Alert symbol')).toHaveValue('AMD');
  await expect(page.getByLabel('Alert price')).toHaveValue('120');
  await expect(page.locator('#alert-form')).toContainText('Nothing is saved until you press SET');
  await page.getByLabel('Alert price').fill('125');
  await expect(page.locator('#alert-form')).toContainText('initially uses the historical close');
  expect(writes).toBe(0);
});
test('exposure visualization displays bound values and can open the ledger', async ({ page }) => {
  await open(page); await send(page, 'uiexposure breakdown');
  const view = page.locator('.kx-ui:visible');
  await expect(view).toContainText('Tech'); await expect(view).toContainText('60%');
  await expect(view.locator('.kx-exposure-track i').first()).toHaveAttribute('style', 'width: 60%;');
  await expect(view).toContainText('no look-through');
  await view.getByRole('button', { name: 'Open ledger' }).click();
  await expect(page.getByRole('dialog', { name: 'Trades and realized gains' })).toBeVisible();
});

test('preparing a chart alert preserves an existing unsaved alert draft', async ({ page }) => {
  await open(page); await send(page, 'uichart preserve');
  await page.locator('#alert-toggle').click();
  await page.getByLabel('Alert symbol').fill('VOO'); await page.getByLabel('Alert price').fill('200');
  await page.locator('#alert-toggle').click(); // hidden forms retain unsaved input
  await page.locator('.kx-ui:visible').getByRole('button', { name: 'Prepare price alert' }).click();
  await page.locator('#alert-toggle').click();
  await expect(page.getByLabel('Alert symbol')).toHaveValue('VOO');
  await expect(page.getByLabel('Alert price')).toHaveValue('200');
  await expect(page.locator('#cmd-status')).toContainText('Finish or clear the current alert draft');
});

test('chart filters only the saved dates and supports pointer inspection', async ({ page }) => {
  await open(page); await send(page, 'uichartrange test');
  const view = page.locator('.kx-ui:visible');
  await view.getByRole('button', { name: '1M', exact: true }).click();
  await expect(view.getByRole('slider', { name: 'AMD chart date' })).toHaveAttribute('min', '1');
  await expect(view).toContainText('2024-02-01');
  const graph = view.getByRole('img', { name: 'AMD historical closing prices in USD' });
  const box = await graph.boundingBox(); expect(box).not.toBeNull();
  await page.mouse.move(box!.x + 1, box!.y + box!.height / 2);
  await expect(view.getByRole('slider', { name: 'AMD chart date' })).toHaveAttribute('aria-valuetext', '2024-02-01: USD 110.00');
});
