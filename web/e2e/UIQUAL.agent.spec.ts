// Opt-in visual proof from recorded SYNTHETIC live-provider responses.
// No provider calls here; ordinary CI needs neither keys nor eval artifacts.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seeded } from './helpers';
const dir = process.env.UI_QUAL_DIR;
if (!dir) test.skip('live synthetic UI visual proof requires UI_QUAL_DIR', () => {});
else for (const model of ['deepseek-flash', 'deepseek-pro']) {
  const rows = JSON.parse(fs.readFileSync(path.join(dir, `${model}.json`), 'utf8')) as { candidate: { prompt: string; text: string; views: any[] } }[];
  for (const kind of ['stat_grid', 'table']) test(`${model}: recorded live ${kind} renders accessibly`, async ({ page }) => {
    const c = rows.map((x) => x.candidate).find((x) => x.views.some((v) => v.spec.components.some((p: any) => p.kind === kind)));
    expect(c, 'a live accepted sample exists').toBeTruthy();
    const views = c!.views.map((v) => ({ ...v, threadId: 'proof' }));
    const thread = { id: 'proof', title: 'Synthetic live qualification', version: 1, defaultBrain: model, updatedAt: Date.now() };
    const turnId = views[0]!.turnId;
    const messages = [{ id: 'u', role: 'user', turnId, blocks: [{ type: 'text', text: c!.prompt }] },
      { id: 'a', role: 'assistant', brain: model, turnId, blocks: views.map((v) => ({ type: 'tool_call', id: v.callId, name: 'render_ui', args: {} })) }];
    await page.route('**/api/agent/brains', (r) => r.fulfill({ json: { default: model, brains: [{ id: model, label: model, costTier: '$', available: true, ui: true }] } }));
    await page.route('**/api/agent/threads', (r) => r.fulfill({ json: { threads: [thread] } }));
    await page.route('**/api/agent/threads/proof', (r) => r.fulfill({ json: { thread, messages, uiViews: views, runningTurn: null, lastEventId: 0 } }));
    await page.route('**/api/agent/threads/proof/events?*', (r) => r.fulfill({ contentType: 'text/event-stream', body: 'retry: 10000\n\n' }));
    await seeded(page);
    await page.evaluate(() => { localStorage.setItem('finsight-agent-mode', 'side'); localStorage.setItem('finsight-agent-open', '0'); localStorage.setItem('finsight-agent-w', '560'); });
    await page.reload();
    await expect(page.locator('#detail-title')).toHaveText('VOO · DETAIL');
    await page.click('#agent-toggle');
    await expect(page.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Show chats', exact: true }).click();
    await page.locator('.agent-thread-open:visible').filter({ hasText: thread.title }).click();
    const ui = page.locator('.kx-ui'); await expect(ui).toHaveCount(views.length);
    await ui.first().screenshot({ path: path.join(dir, `${model}-${kind}.png`) });
    const axe = await new AxeBuilder({ page }).include('.kx-ui').analyze();
    expect(axe.violations.filter((v) => ['serious', 'critical'].includes(v.impact || ''))).toEqual([]);
    if (kind === 'table') { const button = ui.getByRole('columnheader').first().getByRole('button'); await button.focus(); await page.keyboard.press('Enter'); await expect(button.locator('..')).toHaveAttribute('aria-sort', 'ascending'); }
  });
}
