// Shared E2E helpers. The server runs on a fresh temp data folder (see
// playwright.config.ts), so the first unlock creates the PIN.
import { expect, type Page } from '@playwright/test';

export const PIN = '2468';

// Same portfolio as scripts/demo.js DEMO_CSV (kept inline: *.csv files are never committed).
export const DEMO_CSV = [
  'symbol,quantity,avg price,date',
  'NVDA,60,95.5,2024-11-04', 'MSFT,18,402,2025-01-15', 'AAPL,25,188,2024-12-02', 'GOOGL,30,165,2025-02-10',
  'VOO,22,470,2024-10-01', 'TSM,40,170,2025-03-03', 'D05.SI,300,36.2,2024-09-12', 'O39.SI,500,14.8,2025-04-08', 'ES3.SI,1200,3.45,2024-08-20',
].join('\n');

// Sign this page's browser context in (creating the PIN on first use), then open the app.
export async function unlock(page: Page): Promise<void> {
  const status = await (await page.request.get('/api/auth/status')).json();
  const res = await page.request.post(status.pinSet ? '/api/auth/login' : '/api/auth/setup', { data: { pin: PIN } });
  expect(res.ok(), await res.text()).toBe(true);
  await page.goto('/');
  await expect(page.locator('body')).not.toHaveClass(/\blocked\b/);
}

// Replace the active account's holdings with the demo portfolio (base SGD).
export async function seed(page: Page): Promise<void> {
  const res = await page.request.post('/api/portfolio/import?base=SGD', { data: { csv: DEMO_CSV, replace: true } });
  expect(res.ok(), await res.text()).toBe(true);
}
