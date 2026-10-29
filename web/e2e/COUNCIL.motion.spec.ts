import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
test.use({ viewport: {width:1100,height:1000}, video: {mode:'on',size:{width:1100,height:1000}} });
let dir: string, html: string;
test.beforeAll(() => {
 dir = fs.mkdtempSync(path.join(os.tmpdir(), 'finsight-council-preview-'));
 const file = path.join(dir, 'preview.html');
 execFileSync(process.execPath, ['scripts/build-council-preview.mjs', file]); html = fs.readFileSync(file, 'utf8');
});
test.afterAll(() => fs.rmSync(dir, {recursive:true, force:true}));
async function preview(page: import('@playwright/test').Page) {
 await page.route('**/council-motion-preview', (route) => route.fulfill({ contentType: 'text/html', body: html }));
 await page.goto('/council-motion-preview');
 await expect(page.getByRole('heading', {name:'Council in session',exact:true})).toBeVisible();
}
test.describe('motion evidence', () => {

 test('running specialists hand off to chair, then settle into the result', async ({page}, info) => {
  await preview(page);
  await expect(page.locator('[data-orb][data-active=true]')).toHaveCount(2);
  expect(await page.locator('[data-orb=growth]>span:nth-child(2)').evaluate((el)=>getComputedStyle(el).animationName)).not.toBe('none');
  expect(await page.locator('[data-orb=risk]>span:nth-child(2)').evaluate((el)=>getComputedStyle(el).animationName)).toBe('none');
  await page.screenshot({path:info.outputPath('running.png'),fullPage:true});
  await page.waitForTimeout(2500); // Capture a visible orbit cycle in the motion artifact.
  await page.getByRole('button',{name:'Synthesis',exact:true}).click();
  await expect(page.locator('[data-orb=chair][data-active=true]')).toBeVisible();
  await page.waitForTimeout(2500); // Record the distinct chair synthesis motion.
  await page.getByRole('button',{name:'Complete',exact:true}).click();
  await expect(page.locator('[data-orb][data-active=true]')).toHaveCount(0);
  await expect(page.getByRole('heading',{name:'Review complete',exact:true})).toBeVisible();
  await page.locator('[data-council-result]').scrollIntoViewIfNeeded();
  await page.waitForTimeout(1100); // Capture the final synthesis entrance and reading frame.
  await page.screenshot({path:info.outputPath('complete.png'),fullPage:true,animations:'disabled'});
  await page.getByRole('button',{name:'Inspect Business & Growth',exact:true}).click();
  await expect(page.locator('[aria-label="Specialist findings"]')).toBeVisible();
 });
});
test('narrow layout, reduced motion and failed branches preserve truthful status',async({page},info)=>{
 await page.setViewportSize({width:390,height:844}); await page.emulateMedia({reducedMotion:'reduce'}); await preview(page);
 expect(await page.locator('[data-orb=growth]>span:nth-child(2)').evaluate((el)=>getComputedStyle(el).animationName)).toBe('none');
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:info.outputPath('narrow.png'),fullPage:true});
 await page.getByRole('button',{name:'Partial',exact:true}).click();
 await expect(page.getByRole('heading',{name:'Review ended with gaps',exact:true})).toBeVisible();
 await expect(page.locator('[data-role=macro][data-state=failed]')).toBeVisible();
 await page.getByRole('button',{name:'Collapse council activity',exact:true}).click();
 await expect(page.getByRole('button',{name:'Inspect Macro & Valuation',exact:true})).toHaveCount(0);
 await page.getByRole('button',{name:'Expand council activity',exact:true}).click();
 await expect(page.getByRole('button',{name:'Inspect Macro & Valuation',exact:true})).toBeVisible();
});
test('chain of thought: reduced motion is static and a live council causes no long tasks', async ({ page }) => {
 await preview(page);
 const long = await page.evaluate(() => new Promise<number>((resolve) => {
  let n = 0; const o = new PerformanceObserver((l) => { n += l.getEntries().length; }); o.observe({ type: 'longtask', buffered: false });
  setTimeout(() => { o.disconnect(); resolve(n); }, 3000);
 }));
 expect(long).toBe(0);
 await page.getByRole('button', { name: 'Full page view', exact: true }).click();
 await page.getByRole('button', { name: '≡ Chain of thought', exact: true }).click();
 await expect(page.locator('[data-council-board][data-view=chain]')).toBeVisible();
 await expect(page.getByLabel('Business & Growth lane')).toHaveAttribute('data-state', 'running');
 await page.emulateMedia({ reducedMotion: 'reduce' });
 for (const sel of ['[aria-label="Business & Growth lane"] [data-running=true]', '[aria-label="Business & Growth lane"] .kx-spin, [aria-label="Business & Growth lane"] i']) {
  expect(await page.locator(sel).first().evaluate((el) => getComputedStyle(el).animationName)).toBe('none');
 }
});
