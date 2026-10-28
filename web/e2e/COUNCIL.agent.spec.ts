import { test, expect } from '@playwright/test';
import { seeded } from './helpers';
test('council is hidden by default and opt-in lens is captured with the message', async ({ page }) => {
  await seeded(page); await page.click('#agent-toggle');
  await expect(page.getByRole('combobox', { name: 'Analytical lens' })).toHaveCount(0);
  await page.route('**/api/agent/info', async (route) => {
    const response = await route.fetch(); const data = await response.json();
    await route.fulfill({ response, json: { ...data, council: true } });
  });
  await page.reload();
  const lens = page.getByRole('combobox', { name: 'Analytical lens' });
  await lens.selectOption('growth');
  await page.getByRole('button', { name: 'Council', exact: true }).click();
  await expect(page.locator('.agent-input:visible')).toHaveValue('/committee ');
  const request = page.waitForRequest((r) => r.url().endsWith('/messages') && r.method() === 'POST');
  await page.locator('.agent-input:visible').fill('/committee synthetic company ');
  await page.locator('.agent-input:visible').press('Enter');
  expect((await request).postDataJSON().lens).toBe('growth');
  await expect(page.locator('.agent-turn:visible').last()).toContainText('Echo: /committee synthetic company');
  await page.route('**/api/agent/threads/*', async (route) => {
    const response = await route.fetch(); const data = await response.json();
    if (!data.messages) return route.fulfill({ response });
    const turnId = data.messages.find((m: {role: string}) => m.role === 'assistant')?.turnId;
    const run = { id: 'synthetic-child', parentId: 'synthetic-parent', role: 'growth', phase: 'assessment', model: 'fixture', version: 1, ms: 10, costUsd: null, findings: { findings: [{ claim: 'Synthetic private finding', evidenceIds: ['e1'], assumptions: [], uncertainty: 'Synthetic uncertainty', counterevidence: [], invalidation: 'New evidence', missingEvidence: [] }], unresolvedQuestions: [] } };
    data.messages.push({ id: 'run-1', role: 'assistant', turnId, blocks: [{ type: 'notice', kind: 'council', text: JSON.stringify({ ...run, status: 'running' }) }] }, { id: 'run-2', role: 'assistant', turnId, blocks: [{ type: 'notice', kind: 'council', text: JSON.stringify({ ...run, status: 'completed' }) }] });
    await route.fulfill({ response, json: data });
  });
  await page.locator('.agent-icon-btn[title="New chat (/new)"]:visible').click();
  await page.locator('.kx-jump-row', { hasText: '/committee synthetic company' }).first().click();
  const summary = page.locator('summary', { hasText: 'Business & Growth' });
  await expect(summary).toHaveCount(1); await summary.click();
  await expect(page.getByText('Synthetic private finding', { exact: false })).toBeVisible();
  await page.evaluate(() => window.FinSight.store.setState({ peek: false }));
  await expect(page.getByText('Findings hidden by UNPEEK.')).toBeVisible();
  await expect(page.getByText('Synthetic private finding', { exact: false })).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(summary).toBeVisible();
});
