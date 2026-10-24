import { test, expect } from '@playwright/test';
import { unlock } from '../helpers';

test('the Kestrel panel opens offline and says why', async ({ page }) => {
  await unlock(page);
  await page.click('#agent-toggle');
  await expect(page.locator('#agent-toggle')).toHaveAttribute('aria-expanded', 'true');
  const offline = page.locator('.agent-offline').first();
  await expect(offline).toBeVisible();
  await expect(offline).toContainText('offline.');
  await expect(offline).toContainText('The agent is turned off (AGENT_AUTOSTART=0).');
});
