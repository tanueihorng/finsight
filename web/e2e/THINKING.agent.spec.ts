import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { seeded } from './helpers';

async function setup(page: Page, narrow = false) {
  if (narrow) await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/agent/brains', (route) => route.fulfill({ json: { default: 'deepseek-flash', brains: [
    { id: 'deepseek-flash', label: 'DeepSeek Flash', available: true, costTier: '$', thinking: { levels: ['none', 'low', 'high', 'max'], default: 'high' } },
    { id: 'gpt-6-luna', label: 'GPT-6 Luna', available: true, costTier: '$', thinking: { levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], default: 'none' } },
    { id: 'gpt-6-sol', label: 'GPT-6 Sol', available: true, costTier: '$$', thinking: { levels: ['none', 'low', 'medium', 'high', 'xhigh', 'max'], default: 'none' } },
    { id: 'fake', label: 'Fake model', available: true, costTier: '$' },
  ] } }));
  await seeded(page);
  await page.evaluate(() => { localStorage.setItem('finsight-agent-mode', 'side'); localStorage.setItem('finsight-agent-brain', 'deepseek-flash'); });
  await page.reload(); await page.click('#agent-toggle');
  await expect(page.locator('.agent-input:visible')).toBeVisible();
}
const slider = (p: Page) => p.getByRole('slider', { name: 'Thinking effort' });
const model = (p: Page) => p.getByRole('combobox', { name: 'Model', exact: true });

test('effort slider uses model levels, remembers each model across reloads, submits selected effort and hides for unsupported models', async ({ page }) => {
  await setup(page);
  await expect(slider(page)).toHaveAttribute('aria-valuetext', 'high');
  await slider(page).focus(); await slider(page).press('Home'); await expect(slider(page)).toHaveAttribute('aria-valuetext', 'Off');
  await slider(page).press('ArrowRight'); await expect(slider(page)).toHaveAttribute('aria-valuetext', 'low');
  await model(page).selectOption('gpt-6-luna'); await expect(slider(page)).toHaveAttribute('aria-valuetext', 'Off');
  await slider(page).focus(); await slider(page).press('End'); await slider(page).press('ArrowLeft');
  await expect(slider(page)).toHaveAttribute('aria-valuetext', 'Extra high');
  const sent = page.waitForRequest((r) => r.method() === 'POST' && /\/messages$/.test(new URL(r.url()).pathname));
  await page.locator('.agent-input:visible').fill('tools'); await page.locator('.agent-input:visible').press('Enter');
  const body = (await sent).postDataJSON(); expect(body.brain).toBe('gpt-6-luna'); expect(body.effort).toBe('xhigh');
  await expect(slider(page)).toBeDisabled();
  await expect(page.locator('.agent-turn:visible').last().locator('.agent-meta')).toBeVisible();
  await expect(slider(page)).toBeEnabled();
  await model(page).selectOption('deepseek-flash'); await expect(slider(page)).toHaveAttribute('aria-valuetext', 'low');
  await model(page).selectOption('gpt-6-sol'); await expect(slider(page)).toHaveAttribute('aria-valuetext', 'Off');
  await model(page).selectOption('gpt-6-luna'); await expect(slider(page)).toHaveAttribute('aria-valuetext', 'Extra high');
  await page.reload(); await expect(slider(page)).toBeVisible(); await expect(slider(page)).toHaveAttribute('aria-valuetext', 'Extra high');
  await model(page).selectOption('fake'); await expect(slider(page)).toHaveCount(0);
});

test('narrow panel slider is accessible, fits its container and sends DeepSeek off without remapping it', async ({ page }) => {
  await setup(page, true);
  await slider(page).focus(); await slider(page).press('Home');
  const sent = page.waitForRequest((r) => r.method() === 'POST' && /\/messages$/.test(new URL(r.url()).pathname));
  await page.locator('.agent-input:visible').fill('hello'); await page.locator('.agent-input:visible').press('Enter');
  expect((await sent).postDataJSON().effort).toBe('none');
  await expect(slider(page)).toBeEnabled();
  const fits = await slider(page).evaluate((el) => { const a = el.getBoundingClientRect(), b = el.parentElement!.getBoundingClientRect(); return a.left >= b.left && a.right <= b.right + 1; });
  expect(fits).toBe(true);
  const a11y = await new AxeBuilder({ page }).include('.kx-thinking').analyze(); expect(a11y.violations).toEqual([]);
  await page.screenshot({ path: '/Users/tanueihorng/Desktop/investment/harness/runs/20261026T124149Z-KEFFORT-001-9b791a56/thinking-narrow.png' });
});
