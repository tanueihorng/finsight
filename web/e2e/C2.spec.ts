import { test, expect } from '@playwright/test';
import { seeded, cmd } from './helpers';

const money = (n: number) => 'S$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
test('FX rates/history, shock/target/conversion and saved target preserve legacy behavior', async ({ page }, testInfo) => {
  await seeded(page); await expect(page.locator('#fxr-slider')).toBeVisible();
  const data = await (await page.request.get('/api/fx-risk?base=SGD')).json();
  await expect(page.locator('#fxr-spot')).toHaveText('USD/SGD 1.2900');
  await expect(page.locator('#fxrisk tbody tr')).toHaveCount(data.lots.length);
  await page.locator('#fxr-slider').press('End');
  await expect(page.locator('#fxr-shock')).toHaveText('+15.0%');
  await expect(page.locator('#fxr-impact')).toHaveText('+' + money(data.foreignBase * .15));
  await expect(page.locator('#fxr-newval')).toHaveText(money(data.foreignBase * 1.15));
  await page.fill('#fxr-target', '70'); await expect(page.locator('#fxr-target-out')).toContainText('70%');
  await page.fill('#fxr-conv', '1290'); await expect(page.locator('#fxr-conv-out')).toContainText('Now: $1,000 at 1.2900.');
  await expect(page.locator('#fxr-conv-out')).toContainText('In a month, 2 in 3 outcomes');
  await page.locator('#fxrisk').screenshot({ path: testInfo.outputPath('fx-risk.png') });
  await page.reload(); await expect(page.locator('#fxr-target')).toHaveValue('70');
  await expect(page.locator('#fxr-conv')).toHaveValue(''); await expect(page.locator('#fxr-slider')).toHaveValue('0');
});

test('input focus and drafts survive portfolio refresh, then new data applies after editing', async ({ page }) => {
  await seeded(page); await expect(page.locator('#fxr-conv')).toBeVisible();
  await page.locator('#fxr-slider').press('End'); await page.fill('#fxr-conv', '1290');
  try {
    await page.evaluate(async () => { await (window as unknown as { runCommand(command: string): Promise<void> }).runCommand('CASH USD 100'); });
    await expect(page.locator('#fxr-conv')).toBeFocused(); await expect(page.locator('#fxr-conv')).toHaveValue('1290');
    await page.click('#fxr-spot');
    await expect(page.locator('#fxr-slider')).toHaveValue('15'); await expect(page.locator('#fxr-conv')).toHaveValue('1290');
  } finally { await cmd(page, 'CASH USD 0'); }
});

test('multiple currency and empty/no-foreign states preserve labels and failure retention', async ({ page }) => {
  await seeded(page); await expect(page.locator('#fxr-slider')).toBeVisible();
  const original = await (await page.request.get('/api/fx-risk?base=SGD')).json();
  let fixture = { ...original, exposures: [...original.exposures, { ...original.exposures[0], ccy: 'EUR' }] };
  await page.route('**/api/fx-risk?**', (route) => route.fulfill({ json: fixture }));
  await cmd(page, 'CASH SGD 1'); await expect(page.locator('#fxrisk')).toContainText('foreign-FX shock');
  await expect(page.locator('#fxrisk thead')).toContainText('FX @BUY');
  fixture = { ...fixture, totalValue: 1000, exposures: [] };
  await cmd(page, 'CASH SGD 2'); await expect(page.locator('#fxrisk')).toContainText('No foreign-currency holdings');
  fixture = { ...fixture, totalValue: 0 };
  await cmd(page, 'CASH SGD 3'); await expect(page.locator('#fxrisk')).toContainText('No positions yet');
  await page.unroute('**/api/fx-risk?**');
  await page.route('**/api/fx-risk?**', (route) => route.fulfill({ status: 503, json: { error: 'fixture offline' } }));
  await cmd(page, 'CASH SGD 4'); await expect(page.locator('#fxrisk')).toContainText('No positions yet');
  await page.unroute('**/api/fx-risk?**'); await cmd(page, 'CASH SGD 0');
});

test('summary and FX share one 120-second query; polling stops when both consumers unmount', async ({ page }) => {
  await page.clock.install(); await seeded(page);
  await expect(page.locator('#fxr-slider')).toBeVisible(); await page.waitForLoadState('networkidle');
  const calls: string[] = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/fx-risk') calls.push(r.url()); });
  await page.clock.fastForward(120_010); await expect.poll(() => calls.length).toBe(1);
  await page.waitForLoadState('networkidle');
  await page.evaluate(() => { document.getElementById('fxrisk')!.remove(); document.getElementById('summary')!.remove(); });
  await expect(page.locator('#fxr-spot')).toBeEmpty(); calls.length = 0;
  await page.clock.fastForward(120_010); await page.evaluate(() => window.FinSight.bus.invalidate('fx-risk'));
  expect(calls).toHaveLength(0);
});
