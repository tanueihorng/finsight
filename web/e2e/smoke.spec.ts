import { test, expect } from '@playwright/test';
import { unlock } from './helpers';
import type {} from '../src/bootstrap.ts'; // window.FinSight type

test('loads / and unlocks', async ({ page }) => {
  await unlock(page);
  await expect(page.locator('#lock-screen')).toBeHidden();
});

test('the island bundle loads without errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const loaded = ['/app/bootstrap.js', '/app/main.js', '/app/main.css'].map((p) =>
    page.waitForResponse((r) => new URL(r.url()).pathname === p));
  await unlock(page);
  for (const r of await Promise.all(loaded)) expect(r.status(), r.url()).toBe(200);
  expect(errors).toEqual([]);
  await page.evaluate(() => window.FinSight.islandsReady);
});

test('bootstrap.js runs before every legacy script', async ({ page }) => {
  // Trap the moment window.FinSight is created: which script did it, and had
  // the parser reached any legacy script yet?
  await page.addInitScript(() => {
    let value: unknown;
    Object.defineProperty(window, 'FinSight', {
      configurable: true,
      get: () => value,
      set: (v) => {
        value = v;
        (window as any).__boot = { // legacy-any
          by: (document.currentScript as HTMLScriptElement | null)?.src || '',
          legacyParsed: !!document.querySelector('script[src="/indicators.js"], script[src="/app.js"]'),
        };
      },
    });
  });
  await unlock(page);
  const boot = await page.evaluate(() => (window as any).__boot); // legacy-any
  expect(new URL(boot.by).pathname).toBe('/app/bootstrap.js');
  expect(boot.legacyParsed).toBe(false);
});
