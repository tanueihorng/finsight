import { test, expect } from '@playwright/test';
import { seeded } from './helpers';
import type {} from '../src/bootstrap.ts';

declare global {
  interface Window { __timers: { started: number[]; cleared: number[] } }
}
test('React clock retains legacy text format and ticks every second', async ({ page }) => {
  // Freeze Date only; pausing timers also pauses React's Suspense scheduler.
  await page.clock.setFixedTime(new Date('2026-10-25T04:00:00Z'));
  await seeded(page);
  const text = await page.evaluate(() => {
    const d = new Date(); return d.toLocaleTimeString('en-US', { hour12: false }) + ' ' + d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase();
  });
  await expect(page.locator('#clock')).toHaveText(text);
  await page.clock.setFixedTime(new Date('2026-10-25T04:00:01Z'));
  const next = await page.evaluate(() => {
    const d = new Date(); return d.toLocaleTimeString('en-US', { hour12: false }) + ' ' + d.toLocaleDateString('en-US', { month: 'short', day: '2-digit' }).toUpperCase();
  });
  expect(next).not.toBe(text); await expect(page.locator('#clock')).toHaveText(next);
});
test('a late island mounts once, survives a host move and unmounts on removal', async ({ page }) => {
  await page.addInitScript(() => {
    window.__timers = { started: [], cleared: [] };
    const interval = window.setInterval.bind(window), clear = window.clearInterval.bind(window);
    window.setInterval = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
      const id = interval(handler, timeout, ...args); if (timeout === 1000) window.__timers.started.push(id); return id;
    }) as typeof window.setInterval;
    window.clearInterval = ((id?: number) => { if (id !== undefined) window.__timers.cleared.push(id); clear(id); }) as typeof window.clearInterval;
  });
  await seeded(page);
  await expect(page.locator('#clock')).toContainText(/\d{2}:\d{2}:\d{2}/);
  const before = await page.evaluate(() => window.__timers.started.length);
  await page.evaluate(() => {
    const host = document.createElement('div'); host.id = 'runtime-host'; host.className = 'panel'; host.dataset.pid = 'runtime-probe';
    host.innerHTML = '<div class="panel-head">Probe</div><span data-island="clock"></span>';
    document.querySelector('.col-left')!.append(host);
  });
  const body = page.locator('#runtime-host [data-island]');
  await expect(body).toContainText(/\d{2}:\d{2}:\d{2}/);
  await expect.poll(() => page.evaluate(() => window.__timers.started.length)).toBe(before + 1);
  const mounted = await page.evaluate(() => ({ started: [...window.__timers.started], timer: window.__timers.started.at(-1)! }));
  await page.evaluate(() => document.querySelector('.col-right')!.append(document.querySelector('#runtime-host')!));
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__timers.started)).toEqual(mounted.started);
  expect(await page.evaluate((id) => window.__timers.cleared.includes(id), mounted.timer)).toBe(false);
  await expect(page.locator('#runtime-host.panel .panel')).toHaveCount(0);
  await page.evaluate(() => document.querySelector('#runtime-host')!.remove());
  await expect.poll(() => page.evaluate((id) => window.__timers.cleared.includes(id), mounted.timer)).toBe(true);
  await expect(page.locator('#clock')).toContainText(/\d{2}:\d{2}:\d{2}/);
});
test('a failed lazy island is contained while the clock keeps working', async ({ page }) => {
  await seeded(page);
  await page.evaluate(async () => {
    const url = '/app/main.js'; const { mountIslands } = await import(url);
    const host = document.createElement('div'); document.body.append(host);
    host.innerHTML = '<div data-island="broken"></div>';
    mountIslands({ broken: () => Promise.reject(new Error('fixture chunk failure')) }, host);
  });
  await expect(page.getByRole('alert')).toContainText('This panel could not load.');
  await expect(page.locator('#clock')).toContainText(/\d{2}:\d{2}:\d{2}/);
  await expect(page.locator('#positions-body tr[data-sym]')).toHaveCount(9);
});
