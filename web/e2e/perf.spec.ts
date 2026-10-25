import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import { seeded } from './helpers';

// Browser-cache baseline. Server caches are deliberately warm after seeding;
// each pair uses one authenticated browser and real static HTTP responses.
for (const viewport of [{ width: 1600, height: 1000 }, { width: 390, height: 844 }]) {
  test(`performance ${viewport.width}x${viewport.height}: cold and warm`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await seeded(page);
    await page.addInitScript(() => {
      const observer = new MutationObserver(() => {
        if (document.querySelector('#positions-body tr[data-sym]')) {
          performance.mark('first-position'); observer.disconnect();
        }
      });
      observer.observe(document, { childList: true, subtree: true });
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('Network.clearBrowserCache');
    let assets = new Map<string, { url: string; transferredBytes: number }>();
    cdp.on('Network.requestWillBeSent', (e) => {
      if (e.type === 'Script' || e.type === 'Stylesheet') assets.set(e.requestId, { url: new URL(e.request.url).pathname, transferredBytes: 0 });
    });
    cdp.on('Network.loadingFinished', (e) => {
      const asset = assets.get(e.requestId); if (asset) asset.transferredBytes = e.encodedDataLength;
    });
    await cdp.send('Network.enable');
    const results = [];
    for (const cache of ['cold', 'warm']) {
      assets = new Map();
      await page.reload();
      await expect(page.locator('#positions-body tr[data-sym]')).toHaveCount(9);
      await expect(page.locator('#markets .mkt-row').first()).toBeVisible();
      await page.waitForLoadState('networkidle');
      const metrics = await page.evaluate(() => {
        return {
          firstPaintMs: performance.getEntriesByName('first-paint')[0]?.startTime,
          firstPositionMs: performance.getEntriesByName('first-position')[0]?.startTime,
        };
      });
      expect(metrics.firstPaintMs).toBeGreaterThan(0);
      expect(metrics.firstPositionMs).toBeGreaterThan(0);
      expect(assets.size).toBeGreaterThan(0);
      const transferredBytes = [...assets.values()].reduce((sum, e) => sum + e.transferredBytes, 0);
      if (cache === 'cold') expect(transferredBytes).toBeGreaterThan(0);
      results.push({ viewport, cache, ...metrics, transferredBytes, assets: [...assets.values()] });
    }
    await fs.writeFile(info.outputPath('metrics.json'), JSON.stringify(results, null, 2));
    await info.attach('performance', { body: JSON.stringify(results), contentType: 'application/json' });
  });
}
