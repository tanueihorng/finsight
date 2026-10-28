// Phase 3 review follow-ups for the Kestrel chat (KESTRELFIX-001). Each test
// is legacy agent-panel.js (c1f1516) behaviour and passes against it: notices
// on a fresh chat, the welcome's suggestions, the rotating status verb, Esc to
// stop, the offline retry and a lock/unlock while the chat is open.
import { test, expect, type Page } from '@playwright/test';
import { PIN, seeded } from './helpers';

const input = (page: Page) => page.locator('.agent-input:visible');
const lastTurn = (page: Page) => page.locator('.agent-turn:visible').last();
const log = (page: Page) => page.locator('.agent-log:visible');
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

test('a fresh chat shows attachment and upload notices under the welcome', async ({ page }) => {
  await open(page);
  await expect(page.locator('.kx-start:visible')).toBeVisible();
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: 'huge.pdf', mimeType: 'application/pdf', buffer: Buffer.alloc(15 * 1024 * 1024 + 1) });
  await expect(log(page).locator('.agent-notice.error')).toHaveText('huge.pdf: larger than 15 MB');
  await expect(page.locator('.kx-start:visible')).toBeVisible();
  await expect(page.locator('.agent-attach-row:visible .agent-file')).toHaveCount(0);

  // Hold the upload so the chip stays "uploading", then try to send.
  let release!: () => void;
  const held = new Promise<void>((r) => { release = r; });
  await page.route('**/api/agent/uploads', async (route) => { await held; await route.continue(); });
  await page.locator('input[type="file"][multiple]').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello file') });
  await expect(page.locator('.agent-attach-row:visible')).toContainText('notes.txt uploading…');
  await send(page, 'read this');
  await expect(log(page).locator('.agent-notice.warn')).toHaveText('Wait for uploads to finish.');
  await expect(page.locator('.kx-start:visible')).toBeVisible();
  await expect(input(page)).toHaveValue('read this');
  release();
  await expect(page.locator('.agent-attach-row:visible')).not.toContainText('uploading');
  await page.unroute('**/api/agent/uploads');
  // Sending starts the chat: the welcome and its notices give way to the conversation.
  await input(page).press('Enter');
  await expect(lastTurn(page).locator('.agent-text')).toHaveText('Echo: read this (1 attachment)');
  await expect(page.locator('.kx-start')).toHaveCount(0);
  await expect(log(page).locator('.agent-notice')).toHaveCount(0);
});

test('the welcome keeps the suggestions it opened with; the context button follows the selection', async ({ page }) => {
  await open(page);
  const first = page.locator('.agent-try .kx-strategy');
  await expect(first).toHaveText('What do my strategies say about VOO right now?');
  await page.locator('#positions-body tr[data-sym="NVDA"]').click();
  await expect(page.locator('#detail-title')).toHaveText('NVDA · DETAIL');
  await expect(page.locator('.agent-ctx:visible')).toHaveText('◉ NVDA 1d');
  await expect(first).toHaveText('What do my strategies say about VOO right now?');
  // A new chat builds a new welcome from what is selected then.
  await page.locator('.agent-icon-btn[title="New chat (/new)"]:visible').click();
  await expect(page.locator('.agent-try .kx-strategy')).toHaveText('What do my strategies say about NVDA right now?');
});

// The send reply and the turn.started event can each start a reply (whichever
// comes first), and each picks a verb, so a second pick may follow within
// moments. After that the verb holds, then changes every 3 s. Every shown verb
// is recorded with its time (no sampling, no fixed waits).
async function verbRotation(page: Page, lateTurnStarted: boolean) {
  if (lateTurnStarted) {
    // The order seen under load: the send reply first, turn.started 400 ms later.
    await page.addInitScript(() => {
      const add = EventSource.prototype.addEventListener;
      EventSource.prototype.addEventListener = function (this: EventSource, type: string, fn: EventListener, o?: boolean | AddEventListenerOptions) {
        return add.call(this, type, type === 'turn.started' ? (e: Event) => { setTimeout(() => fn(e), 400); } : fn, o);
      } as typeof add;
    });
  }
  // Deterministic verbs: each Math.random() call picks the next verb in the list, so every pick is a visible change.
  await page.addInitScript(() => { let n = 0; Math.random = () => ((n++ % 18) + 0.5) / 18; });
  await open(page);
  type Shown = { t: number; v: string };
  await page.evaluate(() => {
    const w = window as unknown as { __verbs: Shown[] };
    w.__verbs = [];
    const record = () => { const v = document.querySelector('.agent-status .verb')?.textContent; if (v && v !== w.__verbs.at(-1)?.v) w.__verbs.push({ t: performance.now(), v }); };
    new MutationObserver(record).observe(document.body, { subtree: true, childList: true, characterData: true });
  });
  const shown = () => page.evaluate(() => (window as unknown as { __verbs: Shown[] }).__verbs);
  const rotations = (list: Shown[]) => {
    const gaps = list.slice(1).map((x, i) => x.t - list[i]!.t);
    return gaps[0] !== undefined && gaps[0] < 1000 ? gaps.slice(1) : gaps;
  };
  await send(page, 'slow one please');
  await expect.poll(async () => rotations(await shown()).length, { timeout: 15_000 }).toBeGreaterThanOrEqual(2);
  const list = await shown();
  for (const gap of rotations(list)) expect(gap, JSON.stringify(list)).toBeGreaterThan(2400); // holds between rotations
  for (const gap of rotations(list)) expect(gap, JSON.stringify(list)).toBeLessThan(4000); // and does rotate
  await page.locator('.agent-send:visible').click();
  await expect(lastTurn(page)).toContainText('Interrupted by you.');
}
test('the status verb rotates every 3 s while a reply runs', async ({ page }) => { await verbRotation(page, false); });
test('the status verb rotates every 3 s when turn.started arrives after the send reply', async ({ page }) => { await verbRotation(page, true); });

test('a streaming reply updates with each delta while earlier answers stay rendered', async ({ page }) => {
  await open(page);
  await send(page, 'markdown please');
  const earlier = page.locator('.agent-turn:visible').first().locator('.agent-text');
  await expect(earlier.locator('td.num')).toHaveText('+1.5%');
  await expect(page.locator('.agent-send:visible')).toHaveAttribute('aria-label', 'Send'); // Enter does not send while a reply runs
  await send(page, 'slow one please');
  const text = lastTurn(page).locator('.agent-text');
  await expect(text).toContainText('w3');
  await expect(page.locator('.agent-send:visible')).toHaveAttribute('aria-label', 'Stop');
  const mid = (await text.innerText()).split(/\s+/).length;
  await expect.poll(async () => (await text.innerText()).split(/\s+/).length).toBeGreaterThan(mid + 2);
  await expect(page.locator('.agent-send:visible')).toHaveAttribute('aria-label', 'Stop');
  await expect(text).toContainText('w40', { timeout: 15_000 });
  expect((await text.innerText()).split(/\s+/)).toEqual(Array.from({ length: 40 }, (_, i) => `w${i + 1}`));
  await expect(earlier.locator('h2')).toHaveText('Head');
  await expect(earlier.locator('td.num')).toHaveText('+1.5%');
  await expect(page.locator('.agent-turn:visible')).toHaveCount(2);
});

test('Esc in the composer stops a running reply and keeps the panel open', async ({ page }) => {
  await open(page);
  await send(page, 'slow one please');
  const text = lastTurn(page).locator('.agent-text');
  await expect(text).toContainText('w3');
  await expect(page.locator('.agent-send:visible')).toHaveAttribute('aria-label', 'Stop');
  await input(page).press('Escape');
  await expect(lastTurn(page)).toContainText('Interrupted by you.');
  await expect(page.locator('.agent-send:visible')).toHaveAttribute('aria-label', 'Send');
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
  await expect(page.locator('.kx-start:visible')).toBeVisible();
  await expect(page.locator('.agent-send:visible')).toBeEnabled();
  await send(page, 'back online');
  await expect(lastTurn(page).locator('.agent-text')).toHaveText('Echo: back online');
});

test('an agent authentication mismatch is visible and can be retried', async ({ page }) => {
  await seeded(page);
  await page.evaluate(() => { localStorage.setItem('finsight-agent-mode', 'side'); localStorage.setItem('finsight-agent-open', '0'); });
  await page.route('**/api/agent/**', (r) => r.fulfill({ status: 401, json: { error: { code: 'UNAUTHORIZED', message: 'Missing or bad proxy secret' } } }));
  await page.reload();
  await expect(page.locator('#agent-toggle')).toContainText('KESTREL');
  await page.click('#agent-toggle');
  const offline = page.locator('.agent-offline:visible');
  await expect(offline).toContainText('could not authenticate');
  await expect(offline).toContainText('same data directory');
  await page.unroute('**/api/agent/**');
  await offline.getByRole('button', { name: 'retry' }).click();
  await expect(page.locator('.kx-start:visible')).toBeVisible();
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
  await expect(page.locator('.agent-send:visible')).toHaveAttribute('aria-label', 'Send');
});

test('Kestrel boots after the PIN is entered on a locked reload; the earlier chat is in the list', async ({ page, context }) => {
  await open(page);
  await send(page, 'kept chat');
  await expect(lastTurn(page).locator('.agent-text')).toHaveText('Echo: kept chat');
  await context.clearCookies();
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/\blocked\b/);
  await page.fill('#lock-pin', PIN);
  await page.press('#lock-pin', 'Enter');
  await expect(page.locator('body')).not.toHaveClass(/\blocked\b/);
  // KESTRELUI-001: a reload starts on a new chat; the earlier one is listed on the start screen.
  await expect(page.locator('.kx-start:visible')).toBeVisible();
  await page.locator('.kx-jump-row', { hasText: 'kept chat' }).first().click();
  await expect(page.locator('.agent-user:visible').last()).toContainText('kept chat');
  await send(page, 'and again');
  await expect(lastTurn(page).locator('.agent-text')).toHaveText('Echo: and again');
});
