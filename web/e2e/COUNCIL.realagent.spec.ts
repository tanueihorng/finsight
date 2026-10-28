import { test, expect } from '@playwright/test';
import { seeded } from './helpers';
async function open(page: import('@playwright/test').Page) { await seeded(page); await page.click('#agent-toggle'); await expect(page.locator('.agent-input:visible')).toBeVisible(); }
async function send(page: import('@playwright/test').Page, question: string) { await page.locator('.agent-input:visible').fill('/committee ' + question + ' '); await page.locator('.agent-input:visible').press('Enter'); }
test('real API/engine/store: captured evidence, activity replay and cancellation', async ({ page }) => {
 await open(page); await send(page, 'review selected holding');
 await expect(page.locator('.agent-turn:visible').last()).toContainText('Synthetic review backed by captured quote.');
 await expect(page.locator('summary', { hasText: 'Kestrel Chair' })).toHaveCount(1);
 await page.reload();
 await page.locator('.kx-jump-row', { hasText: '/committee review selected holding' }).first().click();
 await expect(page.locator('summary', { hasText: 'Kestrel Chair' })).toHaveCount(1);
 await page.locator('.agent-icon-btn[title="New chat (/new)"]:visible').click();
 await send(page, 'slow review');
 await expect(page.locator('summary', { hasText: 'assessment · running' }).first()).toBeVisible();
 await page.locator('.agent-input:visible').press('Escape');
 await expect(page.locator('.agent-turn:visible').last()).toContainText('Interrupted by you.');
 await expect(page.locator('summary', { hasText: 'assessment · running' })).toHaveCount(0);
});
test('real API/engine/store: a failed specialist yields explicit partial synthesis', async ({ page }) => {
 await open(page); await send(page, 'partial review');
 await expect(page.locator('.agent-turn:visible').last()).toContainText('Partial council review');
 await expect(page.locator('summary', { hasText: 'Business & Growth · assessment · failed' })).toHaveCount(1);
});
