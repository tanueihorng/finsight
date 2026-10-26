import { test, expect } from '@playwright/test';
import { seeded, answerDialog } from './helpers';

for (const width of [390, 1600]) {
  test(`setup exits stay clickable above Kestrel at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await seeded(page); await page.click('#agent-toggle');
    await expect(page.locator('.agent-input:visible')).toBeVisible();
    // Also reproduces the first-launch/account-ready setup trigger while chat is open.
    await page.evaluate(() => window.FinSight.store.setState({ setupOpen: true }));
    const modal = page.locator('#setup-modal');
    await expect(modal).toBeVisible();
    const modalLayer = await modal.evaluate((el) => Number(getComputedStyle(el).zIndex));
    const chatLayer = await page.locator('#agent-panel').evaluate((el) => Number(getComputedStyle(el).zIndex));
    expect(modalLayer, 'Setup must be drawn above the open chat, even when chat is inert').toBeGreaterThan(chatLayer);
    for (const selector of ['#setup-skip', '#setup-save', '.setup-choice[data-action="import"]', '.setup-choice[data-action="manual"]', '.setup-choice[data-action="empty"]']) {
      const control = modal.locator(selector);
      await expect(control).toBeInViewport({ ratio: 1 });
      expect(await control.evaluate((el) => {
        const r = el.getBoundingClientRect();
        return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
      }), `${selector} is covered`).toBe(true);
    }
    await modal.screenshot({ path: testInfo.outputPath('setup-above-chat.png') });
    await page.click('#setup-skip'); await expect(modal).toBeHidden();
    await expect(page.locator('.agent-input:visible')).toBeEnabled();
    await page.evaluate(() => window.FinSight.store.setState({ setupOpen: true }));
    await page.click('#setup-save'); await expect(modal).toBeHidden();
    await expect(page.locator('.agent-input:visible')).toBeEnabled();
  });
}
test('an import confirmation stays above its modal while Kestrel is open', async ({ page }) => {
  await seeded(page); await page.click('#agent-toggle');
  await expect(page.locator('.agent-input:visible')).toBeVisible();
  await page.evaluate(() => window.FinSight.store.setState({ importOpen: true }));
  await page.click('#import-clear');
  await expect(page.locator('#app-dialog')).toBeVisible();
  expect(await page.locator('#app-dialog-cancel').evaluate((el) => {
    const r = el.getBoundingClientRect();
    return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
  })).toBe(true);
  await answerDialog(page, { accept: false });
  await expect(page.locator('#import-modal')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('#import-modal')).toBeHidden();
});
