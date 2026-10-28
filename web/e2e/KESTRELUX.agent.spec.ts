import { test, expect } from '@playwright/test';
import { seeded } from './helpers';

// FEAT-009 Phase 0b–1: light mode, full page, the capsule and busy state.
test('light mode applies before first paint, persists, and the ◐ button toggles it', async ({ page }) => {
  await seeded(page);
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
  await page.click('#mode-btn');
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
  expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).toBe('rgb(243, 243, 248)');
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'light');
  await expect(page.locator('#mode-btn')).toHaveAttribute('aria-pressed', 'true');
  await page.click('#mode-btn');
  await expect(page.locator('html')).toHaveAttribute('data-mode', 'dark');
});

test('full page covers the grid below the top bar without remounting the chat; Esc and ⌘⇧/ return', async ({ page }) => {
  await seeded(page);
  await page.click('#agent-toggle');
  const input = page.locator('#agent-panel .agent-input');
  await input.fill('kept draft');
  await page.getByRole('button', { name: 'Open full page' }).click();
  await expect(page.locator('body')).toHaveClass(/agent-full/);
  await expect(page.locator('main.grid')).toHaveAttribute('inert', '');
  const top = await page.locator('header.topbar').boundingBox();
  await expect.poll(async () => (await page.locator('#agent-panel').boundingBox())?.x).toBe(0);
  await expect.poll(async () => Math.round((await page.locator('#agent-panel').boundingBox())!.y)).toBe(Math.round(top!.y + top!.height));
  await expect(input).toHaveValue('kept draft');
  await page.getByRole('button', { name: 'Exit full page' }).click();
  await expect(page.locator('body')).not.toHaveClass(/agent-full/);
  await expect(page.locator('main.grid')).not.toHaveAttribute('inert', '');
  await input.fill('');
  await input.focus();
  await page.keyboard.press('ControlOrMeta+Shift+Slash');
  await expect(page.locator('body')).toHaveClass(/agent-full/);
  await input.focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/agent-full/);
  await expect(page.locator('body')).toHaveClass(/agent-open/);
});

test('closing during a reply shows the capsule; it reopens the panel and leaves with the run', async ({ page }) => {
  await seeded(page);
  await page.click('#agent-toggle');
  await page.locator('#agent-panel .agent-input').fill('please be slow');
  await page.locator('#agent-panel .agent-input').press('Enter');
  await expect(page.locator('#agent-toggle')).toHaveClass(/busy/);
  await page.getByRole('button', { name: 'Close chat' }).click();
  const capsule = page.locator('[data-kx-capsule]');
  await expect(capsule).toBeVisible();
  await expect(capsule).toHaveAttribute('role', 'status');
  await capsule.getByRole('button', { name: 'Open Kestrel', exact: true }).click();
  await expect(capsule).toHaveCount(0);
  await expect(page.locator('body')).toHaveClass(/agent-open/);
  await page.getByRole('button', { name: 'Close chat' }).click();
  await capsule.getByRole('button', { name: 'Open Kestrel full page' }).click();
  await expect(page.locator('body')).toHaveClass(/agent-full/);
  await page.getByRole('button', { name: 'Close chat' }).click();
  await expect(capsule).toHaveCount(0, { timeout: 15_000 });
  await expect(page.locator('#agent-toggle')).not.toHaveClass(/busy/);
});

// FEAT-009 Phase 3: Cards / Chain of thought on the full page, from real runs.
test('full page council switches between Cards and Chain of thought, remembers it, and UNPEEK hides findings', async ({ page }) => {
  await page.route('**/api/agent/info', async (route) => {
    const response = await route.fetch(); const data = await response.json();
    await route.fulfill({ response, json: { ...data, council: true } });
  });
  await seeded(page); await page.click('#agent-toggle');
  await page.locator('.agent-input:visible').fill('/committee synthetic lanes ');
  await page.locator('.agent-input:visible').press('Enter');
  await expect(page.locator('.agent-turn:visible').last()).toContainText('Echo: /committee synthetic lanes');
  await page.route('**/api/agent/threads/*', async (route) => {
    const response = await route.fetch(); const data = await response.json();
    if (!data.messages) return route.fulfill({ response });
    const turnId = data.messages.find((m: { role: string }) => m.role === 'assistant')?.turnId;
    const findings = (claim: string) => ({ findings: [{ claim, evidenceIds: ['e1'], assumptions: [], uncertainty: 'Synthetic uncertainty', counterevidence: [], invalidation: 'New evidence', missingEvidence: [] }], unresolvedQuestions: ['Synthetic open question?'] });
    const runs = [['growth', 'assessment', 'Synthetic lane claim'], ['chair', 'synthesis', 'Synthetic chair ruling']].map(([role, phase, claim], i) =>
      ({ id: 'run-' + i, role: 'assistant', turnId, blocks: [{ type: 'notice', kind: 'council', text: JSON.stringify({ id: 'c' + i, parentId: 'p', role, phase, model: 'fixture', version: 1, ms: 10, costUsd: null, status: 'completed', findings: findings(claim!) }) }] }));
    data.messages.push(...runs);
    await route.fulfill({ response, json: data });
  });
  await page.locator('.agent-icon-btn[title="New chat (/new)"]:visible').click();
  await page.locator('.kx-jump-row', { hasText: '/committee synthetic lanes' }).first().click();
  const board = page.locator('[data-council-board]');
  await expect(board).toHaveAttribute('data-view', 'cards');
  await expect(board.getByRole('button', { name: '≡ Chain of thought' })).toHaveCount(0); // the switch is a full-page control
  await page.getByRole('button', { name: 'Open full page' }).click();
  await board.getByRole('button', { name: '≡ Chain of thought' }).click();
  await expect(board).toHaveAttribute('data-view', 'chain');
  await expect(board.getByLabel('Business & Growth lane')).toContainText('Synthetic lane claim');
  await expect(board.getByLabel('Kestrel Chair lane')).toContainText('Synthetic chair ruling');
  await board.getByRole('button', { name: 'Answer in the composer' }).click();
  await expect(page.locator('#agent-panel .agent-input')).toHaveValue('Synthetic open question?');
  await page.locator('#agent-panel .agent-input').fill('');
  await page.keyboard.press('ControlOrMeta+Period');
  await expect(board).toHaveAttribute('data-view', 'cards');
  await page.keyboard.press('ControlOrMeta+Period');
  await expect(board).toHaveAttribute('data-view', 'chain');
  expect(await page.evaluate(() => localStorage.getItem('kestrel.councilView'))).toBe('chain');
  await page.evaluate(() => window.FinSight.store.setState({ peek: false }));
  await expect(board.getByText('Synthetic lane claim')).toHaveCount(0);
  await expect(board.getByText('Synthetic chair ruling')).toHaveCount(0);
  await expect(board.getByText('Synthetic open question?')).toHaveCount(0);
});
