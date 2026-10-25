import { test, expect } from '@playwright/test';
import { seeded, cmd } from './helpers';
declare global { interface Window { __notificationCount: number; __beepCount: number } }

test('alert form, command, chart overlay feed and removal preserve legacy behavior', async ({ page }) => {
  await seeded(page);
  await page.click('#alert-toggle'); await page.fill('#alert-symbol', 'NVDA'); await page.fill('#alert-price', '99999');
  await page.locator('#alert-form button[type=submit]').click();
  await expect(page.locator('#cmd-status')).toHaveText('Alert set: NVDA > 99999');
  const row = page.locator('#alerts .al-row').filter({ hasText: 'NVDA' });
  await expect(row).toContainText('armed');
  const alerts = await page.evaluate(() => (window as unknown as { __finAlerts: { symbol: string }[] }).__finAlerts);
  expect(alerts.some((a) => a.symbol === 'NVDA')).toBe(true);
  await row.locator('.al-sym').click(); await expect(page.locator('#detail-title')).toHaveText('NVDA · DETAIL');
  await row.locator('.al-x').click(); await expect(row).toHaveCount(0);
  await cmd(page, 'ALERT AAPL > 99999');
  await expect(page.locator('#alerts')).toContainText('AAPL');
  await page.locator('#alerts .al-x').click(); await expect(page.locator('#alerts')).toContainText('No alerts');
});

test('chart alerts update the panel, toast/beep/desktop notify once per newly triggered id', async ({ page }) => {
  await page.addInitScript(() => {
    window.__notificationCount = 0; window.__beepCount = 0;
    Object.defineProperty(window, 'Notification', { configurable: true, value: class { static permission = 'granted'; constructor() { window.__notificationCount++; } } });
    Object.defineProperty(window, 'AudioContext', { configurable: true, value: class {
      currentTime = 0; destination = {}; constructor() { window.__beepCount++; }
      createOscillator() { return { connect() {}, type: '', frequency: { value: 0 }, start() {}, stop() {}, onended: null }; }
      createGain() { return { connect() {}, gain: { value: 0 } }; } close() {}
    } });
  });
  await seeded(page); await expect(page.locator('#alerts')).toContainText('No alerts');
  const trigger = async () => page.evaluate(() => {
    const alerts = [{ id: 'fixture-trigger', symbol: 'NVDA', kind: 'price', op: '>', price: 100, createdAt: 1, triggeredAt: 2, label: 'NVDA ≥ 100', currentPrice: 182.4, currentValue: 182.4, level: 100, currency: 'USD', name: 'NVIDIA', met: true }];
    window.dispatchEvent(new CustomEvent('finsight:alerts', { detail: { alerts, from: 'chart' } }));
  });
  await trigger();
  await expect(page.locator('#alerts')).toContainText('TRIGGERED');
  await expect(page.locator('#toasts .toast')).toHaveCount(1);
  await trigger(); await page.waitForTimeout(100);
  await expect(page.locator('#toasts .toast')).toHaveCount(1);
  expect(await page.evaluate(() => [window.__notificationCount, window.__beepCount])).toEqual([1, 1]);
});

test('one 30-second alert poll; removing the root stops polling and removes editor portals', async ({ page }) => {
  await page.clock.install(); await seeded(page);
  await expect(page.locator('#alerts')).toContainText('No alerts');
  await page.waitForLoadState('networkidle');
  const calls: string[] = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/alerts') calls.push(r.url()); });
  await page.clock.fastForward(30_010);
  await expect.poll(() => calls.length).toBe(1);
  await page.evaluate(() => document.getElementById('alerts')!.remove());
  await expect(page.locator('#alert-form')).toHaveCount(0);
  calls.length = 0;
  await page.clock.fastForward(30_010);
  await page.evaluate(() => window.FinSight.bus.invalidate('alerts'));
  expect(calls).toHaveLength(0);
});
