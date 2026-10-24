// Shared E2E helpers. The server runs on a fresh temp data folder (see
// playwright.config.ts), so the first unlock creates the PIN.
import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const PIN = '2468';

// Same portfolio as scripts/demo.js DEMO_CSV (kept inline: *.csv files are never committed).
export const DEMO_CSV = [
  'symbol,quantity,avg price,date',
  'NVDA,60,95.5,2024-11-04', 'MSFT,18,402,2025-01-15', 'AAPL,25,188,2024-12-02', 'GOOGL,30,165,2025-02-10',
  'VOO,22,470,2024-10-01', 'TSM,40,170,2025-03-03', 'D05.SI,300,36.2,2024-09-12', 'O39.SI,500,14.8,2025-04-08', 'ES3.SI,1200,3.45,2024-08-20',
].join('\n');

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

// Drag a panel by its ⠿ grip into a column (stepped moves so HTML5 dragover fires).
export async function dragPanel(page: Page, pid: string, column: '.col-left' | '.col-right'): Promise<void> {
  const grip = page.locator(`.panel[data-pid="${pid}"] .drag-grip`);
  await grip.scrollIntoViewIfNeeded();
  const g = (await grip.boundingBox())!, c = (await page.locator(column).boundingBox())!;
  const from = { x: g.x + g.width / 2, y: g.y + g.height / 2 }, to = { x: c.x + 100, y: Math.max(c.y, 0) + 300 };
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 10; i++) await page.mouse.move(from.x + (to.x - from.x) * i / 10, from.y + (to.y - from.y) * i / 10);
  await page.mouse.up();
}
