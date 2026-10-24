import { test, expect } from '@playwright/test';
import { seeded } from './helpers';

for (const viewport of [{ width: 1600, height: 1000 }, { width: 390, height: 844 }]) {
  test(`visual baseline ${viewport.width}x${viewport.height}`, async ({ page }) => {
    await page.setViewportSize(viewport);
    await page.clock.setFixedTime(new Date('2026-10-25T04:00:00Z'));
    await seeded(page);
    await expect(page.locator('#summary')).toContainText('S$92,967.48');
    await expect(page.locator('#markets .mkt-row').first()).toBeVisible();
    await expect(page.locator('#detail-body canvas').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    const mask = [page.locator('#clock, #market-state, #markets-time'), page.getByText(/\b\d+\s*(s|m|h|d|sec|min|hour|day)s? ago\b/)];
    for (const [name, selector] of [['summary', '#summary'], ['positions', '#positions-body'], ['markets', '#markets'], ['detail', '#detail-panel']] as const) {
      await expect(page.locator(selector)).toHaveScreenshot(`${name}-${viewport.width}.png`, {
        mask, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002,
      });
    }
  });
}
