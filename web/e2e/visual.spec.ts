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
    // Fake market histories roll with the server day. Keep the price curve,
    // quantities and values under comparison, but exclude date-axis labels and
    // purchase-date FX-derived P&L (HANDOFF.md explicitly forbids asserting it).
    await page.evaluate(() => {
      document.querySelectorAll('#detail-body .chart-area').forEach((area) => {
        const marker = document.createElement('div'); marker.dataset.visualTimeAxis = '';
        marker.style.cssText = 'position:absolute;left:0;right:0;bottom:0;height:20px;pointer-events:none';
        area.append(marker);
      });
    });
    const cards = page.locator('#summary .card');
    const mask = [
      page.locator('#clock, #market-state, #markets-time, [data-visual-time-axis]'),
      page.getByText(/\b\d+\s*(s|m|h|d|sec|min|hour|day)s? ago\b/),
      cards.filter({ has: page.locator('.label', { hasText: /^(UNREALIZED P&L|FX P&L)$/ }) }).locator('.value, .sub'),
      cards.filter({ has: page.locator('.label', { hasText: /^TOTAL VALUE$/ }) }).locator('.sub'),
      page.locator('#positions-body tr[data-sym] td:nth-child(7), #positions-body tr[data-sym] td:nth-child(8), #positions-body tr[data-sym] td:nth-child(9)'),
    ];
    for (const [name, selector] of [['summary', '#summary'], ['positions', '.panel[data-pid="positions"]'], ['markets', '#markets'], ['detail', '#detail-panel']] as const) {
      await expect(page.locator(selector)).toHaveScreenshot(`${name}-${viewport.width}.png`, {
        mask, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.002,
      });
    }
  });
}
