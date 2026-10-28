import { test, expect } from '@playwright/test';
import { seeded } from './helpers';
async function open(page: import('@playwright/test').Page) { await seeded(page); await page.click('#agent-toggle'); await expect(page.locator('.agent-input:visible')).toBeVisible(); }
async function send(page: import('@playwright/test').Page, question: string) { await page.locator('.agent-input:visible').fill('/committee ' + question + ' '); await page.locator('.agent-input:visible').press('Enter'); }
test('real API/engine/store: captured evidence, activity replay and cancellation', async ({ page }) => {
 await open(page); await send(page, 'review selected holding');
 await expect(page.locator('.agent-turn:visible').last()).toContainText('Synthetic review backed by captured quote.');
 await page.getByRole('button', { name: 'Inspect Kestrel Chair', exact: true }).click();
 await expect(page.locator('summary', { hasText: 'Kestrel Chair' })).toHaveCount(1);
 await page.reload();
 await page.locator('.kx-jump-row', { hasText: '/committee review selected holding' }).first().click();
 await page.getByRole('button', { name: 'Inspect Kestrel Chair', exact: true }).click();
 await expect(page.locator('summary', { hasText: 'Kestrel Chair' })).toHaveCount(1);
 await page.locator('.agent-icon-btn[title="New chat (/new)"]:visible').click();
 await send(page, 'slow review');
 await expect(page.locator('[data-role][data-state=running]').first()).toBeVisible();
 await page.locator('.agent-input:visible').press('Escape');
 await expect(page.locator('.agent-turn:visible').last()).toContainText('Interrupted by you.');
 await expect(page.locator('[data-role][data-state=running]')).toHaveCount(0);
});
test('real API/engine/store: a failed specialist yields explicit partial synthesis', async ({ page }) => {
 await open(page); await send(page, 'partial review');
 await expect(page.getByText('Partial chair synthesis',{exact:true})).toBeVisible();
 await page.getByRole('button', { name: 'Inspect Business & Growth', exact: true }).click();
 await expect(page.locator('summary', { hasText: 'Business & Growth · assessment · failed' })).toHaveCount(1);
});

test('wide chat presents one council panel and a distinct final result', async ({ page }, info) => {
 await page.setViewportSize({width:1600,height:1200});
 await page.addInitScript(()=>localStorage.setItem('finsight-agent-w','800'));
 await open(page); await send(page, 'review selected holding');
 await expect(page.locator('[data-council-board]')).toHaveCount(1);
 await expect(page.getByText('Chair synthesis',{exact:true})).toBeVisible();
 await page.locator('[data-council-board]').scrollIntoViewIfNeeded();
 await page.locator('#agent-panel').screenshot({path:info.outputPath('council-in-chat.png'),animations:'disabled'});
 const { default: AxeBuilder } = await import('@axe-core/playwright');
 const result = await new AxeBuilder({page}).include('[data-council-board]').include('[data-council-result]').withTags(['wcag2a','wcag2aa']).analyze();
 expect(result.violations).toEqual([]);
});
