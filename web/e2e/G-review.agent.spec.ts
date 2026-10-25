// Phase 3 review follow-ups for the Kestrel chat (KESTRELFIX-001). Each test
// passes against legacy agent-panel.js at c1f1516 as well as the React chat:
// Esc to stop, the offline retry and a lock/unlock while the chat is open.
import { test, expect, type Page } from '@playwright/test';
import { PIN, seeded } from './helpers';

const input = (page: Page) => page.locator('.agent-input:visible');
const lastTurn = (page: Page) => page.locator('.agent-turn:visible').last();
async function open(page: Page) {
  await seeded(page);
  await page.evaluate(() => { localStorage.setItem('finsight-agent-mode', 'side'); localStorage.removeItem('finsight-agent-thread'); });
  await page.reload();
  await expect(page.locator('#detail-title')).toHaveText('VOO · DETAIL');
  await page.click('#agent-toggle');
  await expect(input(page)).toBeVisible();
  await expect(page.locator('.agent-send:visible')).toBeEnabled();
}
async function send(page: Page, text: string) { await input(page).fill(text); await input(page).press('Enter'); }

test('Esc in the composer stops a running reply and keeps the panel open', async ({ page }) => {
  await open(page);
  await send(page, 'slow one please');
  const text = lastTurn(page).locator('.agent-text');
  await expect(text).toContainText('w3');
  await expect(page.locator('.agent-send:visible')).toHaveText('■');
  await input(page).press('Escape');
  await expect(lastTurn(page)).toContainText('Interrupted by you.');
  await expect(page.locator('.agent-send:visible')).toHaveText('⏎');
  await expect(page.locator('body')).toHaveClass(/\bagent-open\b/);
  await page.waitForTimeout(800);
  await expect(text).not.toContainText('w40');
});

test('offline: retry reconnects once the agent is back', async ({ page }) => {
  await seeded(page);
  await page.evaluate(() => { localStorage.setItem('finsight-agent-mode', 'side'); localStorage.removeItem('finsight-agent-thread'); });
  await page.route('**/api/agent/**', (r) => r.fulfill({ status: 503, json: { error: { code: 'AGENT_OFFLINE', message: 'The agent is not running.' } } }));
  await page.route('**/api/agent-status', (r) => r.fulfill({ json: { status: 'crashed', logFile: '/tmp/agent.log' } }));
  await page.reload();
  await page.click('#agent-toggle');
  const offline = page.locator('.agent-offline:visible');
  await expect(offline).toContainText('Kestrel offline. The agent keeps crashing. Details are in its log:');
  await expect(offline.locator('code')).toHaveText('/tmp/agent.log');
  await expect(page.locator('.agent-send:visible')).toBeDisabled();
  // Still down: retry keeps the offline view.
  await offline.getByRole('button', { name: 'retry' }).click();
  await expect(offline).toBeVisible();
  await page.unroute('**/api/agent/**');
  await page.unroute('**/api/agent-status');
  await offline.getByRole('button', { name: 'retry' }).click();
  await expect(page.locator('.agent-welcome:visible')).toBeVisible();
  await expect(page.locator('.agent-send:visible')).toBeEnabled();
  await send(page, 'back online');
  await expect(lastTurn(page).locator('.agent-text')).toHaveText('Echo: back online');
});

test('lock and unlock with the chat open: the conversation stays and replies still stream', async ({ page }) => {
  await open(page);
  await send(page, 'before the lock');
  await expect(lastTurn(page).locator('.agent-text')).toHaveText('Echo: before the lock');
  await page.click('#lock-btn');
  await expect(page.locator('body')).toHaveClass(/\blocked\b/);
  await page.fill('#lock-pin', PIN);
  await page.press('#lock-pin', 'Enter');
  await expect(page.locator('body')).not.toHaveClass(/\blocked\b/);
  await expect(page.locator('body')).toHaveClass(/\bagent-open\b/);
  await expect(page.locator('.agent-user:visible').first()).toContainText('before the lock');
  await send(page, 'after the unlock');
  await expect(lastTurn(page).locator('.agent-text')).toHaveText('Echo: after the unlock');
  await expect(page.locator('.agent-send:visible')).toHaveText('⏎');
});

test('a chat left open boots after the PIN is entered on a locked reload', async ({ page, context }) => {
  await open(page);
  await send(page, 'kept chat');
  await expect(lastTurn(page).locator('.agent-text')).toHaveText('Echo: kept chat');
  await context.clearCookies();
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/\blocked\b/);
  await page.fill('#lock-pin', PIN);
  await page.press('#lock-pin', 'Enter');
  await expect(page.locator('body')).not.toHaveClass(/\blocked\b/);
  await expect(page.locator('.agent-user:visible').last()).toContainText('kept chat');
  await send(page, 'and again');
  await expect(lastTurn(page).locator('.agent-text')).toHaveText('Echo: and again');
});
