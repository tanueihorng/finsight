import { test, expect } from '@playwright/test';
import { seeded } from './helpers';
async function open(page: import('@playwright/test').Page) { await seeded(page); await page.click('#agent-toggle'); await expect(page.locator('.agent-input:visible')).toBeVisible(); }
async function send(page: import('@playwright/test').Page, question: string) { await page.locator('.agent-input:visible').fill('/committee ' + question + ' '); await page.locator('.agent-input:visible').press('Enter'); }
test('real API/engine/store: captured evidence, activity replay and cancellation', async ({ page }) => {
 await open(page); await send(page, 'review this stock');
 await expect(page.locator('.agent-turn:visible').last()).toContainText('Synthetic review backed by captured quote.');
 await page.getByRole('button', { name: 'Inspect Kestrel Chair', exact: true }).click();
 await expect(page.locator('summary', { hasText: 'Kestrel Chair' })).toHaveCount(1);
 await page.reload();
 await page.locator('.kx-jump-row', { hasText: '/committee review this stock' }).first().click();
 await page.getByRole('button', { name: 'Inspect Kestrel Chair', exact: true }).click();
 await expect(page.locator('summary', { hasText: 'Kestrel Chair' })).toHaveCount(1);
 await page.locator('.agent-icon-btn[title="New chat (/new)"]:visible').click();
 await send(page, 'slow review');
 await expect(page.locator('[data-role][data-state=running]').first()).toBeVisible();
 await page.locator('.agent-input:visible').press('Escape');
 await expect(page.locator('.agent-turn:visible').last()).toContainText('Interrupted by you.');
 await expect(page.locator('[data-role][data-state=running]')).toHaveCount(0);
});
test('real API/engine/store: a failed specialist yields explicit partial synthesis', async ({ page }) => {
 await open(page); await send(page, 'partial review');
 await expect(page.getByText('Partial chair synthesis',{exact:true})).toBeVisible();
 await page.getByRole('button', { name: 'Inspect Business & Growth', exact: true }).click();
 await expect(page.locator('summary', { hasText: 'Business & Growth · assessment · failed' })).toHaveCount(1);
});

test('wide chat presents one council panel and a distinct final result', async ({ page }, info) => {
 await page.setViewportSize({width:1600,height:1200});
 await page.addInitScript(()=>localStorage.setItem('finsight-agent-w','800'));
 await open(page); await send(page, 'review this stock');
 await expect(page.locator('[data-council-board]')).toHaveCount(1);
 await expect(page.getByText('Chair synthesis',{exact:true})).toBeVisible();
 await page.locator('[data-council-board]').scrollIntoViewIfNeeded();
 await page.locator('#agent-panel').screenshot({path:info.outputPath('council-in-chat.png'),animations:'disabled'});
 const { default: AxeBuilder } = await import('@axe-core/playwright');
 const result = await new AxeBuilder({page}).include('[data-council-board]').include('[data-council-result]').withTags(['wcag2a','wcag2aa']).analyze();
 expect(result.violations).toEqual([]);
});


test('explicit AMD research uses matching evidence while the TSM chart remains selected', async ({ page }) => {
 await seeded(page);
 await page.locator('#positions-body tr[data-sym="TSM"]').click();
 await page.click('#agent-toggle');
 await expect(page.locator('.agent-ctx:visible').filter({hasText:'TSM'})).toBeVisible();
 const sent = page.waitForRequest(r=>r.method()==='POST' && /\/api\/agent\/threads\/[^/]+\/messages$/.test(new URL(r.url()).pathname));
 await send(page,'should i buy amd');
 const request = await sent;
 expect(request.postDataJSON().pageContext.symbol).toBe('TSM');
 await expect(page.locator('.agent-turn:visible').last()).toContainText('Synthetic review of AMD backed by matching quote.');
 await expect(page.locator('.agent-ctx:visible').filter({hasText:'TSM'})).toBeVisible();
 const threadUrl = request.url().replace(/\/messages$/, '');
 const stored = await (await page.request.get(threadUrl)).json();
 const notices = stored.messages.flatMap((m:{blocks:unknown[]})=>m.blocks) as {type:string;kind:string;text:string}[];
 const scope = JSON.parse(notices.find(b=>b.type==='notice' && b.kind==='research_scope')!.text);
 expect(scope.status).toBe('ready');expect(scope.panelSymbol).toBe('TSM');expect(scope.subjects.map((s:{symbol:string})=>s.symbol)).toEqual(['AMD']);
 const evidence = notices.filter(b=>b.type==='notice' && b.kind==='council_evidence').map(b=>JSON.parse(b.text));
 expect(JSON.parse(evidence[0].content).quotes.map((q:{symbol:string})=>q.symbol)).toEqual(['AMD']);
 await page.reload();
 await page.locator('.kx-jump-row',{hasText:'/committee should i buy amd'}).first().click();
 await expect(page.locator('.agent-turn:visible').last()).toContainText('Synthetic review of AMD backed by matching quote.');
});
