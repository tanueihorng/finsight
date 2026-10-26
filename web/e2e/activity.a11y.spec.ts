// Activity must support keyboard access from its first render, including the
// gap before its island's effects run. Exercise actual overflowing content too.
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seeded } from './helpers';

declare global {
  interface Window {
    activityAtBirth?: { tabIndex: number; label: string | null; role: string | null };
  }
}

for (const width of [1600, 390]) {
  test.describe(`activity keyboard access at ${width}px`, () => {
    test.use({ viewport: { width, height: width === 390 ? 844 : 1000 } });
    test('focusable before island effects and scrollable with arrow keys', async ({ page }) => {
      await page.addInitScript(() => {
        const observer = new MutationObserver(() => {
          const activity = document.getElementById('activity');
          if (!activity) return;
          window.activityAtBirth = { tabIndex: activity.tabIndex, label: activity.getAttribute('aria-label'), role: activity.getAttribute('role') };
          observer.disconnect();
        });
        observer.observe(document, { childList: true, subtree: true });
      });
      await seeded(page);
      expect(await page.evaluate(() => window.activityAtBirth)).toEqual({ tabIndex: 0, label: 'Recent activity', role: 'region' });

      const csv = 'Symbol,Quantity,Price,Date\n' + Array.from({ length: 40 }, () => 'AAPL,1,150,2026-01-02').join('\n');
      const imported = await page.request.post('/api/portfolio/import?base=SGD', { data: { csv, replace: true } });
      expect(imported.ok(), await imported.text()).toBe(true);
      await page.reload();
      const activity = page.getByRole('region', { name: 'Recent activity', exact: true });
      await expect(activity.locator('.line')).toHaveCount(40);
      expect(await activity.evaluate((el) => el.scrollHeight > el.clientHeight)).toBe(true);
      // Tab from the preceding control, rather than programmatically focusing
      // the region: a tabindex=-1 would not provide this keyboard path.
      await page.locator('#ledger-btn').focus();
      await page.keyboard.press('Tab');
      await expect(activity).toBeFocused();
      await activity.evaluate((el) => { el.scrollTop = 0; });
      await page.keyboard.press('ArrowDown');
      await expect.poll(() => activity.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
      const axe = await new AxeBuilder({ page }).include('#activity').analyze();
      expect(axe.violations).toEqual([]);
    });
  });
}
