// Kestrel chat against the fake agent (web/e2e/fake-agent.mjs) through
// FinSight's /api/agent proxy: stream, stop, reconnect, attachments, docking.
import { test, expect, type Page } from '@playwright/test';
import { unlock } from '../helpers';

const FAKE_AGENT = `http://127.0.0.1:${Number(process.env.E2E_PORT_BASE || 8096) + 1}`;

async function openChat(page: Page) {
  await unlock(page);
  await page.click('#agent-toggle');
  const input = page.locator('.agent-input:visible');
  await expect(input).toBeVisible();
  await expect(page.locator('.agent-send:visible')).toBeEnabled();
  return input;
}
async function send(page: Page, text: string) {
  const input = page.locator('.agent-input:visible');
  await input.fill(text);
  await input.press('Enter');
}
const lastTurn = (page: Page) => page.locator('.agent-turn:visible').last();

test('a message streams in and the turn finishes', async ({ page }) => {
  await openChat(page);
  await send(page, 'hello there kestrel');
  await expect(page.locator('.agent-user:visible').last()).toContainText('hello there kestrel');
  await expect(lastTurn(page).locator('.agent-text')).toHaveText('Echo: hello there kestrel');
  await expect(page.locator('.agent-send:visible')).toHaveAttribute('aria-label', 'Send');
});

test('stop interrupts a running turn', async ({ page }) => {
  await openChat(page);
  await send(page, 'slow one please');
  const text = lastTurn(page).locator('.agent-text');
  await expect(text).toContainText('w3');
  await expect(page.locator('.agent-send:visible')).toHaveAttribute('aria-label', 'Stop');
  await page.locator('.agent-send:visible').click();
  await expect(lastTurn(page)).toContainText('Interrupted by you.');
  await expect(page.locator('.agent-send:visible')).toHaveAttribute('aria-label', 'Send');
  await page.waitForTimeout(800);
  await expect(text).not.toContainText('w40');
});

async function dropMidTurn(page: Page, mode: 'end' | 'destroy') {
  await openChat(page);
  await send(page, `slow and steady ${mode}`);
  const text = lastTurn(page).locator('.agent-text');
  await expect(text).toContainText('w5');
  const r = await page.request.post(`${FAKE_AGENT}/v1/__test/drop${mode === 'end' ? '?mode=end' : ''}`);
  expect((await r.json()).dropped).toBeGreaterThan(0);
  await expect(text).toContainText('w40', { timeout: 15_000 });
  expect((await text.innerText()).split(/\s+/)).toEqual(Array.from({ length: 40 }, (_, i) => `w${i + 1}`));
}

test('the stream reconnects after the agent closes it, without duplicates', async ({ page }) => {
  test.setTimeout(45_000);
  await dropMidTurn(page, 'end');
});

test('the stream reconnects after the agent connection is cut', async ({ page }) => {
  test.setTimeout(45_000);
  await dropMidTurn(page, 'destroy');
});

test('an attached file is uploaded and sent with the message', async ({ page }) => {
  await openChat(page);
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello file') });
  await expect(page.locator('.agent-panel, #agent-dock').getByText('notes.txt').first()).toBeVisible();
  await send(page, 'read this');
  await expect(lastTurn(page).locator('.agent-text')).toHaveText('Echo: read this (1 attachment)');
});

test('switching between docked and side modes keeps the conversation', async ({ page }) => {
  await openChat(page);
  await send(page, 'remember me');
  await expect(lastTurn(page).locator('.agent-text')).toHaveText('Echo: remember me');
  const docked = () => page.locator('#agent-dock').isVisible();
  const before = await docked();
  await page.locator(`.agent-icon-btn[title="${before ? 'Pop out to the side panel' : 'Dock into the terminal'}"]`).click();
  await expect.poll(docked).toBe(!before);
  if (before) await expect(page.locator('body')).toHaveClass(/\bagent-open\b/);
  await expect(page.locator('.agent-user:visible').last()).toContainText('remember me');
  await expect(lastTurn(page).locator('.agent-text')).toHaveText('Echo: remember me');
});
