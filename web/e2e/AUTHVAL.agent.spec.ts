// AUTHVAL-001: adversarial auth / account / base isolation on the one-app
// build (Phase 4). Two visibly different synthetic accounts (A: the demo
// portfolio, 9 rows; B: "ZZ Synthetic B", MSFT only) and held (delayed)
// responses. Expected behaviour is PLAN §1.3 (keys include account/base,
// nothing runs while locked, cancel on lock, refresh once on unlock, the lock
// screen hides the app) and the retained Kestrel contract (page context sent
// with a message; the chat itself is not per account and is not erased by a lock).
// Tests marked test.fail() are failing repros of findings reported to the
// Phase 4 owner (harness/runs/*AUTHVAL-001*/REPORT.md): they pass while the
// defect exists and flip to "unexpectedly passed" once it is fixed.
import { test, expect, type Page, type Route } from '@playwright/test';
import { PIN, seeded } from './helpers';

const FAKE_AGENT = `http://127.0.0.1:${Number(process.env.E2E_PORT_BASE || 8096) + 1}`;
const rows = (page: Page) => page.locator('#positions-body tr[data-sym]');
const PANELS = ['#summary', '[data-pid="positions"]', '[data-pid="fxrisk"]', '[data-pid="dividends"]', '[data-pid="performance"]',
  '[data-pid="wealth"]', '[data-pid="allocation"]', '[data-pid="heatmap"]'];

async function twoAccounts(page: Page) {
  await seeded(page);
  const a = (await (await page.request.get('/api/accounts')).json()).accounts[0].id as string;
  const b = (await (await page.request.post('/api/accounts/add', { data: { name: 'ZZ Synthetic B' } })).json()).newId as string;
  const r = await page.request.post(`/api/portfolio/import?base=SGD&account=${b}`, { data: { csv: 'symbol,quantity,avg price,date\nMSFT,3,400,2025-01-15', replace: true } });
  expect(r.ok(), await r.text()).toBe(true);
  return { a, b };
}
async function selectAccount(page: Page, id: string) {
  await page.reload();
  await page.selectOption('#account-sel', id);
  await page.waitForLoadState('networkidle');
}
const snap = (page: Page) => page.evaluate((sels) => Object.fromEntries(sels.map((s) => [s, (document.querySelector(s)?.textContent || '').replace(/\s+/g, ' ').trim()])), PANELS);

// Hold every matching API response until release(); others pass through.
async function hold(page: Page, match: (u: URL) => boolean) {
  const held: Route[] = [];
  let seen = 0;
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    if (!match(u)) return route.fallback();
    seen++; held.push(route);
  });
  return {
    seen: () => seen,
    release: async () => { await page.unroute('**/api/**'); for (const r of held.splice(0)) await r.continue().catch(() => {}); },
  };
}
// Protected (non-auth) API requests the page sends, as path+query.
function recorder(page: Page) {
  const calls: string[] = [];
  page.on('request', (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/') && !u.pathname.startsWith('/api/auth/')) calls.push(u.pathname + u.search); });
  return calls;
}
async function lockByButton(page: Page) { await page.click('#lock-btn'); await expect(page.locator('body')).toHaveClass(/\blocked\b/); }
async function lockBySessionExpiry(page: Page) {
  await page.context().clearCookies();
  await page.evaluate(() => { void window.FinSight.bus.invalidate('portfolio'); });
  await expect(page.locator('body')).toHaveClass(/\blocked\b/);
}
async function unlockWithPin(page: Page) {
  await page.fill('#lock-pin', PIN);
  await page.press('#lock-pin', 'Enter');
  await expect(page.locator('body')).not.toHaveClass(/\blocked\b/);
}
const count = (list: string[]) => list.reduce<Record<string, number>>((m, k) => ((m[k] = (m[k] || 0) + 1), m), {});

// ---------------------------------------------------------------- 1 accounts
test('1. A→B→A with every B response held: releasing them leaves all of A on screen', async ({ page }) => {
  test.setTimeout(60_000);
  const { a, b } = await twoAccounts(page);
  await selectAccount(page, a);
  await expect(rows(page)).toHaveCount(9);
  await expect.poll(() => page.evaluate(() => (window as any).detailChart?.tradeData?.account)).toBe(a); // legacy-any: chart.js global
  const before = await snap(page);
  await page.waitForTimeout(1000);
  expect(await snap(page), 'panels are stable before the race').toEqual(before);

  const gate = await hold(page, (u) => u.searchParams.get('account') === b);
  await page.selectOption('#account-sel', b);
  await expect.poll(gate.seen).toBeGreaterThan(2);
  await page.selectOption('#account-sel', a);
  await expect(rows(page)).toHaveCount(9);
  await gate.release();
  await page.waitForTimeout(1500);
  await page.waitForLoadState('networkidle');
  expect(await snap(page)).toEqual(before);
  await expect(rows(page)).toHaveCount(9);
  await expect(page.locator('#positions-body')).not.toContainText('ZZ Synthetic B');
  expect(await page.evaluate(() => (window as any).detailChart.tradeData?.account)).toBe(a);

  // And B on its own shows only B (the data is visibly different).
  await page.selectOption('#account-sel', b);
  await expect(rows(page)).toHaveCount(1);
  await expect(rows(page).first()).toHaveAttribute('data-sym', 'MSFT');
});

// ---------------------------------------------------------------- 2 base
test('2. base SGD→USD→SGD with USD held: no SGD amount is labelled in USD, and release does not switch the figures', async ({ page }) => {
  test.setTimeout(60_000);
  await seeded(page);
  const summary = page.locator('#summary');
  await expect(summary).toContainText('S$92,967.48');
  const usdLabelledSgd = /(^|[^S])\$92,967\.48/;
  const gate = await hold(page, (u) => u.searchParams.get('base') === 'USD');
  await page.selectOption('#base-ccy', 'USD');
  await expect.poll(gate.seen).toBeGreaterThan(1);
  await page.waitForTimeout(500);
  expect(await summary.innerText(), 'while USD loads').not.toMatch(usdLabelledSgd);
  await page.selectOption('#base-ccy', 'SGD');
  await expect(summary).toContainText('S$92,967.48');
  await gate.release();
  await page.waitForTimeout(1500);
  await expect(summary).toContainText('S$92,967.48');
  await expect(summary).not.toContainText('$72,067.81');
  await expect(page.locator('#positions-body tr[data-sym="AAPL"] td').nth(5)).toHaveText(/^S\$/);

  // Held USD released after the switch completes: everything agrees on USD.
  const gate2 = await hold(page, (u) => u.searchParams.get('base') === 'USD');
  await page.selectOption('#base-ccy', 'USD');
  await expect.poll(gate2.seen).toBeGreaterThan(1);
  expect(await summary.innerText()).not.toMatch(usdLabelledSgd);
  await gate2.release();
  await expect(summary).toContainText('$72,067.81');
  await expect(summary).not.toContainText('S$');
  await expect(page.locator('#positions-body tr[data-sym="AAPL"] td').nth(5)).toHaveText('$5,787.50');
  await page.selectOption('#base-ccy', 'SGD');
});

// ---------------------------------------------------------------- 3 lock
test('3a. locked: the lock screen covers the whole viewport even over a maximised chart', async ({ page }) => {
  test.fail(true, 'AUTHVAL-001 F3 (pre-existing in legacy c1f1516): chart.js re-parents a maximised chart to <body> at z-index 1000, above the lock (500). Remove this line when fixed.');
  await seeded(page);
  await page.locator('#detail-panel [title^="Expand chart"]').first().click();
  await expect(page.locator('.chart-max')).toBeVisible();
  await lockBySessionExpiry(page);
  const vp = page.viewportSize()!;
  const points = [[vp.width / 2, vp.height / 2], [20, 20], [vp.width - 20, vp.height - 20], [vp.width / 4, vp.height * 0.75]];
  for (const [x, y] of points) {
    const top = await page.evaluate(([x, y]) => { const el = document.elementFromPoint(x!, y!); return el?.closest('#lock-screen') ? 'lock' : `${el?.tagName}.${el?.className}`; }, [x, y]);
    expect(top, `topmost element at ${x},${y}`).toBe('lock');
  }
});

test('3b. locked: the app behind the lock is hidden, not just covered (positions, summary, Kestrel dock)', async ({ page }) => {
  test.fail(true, 'AUTHVAL-001 F1 (X1 regression): styles.css hides only body > .topbar/.grid/…, but X1 renders them inside #root. Remove this line when fixed.');
  await seeded(page);
  await page.evaluate(() => { localStorage.setItem('finsight-agent-mode', 'dock'); localStorage.setItem('finsight-agent-open', '1'); });
  await page.reload();
  await expect(rows(page)).toHaveCount(9);
  await lockByButton(page);
  await expect(page.locator('#positions-body')).toBeHidden();
  await expect(page.locator('#summary')).toBeHidden();
  await expect(page.locator('#agent-dock')).toBeHidden();
  await expect(page.locator('.agent-panel')).toBeHidden();
});

test('3c. responses held across a lock: no new protected work while locked, the lock and a typed PIN survive the late replies', async ({ page }) => {
  test.setTimeout(60_000);
  await seeded(page);
  await page.waitForLoadState('networkidle');
  const gate = await hold(page, (u) => ['/api/portfolio', '/api/dividends', '/api/fx-risk', '/api/chart-trades'].includes(u.pathname));
  await page.evaluate(() => { for (const k of ['portfolio', 'dividends', 'fx-risk', 'chart-trades']) void window.FinSight.bus.invalidate(k); });
  await expect.poll(gate.seen).toBeGreaterThan(1);
  await lockByButton(page);
  await page.fill('#lock-pin', PIN.slice(0, 2));
  const after = recorder(page);
  await gate.release();
  await page.waitForTimeout(16_000); // a full 15 s poll cycle
  expect(after, 'protected requests sent while locked').toEqual([]);
  await expect(page.locator('body')).toHaveClass(/\blocked\b/);
  await expect(page.locator('#lock-pin')).toHaveValue(PIN.slice(0, 2));
  await page.locator('#lock-pin').pressSequentially(PIN.slice(2));
  await page.press('#lock-pin', 'Enter');
  await expect(page.locator('body')).not.toHaveClass(/\blocked\b/);
  await expect(rows(page)).toHaveCount(9);
});

test('3d. three lock/unlock cycles: each unlock refreshes the current account once, with no growth and no other account', async ({ page }) => {
  test.setTimeout(120_000);
  const { a, b } = await twoAccounts(page);
  await selectAccount(page, b);
  await expect(rows(page)).toHaveCount(1);
  const per: Record<string, number>[] = [];
  for (let i = 0; i < 3; i++) {
    await lockByButton(page);
    await page.waitForTimeout(300);
    const calls = recorder(page);
    await unlockWithPin(page);
    await page.waitForTimeout(4000);
    await page.waitForLoadState('networkidle');
    const mine = calls.slice();
    expect(mine.filter((c) => c.includes(`account=${a}`)), 'requests for the other account').toEqual([]);
    per.push(count(mine));
  }
  expect(per[1]).toEqual(per[0]);
  expect(per[2]).toEqual(per[0]);
  // Once per query. Two URLs are shared by two queries: /api/portfolio (summary
  // and net worth) and /api/categories (positions and net worth).
  const shared = (url: string) => url.startsWith('/api/portfolio?') || url.startsWith('/api/categories?');
  for (const [url, n] of Object.entries(per[0]!)) expect(n, url).toBeLessThanOrEqual(shared(url) ? 2 : 1);
  expect(per[0]![`/api/portfolio?base=SGD&account=${b}`]).toBeGreaterThanOrEqual(1);
  await expect(rows(page)).toHaveCount(1);
});

// ---------------------------------------------------------------- 4 Kestrel
async function openKestrel(page: Page, mode: 'side' | 'dock') {
  await page.evaluate((m) => { localStorage.setItem('finsight-agent-mode', m); localStorage.setItem('finsight-agent-open', '1'); localStorage.removeItem('finsight-agent-thread'); }, mode);
  await page.reload();
  await expect(page.locator('.agent-input:visible')).toBeVisible();
  await expect(page.locator('.agent-send:visible')).toBeEnabled();
}
async function sendKestrel(page: Page, text: string) { const i = page.locator('.agent-input:visible'); await i.fill(text); await i.press('Enter'); }

test('4a. Kestrel sends the selected account and base as page context across switches', async ({ page }) => {
  const { a, b } = await twoAccounts(page);
  await selectAccount(page, a);
  await openKestrel(page, 'dock');
  const ctx = async (text: string) => {
    const req = page.waitForRequest((r) => r.method() === 'POST' && /\/api\/agent\/threads\/[^/]+\/messages$/.test(new URL(r.url()).pathname));
    await sendKestrel(page, text);
    const body = (await req).postDataJSON();
    await expect(page.locator('.agent-turn:visible').last().locator('.agent-text')).toHaveText(`Echo: ${text}`);
    await expect(page.locator('.agent-send:visible')).toHaveText('⏎'); // Enter does not send while a reply runs
    return body.pageContext;
  };
  expect(await ctx('first')).toMatchObject({ account: a, base: 'SGD' });
  await page.selectOption('#account-sel', b);
  expect(await ctx('second')).toMatchObject({ account: b, base: 'SGD' });
  await page.selectOption('#base-ccy', 'USD');
  expect(await ctx('third')).toMatchObject({ account: b, base: 'USD' });
  await page.selectOption('#base-ccy', 'SGD');
  // The conversation is shared across accounts (not an isolation boundary).
  await expect(page.locator('.agent-user:visible')).toHaveCount(3);
});

test('4b. locked with Kestrel docked: Tab from the PIN never leaves the lock screen, and the composer cannot send', async ({ page }) => {
  test.fail(true, 'AUTHVAL-001 F2 (X1 regression, follows F1): elements behind the lock stay in the tab order; the docked composer can be reached and POSTs to /api/agent (401). Remove this line when fixed.');
  await seeded(page);
  await openKestrel(page, 'dock');
  await lockByButton(page);
  await expect(page.locator('#lock-pin')).toBeFocused();
  const agentPosts: string[] = [];
  page.on('request', (r) => { if (r.method() === 'POST' && new URL(r.url()).pathname.startsWith('/api/agent/')) agentPosts.push(new URL(r.url()).pathname); });
  const outside = new Set<string>();
  for (let i = 0; i < 150; i++) {
    await page.keyboard.press('Tab');
    const at = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body || el.closest('#lock-screen')) return null;
      return el.matches('#agent-dock .agent-input') ? 'composer' : `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : ''}`;
    });
    if (!at) continue;
    outside.add(at);
    if (at === 'composer') { await page.keyboard.type('what is my net worth'); await page.keyboard.press('Enter'); await page.waitForTimeout(1500); break; }
  }
  console.log('4b reachable behind the lock:', JSON.stringify([...outside].slice(0, 12)), 'agent POSTs:', JSON.stringify(agentPosts));
  expect([...outside], 'focusable elements behind the lock').toEqual([]);
  expect(agentPosts, 'agent requests sent while locked').toEqual([]);
  await expect(page.locator('body')).toHaveClass(/\blocked\b/);
});

test('4c. side drawer open during lock (stream cut while locked): after unlock the history stays and a new reply streams', async ({ page }) => {
  test.fail(true, 'AUTHVAL-001 F4 (pre-existing in legacy c1f1516): an EventSource reconnect refused with 401 while locked is never reopened after unlock. Remove this line when fixed.');
  test.setTimeout(60_000);
  await seeded(page);
  await openKestrel(page, 'side');
  await sendKestrel(page, 'before lock');
  await expect(page.locator('.agent-turn:visible').last().locator('.agent-text')).toHaveText('Echo: before lock');
  await lockByButton(page);
  await expect(page.locator('.agent-panel')).toBeHidden();
  const r = await page.request.post(`${FAKE_AGENT}/v1/__test/drop`);
  expect((await r.json()).dropped).toBeGreaterThan(0);
  await page.waitForTimeout(1500); // EventSource retry: 300 ms
  await unlockWithPin(page);
  await expect(page.locator('.agent-user:visible').first()).toContainText('before lock');
  await sendKestrel(page, 'after unlock');
  await expect(page.locator('.agent-turn:visible').last().locator('.agent-text')).toHaveText('Echo: after unlock', { timeout: 10_000 });
});
