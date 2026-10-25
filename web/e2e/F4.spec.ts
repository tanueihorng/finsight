import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { seeded, PIN } from './helpers';
import type {} from '../src/bootstrap.ts';

async function mount(page: Page) {
  const result = await build({ entryPoints: ['web/src/features/_probe/Probe.tsx'], bundle: true, write: false, format: 'esm', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, plugins: [{ name: 'canonical-query-client', setup(b) {
      b.onResolve({ filter: /\/main\.tsx$/ }, () => ({ path: '/app/main.js', external: true }));
    } }] });
  await page.route('**/__probe.js', (route) => route.fulfill({ contentType: 'text/javascript', body: result.outputFiles[0]!.text }));
  await page.evaluate(async () => {
    const node = document.createElement('div'); document.body.append(node);
    const url = '/__probe.js'; const { mountProbe } = await import(url); mountProbe(node);
  });
  await expect(page.locator('#store-probe')).toHaveAttribute('data-fetching', 'idle');
}
test('a test-only React island follows legacy base and account changes', async ({ page }) => {
  await seeded(page); await mount(page);
  await expect(page.locator('#store-probe')).toHaveText('SGD');
  await page.selectOption('#base-ccy', 'USD');
  await expect(page.locator('#store-probe')).toHaveText('USD');
  await page.selectOption('#base-ccy', 'SGD');
  await expect(page.locator('#store-probe')).toHaveText('SGD');
  const response = await page.request.post('/api/accounts/add', { data: { name: 'Probe Empty' } });
  const { newId } = await response.json();
  await page.evaluate(async () => { await (window as any).loadAccounts(); }); // legacy-any: listed F4 caller
  await page.selectOption('#account-sel', newId);
  await expect(page.locator('#store-probe')).toHaveAttribute('data-account', newId);
});
test('session expiry with a React query stops requests, keeps PIN and resumes', async ({ page, context }) => {
  test.setTimeout(60_000);
  await seeded(page); await mount(page);
  await expect(page.locator('#store-probe')).toHaveAttribute('data-account', /.+/);
  await context.clearCookies();
  // Exercise the new API client's 401 path, not the legacy wrapper.
  await page.evaluate(async () => { const url = '/app/main.js'; const { queryClient } = await import(url); await queryClient.invalidateQueries(); });
  await expect(page.locator('body')).toHaveClass(/\blocked\b/);
  expect(await page.evaluate(() => window.FinSight.auth.unlocked)).toBe(false);
  await page.fill('#lock-pin', PIN.slice(0, 2));
  const calls: string[] = [];
  page.on('request', (r) => { const path = new URL(r.url()).pathname; if (path.startsWith('/api/') && !path.startsWith('/api/auth/')) calls.push(path); });
  await page.waitForTimeout(16_000);
  expect(calls).toEqual([]);
  await expect(page.locator('#lock-pin')).toHaveValue(PIN.slice(0, 2));
  await page.locator('#lock-pin').pressSequentially(PIN.slice(2)); await page.press('#lock-pin', 'Enter');
  await expect(page.locator('body')).not.toHaveClass(/\blocked\b/);
  await expect.poll(() => calls.filter((p) => p === '/api/portfolio').length).toBeGreaterThan(0);
  await expect(page.locator('#store-probe')).toHaveAttribute('data-fetching', 'idle');
});
