import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { replySettings, seeded } from './helpers';

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
const effort = (p: Page) => p.getByRole('combobox', { name: 'Thinking effort', exact: true });
const menu = replySettings;
const model = (p: Page) => p.getByRole('combobox', { name: 'Model', exact: true });

test('thinking menu lists the model levels, remembers each model across reloads, submits the choice and hides for unsupported models', async ({ page }) => {
  await setup(page);
  await expect(page.locator('.kx-model-btn:visible .think')).toHaveText('High');
  await menu(page);
  await expect(effort(page)).toHaveValue('high');
  await expect(effort(page).locator('option')).toHaveText(['Off', 'Low', 'High', 'Max']);
  await expect(page.locator('.kx-think:visible')).toHaveClass(/\bon\b/);
  await effort(page).selectOption('none'); await expect(page.locator('.kx-think:visible')).not.toHaveClass(/\bon\b/);
  await effort(page).selectOption('low');
  await model(page).selectOption('gpt-6-luna'); await expect(effort(page)).toHaveValue('none');
  await expect(effort(page).locator('option')).toHaveText(['Off', 'Low', 'Medium', 'High', 'Extra high', 'Max']);
  await effort(page).selectOption('xhigh');
  const sent = page.waitForRequest((r) => r.method() === 'POST' && /\/messages$/.test(new URL(r.url()).pathname));
  await page.locator('.agent-input:visible').fill('tools'); await page.locator('.agent-input:visible').press('Enter');
  const body = (await sent).postDataJSON(); expect(body.brain).toBe('gpt-6-luna'); expect(body.effort).toBe('xhigh');
  await expect(effort(page)).toBeDisabled();
  await expect(page.locator('.agent-turn:visible').last().locator('.agent-meta')).toBeVisible();
  await expect(effort(page)).toBeEnabled();
  await model(page).selectOption('deepseek-flash'); await expect(effort(page)).toHaveValue('low');
  await model(page).selectOption('gpt-6-sol'); await expect(effort(page)).toHaveValue('none');
  await model(page).selectOption('gpt-6-luna'); await expect(effort(page)).toHaveValue('xhigh');
  await page.reload(); await menu(page); await expect(effort(page)).toBeVisible(); await expect(effort(page)).toHaveValue('xhigh');
  await model(page).selectOption('fake'); await expect(effort(page)).toHaveCount(0);
});

test('narrow panel: the thinking menu fits the composer, passes axe and sends DeepSeek off without remapping it', async ({ page }) => {
  await setup(page, true);
  await menu(page);
  await effort(page).selectOption('none');
  const sent = page.waitForRequest((r) => r.method() === 'POST' && /\/messages$/.test(new URL(r.url()).pathname));
  await page.locator('.agent-input:visible').fill('hello'); await page.locator('.agent-input:visible').press('Enter');
  expect((await sent).postDataJSON().effort).toBe('none');
  await expect(effort(page)).toBeEnabled();
  const fits = await page.locator('.kx-pop:visible').evaluate((el) => { const a = el.getBoundingClientRect(), b = el.closest('.agent-compose')!.getBoundingClientRect(); return a.left >= b.left && a.right <= b.right + 1; });
  expect(fits).toBe(true);
  const a11y = await new AxeBuilder({ page }).include('.agent-compose').analyze(); expect(a11y.violations).toEqual([]);
});
