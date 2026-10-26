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
