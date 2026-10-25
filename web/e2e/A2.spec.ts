import { test, expect, type Page } from '@playwright/test';
import { seeded, cmd, unlock, dragPanel, PIN } from './helpers';

const now = Date.parse('2026-10-25T04:00:00Z');
async function fixture(page: Page) {
  await page.clock.setFixedTime(new Date(now));
  await page.route('**/api/news**', async (route) => {
    const symbol = new URL(route.request().url()).searchParams.get('symbol') || 'market';
    await route.fulfill({ json: { news: [
      { title: `${symbol} <headline>`, publisher: 'Wire & Co', link: 'https://example.com/story?a=1&b=2', time: now - 12 * 60_000, tickers: [symbol] },
      { title: 'Earlier story', publisher: 'Daily', link: 'https://example.com/earlier', time: now - 3 * 3600_000, tickers: [] },
      { title: 'Older story', publisher: null, link: 'https://example.com/older', time: now - 2 * 86400_000, tickers: [] },
      { title: 'Undated story', link: 'https://example.com/undated', time: null, tickers: [] },
    ] } });
  });
}

test('headlines follow selection; text, metadata and external-link behavior match legacy', async ({ page }, info) => {
  await fixture(page); await seeded(page);
  await expect(page.locator('#news-sym')).toHaveText('VOO');
  const links = page.locator('#news a');
  await expect(links).toHaveCount(4);
  await expect(links.first()).toContainText('VOO <headline>');
  await expect(links.first()).toContainText('Wire & Co · 12m ago');
  await expect(links.nth(1)).toContainText('3h ago');
  await expect(links.nth(2)).toContainText('2d ago');
  await expect(links.first()).toHaveAttribute('href', 'https://example.com/story?a=1&b=2');
  await expect(links.first()).toHaveAttribute('target', '_blank');
  await expect(links.first()).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(page.locator('#news headline')).toHaveCount(0);
  await page.locator('#positions-body tr[data-sym="MSFT"] td').first().click();
  await expect(page.locator('#news-sym')).toHaveText('MSFT');
  await expect(links.first()).toContainText('MSFT <headline>');
  await page.locator('.panel[data-pid="news"]').screenshot({ path: info.outputPath('news-panel.png') });
});

test('NEWS without a symbol keeps detail selection; NEWS symbol and repeated selection refresh', async ({ page }) => {
  await fixture(page); await seeded(page);
  await expect(page.locator('#news a').first()).toContainText('VOO <headline>');
  await cmd(page, 'NEWS');
  await expect(page.locator('#news-sym')).toHaveText('market');
  await expect(page.locator('#news a').first()).toContainText('market <headline>');
  await expect(page.locator('#detail-title')).toHaveText('VOO · DETAIL');
  await cmd(page, 'NEWS MSFT');
  await expect(page.locator('#news a').first()).toContainText('MSFT <headline>');
  const request = page.waitForRequest((r) => new URL(r.url()).pathname === '/api/news' && new URL(r.url()).searchParams.get('symbol') === 'MSFT');
  await cmd(page, 'NEWS MSFT'); await request;
  await cmd(page, 'NEWS'); await expect(page.locator('#news-sym')).toHaveText('market');
  await cmd(page, 'Q MSFT'); await expect(page.locator('#news-sym')).toHaveText('MSFT');
});

test('loading, empty and HTTP error messages match legacy', async ({ page }) => {
  await fixture(page); await seeded(page);
  await page.route('**/api/news?symbol=NVDA', (route) => route.fulfill({ json: { news: [] } }));
  await cmd(page, 'NEWS NVDA');
  await expect(page.locator('#news')).toHaveText('No headlines found.');
  await page.route('**/api/news?symbol=AAPL', (route) => route.fulfill({ status: 503, json: { error: 'fixture unavailable' } }));
  await cmd(page, 'NEWS AAPL');
  await expect(page.locator('#news')).toHaveText('News error: fixture unavailable');
  let release!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  await page.route('**/api/news?symbol=MSFT', async (route) => { await held; await route.fulfill({ json: { news: [] } }); });
  await cmd(page, 'NEWS MSFT');
  try { await expect(page.locator('#news')).toHaveText('Loading news…'); } finally { release(); }
  await expect(page.locator('#news')).toHaveText('No headlines found.');
});

test('an empty portfolio starts with general market headlines', async ({ page }) => {
  await fixture(page); await unlock(page);
  await page.request.post('/api/portfolio/reset', { data: {} });
  await page.reload();
  await expect(page.locator('#news-sym')).toHaveText('market');
  await expect(page.locator('#news a').first()).toContainText('market <headline>');
});

test('intended fix (A2): a delayed previous symbol cannot overwrite current headlines', async ({ page }) => {
  await fixture(page); await seeded(page);
  await expect(page.locator('#news a').first()).toContainText('VOO <headline>');
  let release!: () => void, seen!: () => void, finished!: () => void;
  const held = new Promise<void>((resolve) => { release = resolve; });
  const intercepted = new Promise<void>((resolve) => { seen = resolve; });
  const completed = new Promise<void>((resolve) => { finished = resolve; });
  await page.route('**/api/news?symbol=MSFT', async (route) => {
    seen(); await held;
    try { await route.fulfill({ json: { news: [{ title: 'stale MSFT result', link: 'https://example.com/stale', time: null, tickers: [] }] } }); }
    finally { finished(); }
  });
  await cmd(page, 'NEWS MSFT'); await intercepted;
  try {
    await cmd(page, 'NEWS NVDA');
    await expect(page.locator('#news a').first()).toContainText('NVDA <headline>');
  } finally { release(); }
  await completed;
  await page.waitForTimeout(150);
  await expect(page.locator('#news-sym')).toHaveText('NVDA');
  await expect(page.locator('#news a').first()).toContainText('NVDA <headline>');
});

test('drag/reload and hide/reload keep one news host; selection triggers one request', async ({ page }) => {
  await fixture(page); await seeded(page);
  await expect(page.locator('#news a').first()).toContainText('VOO <headline>');
  await dragPanel(page, 'news', '.col-left');
  await page.reload();
  await expect(page.locator('.col-left > .panel[data-pid="news"]')).toHaveCount(1);
  await expect(page.locator('#news a').first()).toContainText('VOO <headline>');
  const requests: string[] = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/news') requests.push(r.url()); });
  await cmd(page, 'NEWS MSFT');
  await expect(page.locator('#news a').first()).toContainText('MSFT <headline>');
  expect(requests.filter((url) => new URL(url).searchParams.get('symbol') === 'MSFT')).toHaveLength(1);
  await page.click('#cards-btn');
  await page.locator('#panels-list input[data-panel="news"]').uncheck(); await page.click('#cards-done');
  await page.reload();
  await expect(page.locator('.panel[data-pid="news"]')).toBeHidden();
  await page.click('#cards-btn');
  await page.locator('#panels-list input[data-panel="news"]').check(); await page.click('#cards-done');
  await expect(page.locator('#news a').first()).toContainText('VOO <headline>');
  await expect(page.locator('.panel[data-pid="news"]')).toHaveCount(1);
});

test('lock stops news requests; unlock refreshes; removing the island removes command subscriptions', async ({ page, context }) => {
  await fixture(page); await seeded(page);
  await expect(page.locator('#news a').first()).toContainText('VOO <headline>');
  await context.clearCookies();
  await page.evaluate(() => { void window.FinSight.bus.invalidate('portfolio'); });
  await expect(page.locator('body')).toHaveClass(/\blocked\b/);
  const requests: string[] = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/news') requests.push(r.url()); });
  await page.evaluate(() => window.FinSight.bus.invalidate('news-selected'));
  expect(requests).toEqual([]);
  await page.fill('#lock-pin', PIN); await page.press('#lock-pin', 'Enter');
  await expect(page.locator('body')).not.toHaveClass(/\blocked\b/);
  await expect.poll(() => requests.length).toBeGreaterThan(0);
  await expect(page.locator('#news a').first()).toContainText('VOO <headline>');
  await page.evaluate(() => document.getElementById('news')!.remove());
  await page.waitForTimeout(100); requests.length = 0;
  await page.evaluate(async () => { await window.FinSight.bus.invalidate('news-selected'); await window.FinSight.bus.invalidate('news-market'); });
  expect(requests).toEqual([]);
});
