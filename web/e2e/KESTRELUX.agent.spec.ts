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
  // Everything the page covers is out of the Tab order: focus never leaves the chat.
  for (const sel of ['.cmdbar', '[data-island="status"]', 'main.grid', 'footer.statusbar']) await expect(page.locator(sel).first()).toHaveAttribute('inert', '');
  await input.focus();
  for (let i = 0; i < 40; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('.cmdbar, main.grid, footer.statusbar, [data-island="status"]'))).toBe(false);
  }
  await page.getByRole('button', { name: 'Exit full page' }).click();
  await expect(page.locator('body')).not.toHaveClass(/agent-full/);
  await expect(page.locator('main.grid')).not.toHaveAttribute('inert', '');
  await expect(page.locator('.cmdbar').first()).not.toHaveAttribute('inert', '');
  await input.fill('');
  await input.focus();
  await page.keyboard.press('ControlOrMeta+Shift+Slash');
  await expect(page.locator('body')).toHaveClass(/agent-full/);
  await input.focus();
  await page.keyboard.press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/agent-full/);
  await expect(page.locator('body')).toHaveClass(/agent-open/);
});

// TSM demo audit 2026-10-31: opened while the terminal was scrolled down, the
// full page started above the viewport (top -429px), hiding the previous prompt
// and the exit control. Browser zoom is emulated by resizing the CSS viewport,
// which is what zooming does to layout (80% zoom = a 1.25× larger viewport).
test('full page opened with the terminal scrolled keeps the header, exit and earlier prompt in view, across zoom, and ⌘⇧/ returns to the same place', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 640 });
  await seeded(page);
  await page.click('#agent-toggle');
  const input = page.locator('#agent-panel .agent-input');
  await input.fill('earlier prompt');
  await input.press('Enter');
  await expect(page.locator('#agent-panel .agent-user .q').first()).toHaveText('earlier prompt');
  await expect(page.locator('#agent-toggle')).not.toHaveClass(/busy/, { timeout: 15_000 });
  const panelInView = async () => {
    const vh = page.viewportSize()!.height;
    const box = (await page.locator('#agent-panel').boundingBox())!;
    const exit = (await page.getByRole('button', { name: 'Exit full page' }).boundingBox())!;
    return box.y >= 0 && box.y + box.height <= vh + 1 && exit.y >= 0 && exit.y + exit.height <= vh;
  };
  for (const depth of [0, 200, 10_000]) {
    await page.evaluate((y) => window.scrollTo(0, y), depth);
    const before = await page.evaluate(() => window.scrollY);
    if (depth) expect(before).toBeGreaterThan(0);
    await input.focus();
    await page.keyboard.press('ControlOrMeta+Shift+Slash');
    await expect(page.locator('body')).toHaveClass(/agent-full/);
    await expect.poll(panelInView).toBe(true);
    // The earlier prompt is reachable by scrolling the chat itself.
    const log = page.locator('#agent-panel .agent-log');
    await log.evaluate((el) => { el.scrollTop = 0; });
    const prompt = page.locator('#agent-panel .agent-user').first();
    await expect(prompt).toBeInViewport();
    // Zoomed out (80%) and in (125%) while open.
    for (const size of [{ width: 1600, height: 800 }, { width: 1024, height: 512 }, { width: 1280, height: 640 }]) {
      await page.setViewportSize(size);
      await expect.poll(panelInView).toBe(true);
    }
    await expect(input).toBeVisible();
    await input.focus();
    await page.keyboard.press('ControlOrMeta+Shift+Slash');
    await expect(page.locator('body')).not.toHaveClass(/agent-full/);
    await expect(page.locator('body')).toHaveClass(/agent-open/);
    await expect(page.locator('main.grid')).not.toHaveAttribute('inert', '');
    // Same place, or the bottom when the resized page re-laid out shorter.
    const [y, max] = await page.evaluate(() => [window.scrollY, document.scrollingElement!.scrollHeight - window.innerHeight]);
    expect(y).toBe(Math.min(before, max));
  }
  // Pointer path: the visible exit control returns too.
  await page.evaluate(() => window.scrollTo(0, 10_000));
  await page.getByRole('button', { name: 'Open full page' }).click();
  await expect.poll(panelInView).toBe(true);
  await page.getByRole('button', { name: 'Exit full page' }).click();
  await expect(page.locator('body')).not.toHaveClass(/agent-full/);
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
      ({ id: 'run-' + i, role: 'assistant', turnId, blocks: [{ type: 'notice', kind: 'council', text: JSON.stringify({ id: 'c' + i, parentId: 'p', role, phase, model: 'fixture', version: 1, ms: 10, costUsd: null, status: 'completed', metricIssues: [role === 'growth' ? 'Synthetic growth figure warning' : 'Synthetic chair figure warning'], findings: findings(claim!) }) }] }));
    data.messages.push(...runs);
    await route.fulfill({ response, json: data });
  });
  await page.locator('.agent-icon-btn[title="New chat (/new)"]:visible').click();
  await page.locator('.kx-jump-row', { hasText: '/committee synthetic lanes' }).first().click();
  const board = page.locator('[data-council-board]');
  await expect(board).toHaveAttribute('data-view', 'cards');
  await expect(board.getByRole('button', { name: '≡ Chain of thought' })).toHaveCount(0); // the switch is a full-page control
  await page.getByRole('button', { name: 'Open full page' }).click();
  await expect(board.getByText('Figures unverified (1)')).toHaveCount(2);
  await board.getByRole('button', { name: '≡ Chain of thought' }).click();
  await expect(board).toHaveAttribute('data-view', 'chain');
  await expect(board.getByLabel('Business & Growth lane')).toContainText('Synthetic growth figure warning');
  await expect(board.getByLabel('Kestrel Chair lane')).toContainText('Synthetic chair figure warning');
  await expect(board.getByLabel('Business & Growth lane')).toContainText('Synthetic lane claim');
  await expect(board.getByLabel('Kestrel Chair lane')).toContainText('Synthetic chair ruling');
  await page.locator('#agent-panel .agent-input').fill('Unsent draft');
  await board.getByRole('button', { name: 'Answer in the composer' }).click();
  await expect(page.locator('#agent-panel .agent-input')).toHaveValue('Unsent draft\n\nSynthetic open question?');
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
  await expect(board.getByText('Synthetic growth figure warning')).toHaveCount(0);
  await expect(board.getByText('Synthetic chair figure warning')).toHaveCount(0);
  await expect(board.locator('[data-figure-check]')).toHaveCount(2);
});

test('a failed chair shows its failure in Chain of thought, not a loading placeholder', async ({ page }) => {
  await page.route('**/api/agent/info', async (route) => {
    const response = await route.fetch(); const data = await response.json();
    await route.fulfill({ response, json: { ...data, council: true } });
  });
  await seeded(page); await page.click('#agent-toggle');
  await page.locator('.agent-input:visible').fill('/committee synthetic failed chair ');
  await page.locator('.agent-input:visible').press('Enter');
  await expect(page.locator('.agent-turn:visible').last()).toContainText('Echo: /committee synthetic failed chair');
  await page.route('**/api/agent/threads/*', async (route) => {
    const response = await route.fetch(); const data = await response.json();
    if (!data.messages) return route.fulfill({ response });
    const turnId = data.messages.find((m: { role: string }) => m.role === 'assistant')?.turnId;
    data.messages.push({ id: 'run-f', role: 'assistant', turnId, blocks: [{ type: 'notice', kind: 'council', text: JSON.stringify({ id: 'cf', parentId: 'p', role: 'chair', phase: 'synthesis', model: 'fixture', version: 1, ms: 10, costUsd: null, status: 'failed', error: 'Synthetic chair outage' }) }] });
    await route.fulfill({ response, json: data });
  });
  await page.locator('.agent-icon-btn[title="New chat (/new)"]:visible').click();
  await page.locator('.kx-jump-row', { hasText: '/committee synthetic failed chair' }).first().click();
  await page.getByRole('button', { name: 'Open full page' }).click();
  const board = page.locator('[data-council-board]');
  await board.getByRole('button', { name: '≡ Chain of thought' }).click();
  const chair = board.getByLabel('Kestrel Chair lane');
  await expect(chair).toHaveAttribute('data-state', 'failed');
  await expect(chair).toContainText('Synthesis failed');
  await expect(chair.locator('[aria-hidden="true"] i')).toHaveCount(0); // no shimmer
});

// TSM demo audit 2026-10-31: the persisted risk assessment completed and only
// its challenge was refused by the spending cap (older record: error text, no cause).
test('replayed Risk card with a budget-refused challenge shows its assessment and the phase that did not run', async ({ page }) => {
  await page.route('**/api/agent/info', async (route) => {
    const response = await route.fetch(); const data = await response.json();
    await route.fulfill({ response, json: { ...data, council: true } });
  });
  await seeded(page); await page.click('#agent-toggle');
  await page.locator('.agent-input:visible').fill('/committee synthetic capped challenge ');
  await page.locator('.agent-input:visible').press('Enter');
  await expect(page.locator('.agent-turn:visible').last()).toContainText('Echo: /committee synthetic capped challenge');
  const findings = JSON.stringify({ findings: [{ claim: 'Synthetic risk assessment', evidenceIds: ['e1'], assumptions: [], uncertainty: 'Synthetic', counterevidence: [], invalidation: 'Synthetic', missingEvidence: [] }], unresolvedQuestions: [] });
  const run = (id: string, role: string, phase: string, extra: object) => ({ type: 'notice', kind: 'council', text: JSON.stringify({ id, parentId: 'p', role, phase, model: 'fixture', version: 1, ms: 10, costUsd: 0.001, ...extra }) });
  await page.route('**/api/agent/threads/*', async (route) => {
    const response = await route.fetch(); const data = await response.json();
    if (!data.messages) return route.fulfill({ response });
    const turnId = data.messages.find((m: { role: string }) => m.role === 'assistant')?.turnId;
    data.messages.push({ id: 'run-r', role: 'assistant', turnId, blocks: [
      run('ra', 'risk', 'assessment', { status: 'completed', findings: JSON.parse(findings) }),
      run('rc', 'risk', 'challenge', { status: 'failed', costUsd: 0, error: 'Council turn budget cannot cover next call' }),
      { type: 'notice', kind: 'council', text: JSON.stringify({ kind: 'readiness', version: 1, level: 'partial', stages: { completed: 6, expected: 7 }, evidence: { retrieved: 9 }, unverifiedFigures: 0, reasons: [], stageIssues: ['Risk challenge: stopped by the spending cap'], budget: { capUsd: 0.05, capSource: 'limits.turnUsd' } }) },
    ] });
    await route.fulfill({ response, json: data });
  });
  await page.locator('.agent-icon-btn[title="New chat (/new)"]:visible').click();
  await page.locator('.kx-jump-row', { hasText: '/committee synthetic capped challenge' }).first().click();
  const card = page.locator('[data-council-board] [data-role="risk"]');
  await expect(card).toContainText('Assessed · challenge not run · spending cap reached');
  await expect(card).toContainText('Partial');
  await expect(card).not.toContainText('Assessment missing');
  await expect(page.locator('[data-stage-issues]')).toContainText('Risk challenge: stopped by the spending cap');
});
