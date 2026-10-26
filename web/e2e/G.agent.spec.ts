// G1–G3: Kestrel chat against the fake agent. Written against legacy
// agent-panel.js first. Prompt words drive the fake: "tools", "markdown", "fail".
import { test, expect, type Page } from '@playwright/test';
import { seeded, answerDialog } from './helpers';

const input = (page: Page) => page.locator('.agent-input:visible');
const lastTurn = (page: Page) => page.locator('.agent-turn:visible').last();
async function open(page: Page) {
  await seeded(page);
  await page.evaluate(() => { localStorage.setItem('finsight-agent-mode', 'side'); localStorage.removeItem('finsight-agent-thread'); });
  await page.reload();
  await expect(page.locator('#detail-title')).toHaveText('VOO · DETAIL'); // the welcome and context follow the selection
  await page.click('#agent-toggle');
  await expect(input(page)).toBeVisible();
  await expect(page.locator('.agent-send:visible')).toBeEnabled();
}
async function send(page: Page, text: string) { await input(page).fill(text); await input(page).press('Enter'); }
// A bare command opens the slash menu: the first Enter picks it, the second sends it.
async function command(page: Page, text: string) {
  await input(page).fill(text);
  await expect(page.locator('.agent-menu:visible')).toBeVisible();
  await input(page).press('Enter');
  await expect(input(page)).toHaveValue(text + ' ');
  await input(page).press('Enter');
}

test('welcome, suggestion chips, page context on the message, model list', async ({ page }) => {
  await open(page);
  await expect(page.locator('.agent-welcome .hi')).toHaveText('What are we looking at today?');
  await expect(page.locator('.agent-try .agent-chip')).toHaveCount(4);
  await expect(page.locator('.agent-try .agent-chip').first()).toHaveText('What do my strategies say about VOO right now?');
  await expect(page.locator('.agent-ctx:visible')).toHaveText('◉ VOO 1d');
  await expect(page.locator('.agent-model:visible option')).toHaveText(['Fake model $']);
  await expect(input(page)).toHaveAttribute('placeholder', 'Ask Kestrel anything…  (/ for skills)');
  await page.locator('.agent-try .agent-chip').nth(2).click();
  await expect(page.locator('.agent-user:visible').last().locator('.q')).toHaveText('What is my currency and sector exposure?');
  await expect(page.locator('.agent-user:visible').last().locator('.meta')).toHaveText('@VOO · 1d');
  await expect(lastTurn(page).locator('.agent-text')).toHaveText('Echo: What is my currency and sector exposure?');
  await expect(lastTurn(page).locator('.agent-meta')).toContainText('Fake model');
  await page.locator('.agent-ctx:visible').click();
  await expect(page.locator('.agent-ctx:visible')).toHaveText('○ no context');
  await send(page, 'no ctx');
  await expect(page.locator('.agent-user:visible').last().locator('.meta')).toHaveCount(0);
  await page.locator('.agent-ctx:visible').click();
});

test('tool rows, citations and cost; markdown is rendered safely; failures show', async ({ page }) => {
  await open(page);
  await send(page, 'use tools please');
  const tool = lastTurn(page).locator('.agent-tool');
  await expect(tool).toHaveClass('agent-tool ok');
  await expect(tool.locator('summary .nm')).toHaveText('get_portfolio');
  await expect(tool.locator('summary .args')).toHaveText('(account: main)');
  await expect(tool.locator('.res')).toHaveText('9 positions · 1.2 s');
  const cite = lastTurn(page).locator('.agent-cite');
  await expect(cite).toHaveText('example.com');
  await expect(cite).toHaveAttribute('href', 'https://www.example.com/report');
  await expect(cite).toHaveClass('agent-cite primary');
  await expect(lastTurn(page).locator('.agent-meta')).toContainText('$0.012'); // 3 decimals from $0.01 up
  await expect(lastTurn(page).locator('.agent-meta button')).toHaveText(['copy']);

  await send(page, 'markdown please');
  const text = lastTurn(page).locator('.agent-text');
  await expect(text.locator('h2')).toHaveText('Head');
  await expect(text.locator('strong')).toHaveText('bold');
  await expect(text.locator('td.num')).toHaveText('+1.5%');
  await expect(text.locator('script, img')).toHaveCount(0);
  await expect(text).toContainText('<script>window.__xss = 1</script>');
  expect(await page.evaluate(() => (window as unknown as { __xss?: number }).__xss)).toBeUndefined();

  await send(page, 'please fail now');
  await expect(lastTurn(page).locator('.agent-notice.error')).toHaveText('model exploded');
  await expect(page.locator('.agent-send:visible')).toHaveAttribute('aria-label', 'Send');
});

test('slash menu: skills and commands, keyboard pick, /model, /cost, /skills, /new', async ({ page }) => {
  await open(page);
  await input(page).fill('/');
  const menu = page.locator('.agent-menu:visible');
  await expect(menu.locator('.grp')).toHaveText(['SKILLS', 'COMMANDS']);
  await expect(menu.locator('.it .k').first()).toHaveText('/pre-trade-check');
  await expect(menu.locator('.it.sel .k')).toHaveText('/pre-trade-check');
  await input(page).press('ArrowDown');
  await expect(menu.locator('.it.sel .k')).toHaveText('/new');
  await input(page).fill('/mo');
  await expect(menu.locator('.it .k')).toHaveText(['/model']);
  await input(page).press('Tab');
  await expect(input(page)).toHaveValue('/model ');
  await expect(page.locator('.agent-menu')).toBeHidden();
  await input(page).press('Enter');
  await expect(page.locator('.agent-log:visible .agent-notice').last()).toHaveText('Models: fake');
  await send(page, '/model fake');
  await expect(page.locator('.agent-log:visible .agent-notice').last()).toHaveText('Model set to Fake model.');
  await command(page, '/cost');
  await expect(page.locator('.agent-log:visible .agent-notice').last()).toHaveText('Spend today: $0.5000 (daily cap $2).');
  await command(page, '/skills');
  await expect(page.locator('.agent-log:visible .agent-notice').last()).toHaveText('/pre-trade-check — Check a trade against the policy');
  await command(page, '/new');
  await expect(page.locator('.agent-welcome:visible')).toBeVisible();
});

test('Kestrel opens on a new chat beside the chat list; a chat opens from the list and deletes', async ({ page }) => {
  await open(page);
  await send(page, 'first chat');
  await expect(lastTurn(page).locator('.agent-text')).toHaveText('Echo: first chat');
  await page.reload();
  await expect(page.locator('body')).toHaveClass(/\bagent-open\b/);
  // KESTRELUI-001: a reload starts a new chat; the narrow panel lists recent chats on the start screen.
  await expect(page.locator('.agent-welcome:visible')).toBeVisible();
  await expect(page.locator('.kx-recent-row', { hasText: 'first chat' }).first()).toBeVisible();
  await expect(page.locator('.kx-rail')).toHaveCount(0);
  await page.locator('.agent-icon-btn[title="Chats"]:visible').click();
  const row = page.locator('.agent-thread-row', { hasText: 'first chat' }).first();
  await expect(row).toBeVisible();
  await expect(row.locator('.p')).toHaveText('Echo: first chat');
  await row.click();
  await expect(page.locator('.agent-threads')).toBeHidden();
  await expect(lastTurn(page).locator('.agent-text')).toHaveText('Echo: first chat');
  await page.locator('.agent-icon-btn[title="New chat (/new)"]:visible').click();
  await expect(page.locator('.agent-welcome:visible')).toBeVisible();
  await page.locator('.kx-recent-row', { hasText: 'first chat' }).first().click();
  await expect(lastTurn(page).locator('.agent-text')).toHaveText('Echo: first chat');
  await page.locator('.agent-icon-btn[title="Chats"]:visible').click();
  const first = page.locator('.agent-thread-row', { hasText: 'first chat' }).first();
  await first.hover(); // the delete button shows on hover
  await first.locator('.x').click();
  await answerDialog(page);
  await expect(page.locator('.agent-welcome:visible')).toBeVisible();
});

test('wide panel: the chat rail sits beside the chat; search provider is picked per message, remembered and shown', async ({ page }) => {
  await open(page);
  await page.evaluate(() => localStorage.setItem('finsight-agent-w', '800'));
  await page.reload();
  const rail = page.locator('.kx-rail:visible');
  await expect(rail).toBeVisible();
  await expect(page.locator('.agent-welcome:visible')).toBeVisible();
  await expect(page.locator('.kx-recent')).toHaveCount(0); // the rail lists the chats instead
  const search = page.locator('.agent-search:visible');
  await expect(search.locator('option')).toHaveText(['Auto (Tavily)', 'DeepSeek', 'Tavily', 'Brave · no key']);
  await expect(search).toHaveValue('auto');
  await send(page, 'auto search');
  await expect(lastTurn(page).locator('.agent-meta')).toContainText('Tavily search');
  await search.selectOption('deepseek');
  await send(page, 'picked search');
  await expect(lastTurn(page).locator('.agent-meta')).toContainText('DeepSeek search');
  await expect(rail.locator('.agent-thread-row.active .t')).toHaveText('auto search');
  await expect(rail.locator('.kx-spend')).toHaveText('Today$0.500');
  await rail.locator('.kx-find input').fill('no such chat');
  await expect(rail.locator('.kx-empty')).toHaveText('No chats match.');
  await rail.locator('.kx-find input').fill('');
  // The pick and a hidden rail are remembered per browser.
  await page.locator('.agent-icon-btn[title="Chats"]:visible').click();
  await expect(page.locator('.kx-rail')).toHaveCount(0);
  await page.reload();
  await expect(page.locator('.agent-search:visible')).toHaveValue('deepseek');
  await expect(page.locator('.kx-rail')).toHaveCount(0);
  await page.locator('.agent-icon-btn[title="Chats"]:visible').click();
  await expect(page.locator('.kx-rail:visible')).toBeVisible();
});

test('⌘/ and Esc open and close; Esc keeps a typed message; width presets persist', async ({ page }) => {
  await open(page);
  await input(page).press('Escape');
  await expect(page.locator('body')).not.toHaveClass(/\bagent-open\b/);
  await page.keyboard.press('ControlOrMeta+/');
  await expect(page.locator('body')).toHaveClass(/\bagent-open\b/);
  await expect(input(page)).toBeFocused();
  await input(page).fill('draft');
  await input(page).press('Escape');
  await expect(page.locator('body')).toHaveClass(/\bagent-open\b/);
  await input(page).fill('');
  await page.locator('.agent-icon-btn[title^="Panel width"]').click();
  expect(await page.evaluate(() => localStorage.getItem('finsight-agent-w'))).toBe('560');
  await page.locator('.agent-resize').dblclick();
  expect(await page.evaluate(() => localStorage.getItem('finsight-agent-w'))).toBe('440');
  await page.locator('.agent-resize').focus();
  await page.keyboard.press('ArrowLeft');
  expect(await page.evaluate(() => localStorage.getItem('finsight-agent-w'))).toBe('460');
});

test('dock mode: collapse persists across reload, height keys, the dock is a draggable panel', async ({ page }) => {
  await open(page);
  await page.locator('.agent-icon-btn[title="Dock into the terminal"]').click();
  const dock = page.locator('#agent-dock');
  await expect(dock).toBeVisible();
  await expect(dock).toHaveAttribute('data-pid', 'kestrel');
  await expect(dock.locator('.panel-head .drag-grip')).toHaveCount(1);
  await expect(page.locator('body')).not.toHaveClass(/\bagent-open\b/);
  await dock.locator('.agent-icon-btn[title="Collapse"]').click();
  await expect(dock).toHaveClass(/\bcollapsed\b/);
  await page.reload();
  await expect(page.locator('#agent-dock')).toHaveClass(/\bcollapsed\b/);
  await page.locator('#agent-dock .agent-icon-btn[title="Expand"]').click();
  await expect(page.locator('#agent-dock')).not.toHaveClass(/\bcollapsed\b/);
  await page.locator('.agent-dock-resize').focus();
  await page.keyboard.press('ArrowDown');
  expect(await page.evaluate(() => localStorage.getItem('finsight-agent-dock-h'))).toBe('600');
  await page.locator('.agent-dock-resize').dblclick();
  await page.locator('.agent-icon-btn[title="Pop out to the side panel"]').click();
  await expect(page.locator('body')).toHaveClass(/\bagent-open\b/);
  await expect(page.locator('#agent-dock')).toBeHidden();
});

test('a turn that fails before the send request returns does not leave the chat running', async ({ page }) => {
  // intended fix (G): legacy agent-panel.js marked such a turn running after the reply and stayed on ■.
  await open(page);
  await send(page, 'quickfail now');
  await expect(lastTurn(page).locator('.agent-notice.error')).toHaveText('model exploded');
  await page.waitForTimeout(600);
  await expect(page.locator('.agent-send:visible')).toHaveAttribute('aria-label', 'Send');
  await expect(page.locator('.agent-status')).toHaveCount(0);
});
