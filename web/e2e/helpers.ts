// Shared E2E helpers. The server runs on a fresh temp data folder (see
// playwright.config.ts), so the first unlock creates the PIN.
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const PIN = '2468';

export { DEMO_CSV } from '../../scripts/demo-portfolio.ts';
import { DEMO_CSV } from '../../scripts/demo-portfolio.ts';

// Create the PIN on the fresh data folder if no test has yet.
export async function ensurePin(request: APIRequestContext): Promise<void> {
  const status = await (await request.get('/api/auth/status')).json();
  if (!status.pinSet) expect((await request.post('/api/auth/setup', { data: { pin: PIN } })).ok()).toBe(true);
}

// Sign this page's browser context in (creating the PIN on first use), then open the app.
// The first-launch setup wizard is marked done unless `wizard` is true.
export async function unlock(page: Page, { wizard = false } = {}): Promise<void> {
  await ensurePin(page.request);
  const res = await page.request.post('/api/auth/login', { data: { pin: PIN } });
  expect(res.ok(), await res.text()).toBe(true);
  if (!wizard) {
    await page.addInitScript(() => {
      if (!localStorage.getItem('finsight-profile')) localStorage.setItem('finsight-profile', JSON.stringify({ setupDone: true }));
    });
  }
  await page.goto('/');
  await expect(page.locator('body')).not.toHaveClass(/\blocked\b/);
}

// Replace holdings with the demo portfolio (base SGD) in a single account, so
// specs that add accounts can't leak into later specs.
export async function seed(page: Page): Promise<void> {
  const { accounts, activeId } = await (await page.request.get('/api/accounts')).json();
  for (const a of accounts.slice(1)) await page.request.post('/api/accounts/remove', { data: { id: a.id } });
  if (activeId !== accounts[0].id) expect((await (await page.request.get('/api/accounts')).json()).activeId).toBe(accounts[0].id);
  for (const ccy of ['USD', 'SGD', 'EUR']) await page.request.post('/api/cash?base=SGD', { data: { ccy, amount: 0 } });
  const res = await page.request.post('/api/portfolio/import?base=SGD', { data: { csv: DEMO_CSV, replace: true } });
  expect(res.ok(), await res.text()).toBe(true);
}

// Fresh page on the seeded demo portfolio.
export async function seeded(page: Page): Promise<void> {
  await unlock(page);
  await seed(page);
  await page.reload();
  await expect(page.locator('#positions-body tr[data-sym]')).toHaveCount(9);
}

// Run a command-bar command.
export async function cmd(page: Page, text: string): Promise<void> {
  await page.fill('#cmd', text);
  await page.press('#cmd', 'Enter');
}

// The quantity cell of a position row.
export const qtyCell = (page: Page, sym: string) => page.locator(`#positions-body tr[data-sym="${sym}"] td`).nth(1);

// Advance an installed page.clock by `ms` in small steps, letting the requests
// each step starts finish before the next. One large jump fires a 15 s poll's
// next tick while the previous fetch is still in flight, and the query layer
// then drops it, so a poll that runs too often would go unnoticed.
export async function advanceClock(page: Page, ms: number, step = 1_000): Promise<void> {
  const inFlight = new Set<object>();
  const add = (r: object) => inFlight.add(r), done = (r: object) => inFlight.delete(r);
  page.on('request', add); page.on('requestfinished', done); page.on('requestfailed', done);
  try {
    for (let t = 0; t < ms; t += step) {
      await page.clock.runFor(Math.min(step, ms - t));
      await expect.poll(() => inFlight.size, { intervals: [10, 25, 50, 100] }).toBe(0);
    }
  } finally { page.off('request', add); page.off('requestfinished', done); page.off('requestfailed', done); }
}

// Drag a panel by its ⠿ grip into a column (stepped moves so HTML5 dragover fires).
export async function dragPanel(page: Page, pid: string, column: '.col-left' | '.col-right'): Promise<void> {
  const grip = page.locator(`.panel[data-pid="${pid}"] .drag-grip`);
  await grip.scrollIntoViewIfNeeded();
  await grip.hover(); // locator actionability waits for a stable, hittable grip
  const g = (await grip.boundingBox())!, c = (await page.locator(column).boundingBox())!;
  const from = { x: g.x + g.width / 2, y: g.y + g.height / 2 }, to = { x: c.x + 100, y: Math.max(c.y, 0) + 300 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  try {
    for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + (to.x - from.x) * i / 10, from.y + (to.y - from.y) * i / 10);
    // HTML dragenter and dragover are distinct: deliver a second movement at
    // the destination before releasing, rather than relying on event timing.
    await page.mouse.move(to.x, to.y);
    await expect(page.locator(`${column} > .panel[data-pid="${pid}"]`)).toHaveCount(1);
  } finally { await page.mouse.up(); }
}

// The in-app confirm / prompt (web/src/ui/dialog.tsx), which replaced
// window.confirm and window.prompt. Checks the title when given, types text
// into a prompt, then confirms (or cancels).
export async function answerDialog(page: Page, { accept = true, text, title }: { accept?: boolean; text?: string; title?: string | RegExp } = {}): Promise<void> {
  const dlg = page.locator('#app-dialog');
  await expect(dlg).toBeVisible();
  if (title) await expect(dlg.locator('#app-dialog-title')).toHaveText(title);
  if (text != null) await dlg.locator('#app-dialog-input').fill(text);
  await dlg.locator(accept ? '#app-dialog-ok' : '#app-dialog-cancel').click();
  await expect(dlg).toHaveCount(0);
}

// Kestrel: open the reply settings (model, thinking, web search) under the composer.
export async function replySettings(page: Page): Promise<void> {
  const btn = page.locator('.kx-model-btn:visible');
  if (await btn.getAttribute('aria-expanded') !== 'true') await btn.click();
  await expect(page.locator('.kx-pop:visible')).toBeVisible();
}
// Kestrel: pick an item from the header's More menu.
export async function chatMenu(page: Page, name: string | RegExp): Promise<void> {
  await page.locator('[aria-label="More chat options"]:visible').click();
  await page.getByRole('menuitem', { name }).click();
}
