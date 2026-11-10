import { test, expect } from '@playwright/test';
import { seeded } from './helpers';

// Kestrel limits: the user edits spending and tool ceilings from the terminal.
test('limits open from the Today spend and /limits, save only changes, and empty means default', async ({ page }) => {
  await seeded(page);
  await page.click('#agent-toggle');
  await page.getByRole('button', { name: 'Open full page' }).click();
  await page.locator('button.kx-spend').click();
  await page.getByRole('tab', { name: 'Limits' }).click();
  const dialog = page.getByRole('dialog', { name: 'Kestrel settings' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText('Spent today: US$0.50 of US$5.00');
  await expect(page.locator('#limit-dayUsd')).toHaveAttribute('placeholder', 'US$5');

  await page.locator('#limit-turnSteps').fill('80');
  await page.locator('#limits-save').click();
  await expect(dialog.getByRole('alert')).toHaveText('Steps per reply: between 1 and 50');
  await page.locator('#limit-turnSteps').fill('');
  await page.locator('#limit-dayUsd').fill('12');
  const saved = page.waitForRequest((r) => r.url().endsWith('/api/agent/limits') && r.method() === 'PATCH');
  await page.locator('#limits-save').click();
  expect((await saved).postDataJSON()).toEqual({ dayUsd: 12 });
  await expect(dialog).toBeHidden();

  await page.locator('.agent-input:visible').fill('/limits ');
  await page.locator('.agent-input:visible').press('Enter');
  await expect(dialog).toBeVisible();
  await expect(page.locator('#limit-dayUsd')).toHaveValue('12');
  await expect(dialog.locator('.kx-limit', { hasText: 'Daily spend cap' })).toContainText('set');
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});
