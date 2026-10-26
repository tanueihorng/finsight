import { test, expect, type Page } from '@playwright/test';
import { seeded, answerDialog } from './helpers';
const input = (page: Page) => page.locator('.agent-input:visible');
async function open(page: Page) { await seeded(page); await page.click('#agent-toggle'); await expect(input(page)).toBeVisible(); }
async function send(page: Page, text: string) { await expect(page.locator('.agent-send:visible')).toBeEnabled(); await input(page).fill(text.startsWith('/') ? text + ' ' : text); await input(page).press('Enter'); }
async function chat(page: Page, text: string) { await send(page, text); await expect(page.locator('.agent-turn:visible').last()).toContainText('Echo: ' + text); }
test('header delete asks first; cancel keeps the chat and confirm returns home', async ({ page }) => {
  await open(page); await chat(page, 'header deletion fixture');
  await page.locator('[aria-label="Delete current chat"]:visible').click(); await answerDialog(page, { accept: false });
  await expect(page.locator('[aria-label="Delete current chat"]:visible')).toBeVisible();
  await page.locator('[aria-label="Delete current chat"]:visible').click(); await answerDialog(page);
  await expect(page.locator('.kx-start:visible')).toBeVisible();
  await expect(page.locator('[aria-label="Delete current chat"]')).toHaveCount(0);
});
test('/clear preserves history; recent-list deletion removes a saved chat; /delete asks first', async ({ page }) => {
  await open(page); await chat(page, 'recent deletion fixture'); await send(page, '/clear');
  await expect(page.locator('.kx-start:visible')).toBeVisible();
  const entry = page.locator('.kx-jump-entry').filter({ hasText: 'recent deletion fixture' });
  await expect(entry).toHaveCount(1); await entry.hover(); await entry.locator('.kx-jump-delete').click(); await answerDialog(page);
  await expect(entry).toHaveCount(0);
  await chat(page, 'slash deletion fixture'); await send(page, '/delete'); await answerDialog(page);
  await expect(page.locator('.kx-start:visible')).toBeVisible();
});
test('Clear all chats requires both confirmations; cancelling the second keeps chats', async ({ page }) => {
  await open(page); await chat(page, 'bulk deletion fixture'); await send(page, '/clear');
  // Open the narrow rail if needed.
  const clear = page.locator('.kx-clear-all:visible');
  if (!await clear.count()) await page.locator('[aria-label="Show chats"]:visible').click();
  const review = async () => {
    await clear.click(); await expect(page.locator('#app-dialog-title')).toHaveText('Clear all chats?');
    await page.click('#app-dialog-ok');
    await expect(page.locator('#app-dialog-title')).toHaveText(/^Permanently delete \d+ chats\?$/);
  };
  await review(); await answerDialog(page, { accept: false });
  await expect(page.locator('.agent-thread-row').filter({ hasText: 'bulk deletion fixture' })).toHaveCount(1);
  await review(); await answerDialog(page);
  await expect(page.locator('.agent-thread-row')).toHaveCount(0);
});

for (const width of [390, 1600]) {
  test(`chat-row date and delete button do not overlap at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await open(page); await chat(page, 'A long synthetic chat title that must truncate before its date and delete control');
    await page.locator('[aria-label="Show chats"]:visible').click();
    const row = page.locator('.agent-thread-row.active');
    await row.hover();
    const date = row.locator('.d'), remove = row.locator('.x');
    await expect(remove).toBeVisible();
    const d = (await date.boundingBox())!, x = (await remove.boundingBox())!, title = (await row.locator('.t').boundingBox())!;
    expect(title.x + title.width).toBeLessThanOrEqual(d.x);
    expect(d.x + d.width + 5).toBeLessThanOrEqual(x.x);
    await row.screenshot({ path: testInfo.outputPath('chat-row-spacing.png') });
    await remove.focus();
    const focusedDate = (await date.boundingBox())!, focusedRemove = (await remove.boundingBox())!;
    expect(focusedDate.x + focusedDate.width + 5).toBeLessThanOrEqual(focusedRemove.x);
  });
}
