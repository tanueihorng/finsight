// FEAT-018 look-through panel on the seeded demo portfolio (NVDA 60 direct,
// VOO 22, ES3.SI without a holdings file). The synthetic VOO fixture is copied
// into the E2E data folder, re-dated three days back so it is never stale.
// Expected amounts are rebuilt from /api/portfolio and the fixture weight.
import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { seeded } from './helpers';

const DIR = path.join(process.env.FINSIGHT_E2E_DIR!, 'etf-holdings');
const FIX = path.resolve('test', 'fixtures', 'etf-holdings', 'VOO-2026-10-31.json'); // Playwright runs from the repo root
const fmt0 = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });

test.beforeAll(() => {
  const d = new Date(Date.now() - 3 * 86_400_000).toLocaleDateString('en-CA');
  const snap = { ...JSON.parse(fs.readFileSync(FIX, 'utf8')), holdingsDate: d, retrievedAt: `${d}T12:00:00Z` };
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(path.join(DIR, 'VOO.json'), JSON.stringify(snap));
});
test.afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

test('NVDA combines the direct holding with VOO; dates, unmapped value and the what-if are shown', async ({ page }) => {
  await seeded(page);
  const pf = await (await page.request.get('/api/portfolio?base=SGD&account=main')).json();
  const mv = Object.fromEntries(pf.positions.map((p: { symbol: string; marketValue: number }) => [p.symbol, p.marketValue]));
  const nvda = mv.NVDA + mv.VOO * 0.075;
  const body = page.locator('#exposure-body');
  await expect(body.locator('[data-testid=exposure-scope]')).toContainText('REAL · Main · SGD');
  await expect(body.locator('[data-testid=exposure-reconciles]')).toHaveText('✓ reconciles');
  await expect(body.locator('[data-testid=exposure-legend]')).toContainText('VOO');
  await expect(body.locator('[data-testid=exposure-legend]')).toContainText('ES3.SIno file');
  const row = body.locator('[data-issuer=NVDA]');
  await expect(row).toContainText(fmt0(nvda));
  await expect(body.locator('[data-testid=exposure-unmapped]')).toContainText('No holdings file');
  await expect(body.locator('[data-testid=exposure-unmapped]')).toContainText('ES3.SI: no holdings file imported');

  await row.click();
  const detail = body.locator('[data-testid=exposure-detail]');
  await expect(detail).toContainText('Direct holding');
  await expect(detail).toContainText('via VOO7.50%');
  await expect(detail.locator('[data-testid=exposure-shock]')).toContainText(`20% → −${fmt0(nvda * 0.2)}`);
  await detail.locator('input[type=range]').fill('50');
  await expect(detail.locator('[data-testid=exposure-shock]')).toContainText(`50% → −${fmt0(nvda * 0.5)}`);
  await row.click();
  await expect(detail).toHaveCount(0);
});

test('without holdings files every fund stays unmapped and the totals still reconcile', async ({ page }) => {
  fs.rmSync(DIR, { recursive: true, force: true });
  await seeded(page);
  const body = page.locator('#exposure-body');
  await expect(body.locator('[data-testid=exposure-reconciles]')).toHaveText('✓ reconciles');
  await expect(body.locator('[data-testid=exposure-legend]')).toContainText('VOOno file');
  await expect(body.locator('[data-issuer=VOO]')).toHaveCount(0);
  await expect(body.locator('[data-issuer=NVDA]')).toBeVisible();
});
