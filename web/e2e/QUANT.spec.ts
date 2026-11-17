// FEAT-014: with the agent off, the Lab says what is wrong and how to fix it.
import { test, expect } from '@playwright/test';
import { seeded } from './helpers';

test('agent offline: the Lab explains and offers a retry', async ({ page }) => {
  await seeded(page);
  await page.click('#quant-open');
  const lab = page.getByRole('dialog', { name: 'QUANT LAB' });
  await expect(lab).toContainText('Kestrel is not running');
  await expect(lab.getByRole('button', { name: 'Try again' })).toBeVisible();
  await lab.getByRole('button', { name: /Close/ }).click();
  await expect(lab).toBeHidden();
});
