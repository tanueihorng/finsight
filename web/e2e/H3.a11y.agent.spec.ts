import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { replySettings, seeded } from './helpers';

test('H3: live Kestrel, command suggestions, and chat picker have no serious/critical axe violations', async ({ page }) => {
  await seeded(page); await page.click('#agent-toggle');
  const input = page.locator('.agent-input:visible'); await expect(input).toBeVisible();
  await replySettings(page); await expect(page.locator('.agent-model:visible')).toBeVisible();
  async function scan() {
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.filter((v) => v.impact === 'serious' || v.impact === 'critical')).toEqual([]);
  }
  await scan();
  await input.fill('/'); await expect(page.locator('.agent-menu:visible')).toBeVisible(); await scan();
  await input.fill('H3 synthetic chat'); await input.press('Enter');
  await expect(page.locator('.agent-log')).toContainText('Echo: H3 synthetic chat');
  await page.getByRole('button', { name: 'Show chats' }).click();
  await expect(page.locator('.agent-thread-row').first()).toBeVisible(); await scan();
  const opener = page.locator('.agent-thread-open').first();
  await opener.focus();
  await page.keyboard.press('Tab');
  await expect(page.locator('.agent-thread-row .x').first()).toBeFocused();
  expect(await page.locator('.agent-thread-row .x').first().evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  await opener.focus(); await page.keyboard.press('Enter'); await expect(page.locator('.agent-threads')).toBeHidden();
});
