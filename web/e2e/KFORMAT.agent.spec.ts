import { test, expect, type Page } from '@playwright/test';
import { replySettings, seeded } from './helpers';
async function open(p: Page) {
  await seeded(p);
  await p.evaluate(() => { localStorage.setItem('finsight-agent-mode', 'side'); localStorage.removeItem('finsight-agent-thread'); });
  await p.reload(); await p.click('#agent-toggle'); await expect(p.getByRole('textbox', { name: 'Message', exact: true })).toBeVisible();
}
test('nested bold and italic render in a streamed answer and the same saved answer after reload', async ({ page }) => {
  await open(page);
  const input = page.getByRole('textbox', { name: 'Message', exact: true }); await input.fill('nestedmarkdown'); await input.press('Enter');
  const strong = page.locator('.agent-text strong');
  await expect(strong).toHaveText('"Hottest" splits into two answers right now: Friday\'s hottest move was cybersecurity.');
  await expect(strong.locator('em')).toHaveText('move');
  await expect(page.locator('.agent-text code')).toHaveText('**literal** *code*');
  await expect(page.locator('.agent-send:visible')).toHaveAttribute('aria-label', 'Send');
  await page.reload(); await page.getByRole('button', { name: 'Show chats', exact: true }).click();
  await page.locator('.agent-thread-open:visible').filter({ hasText: 'nestedmarkdown' }).first().click();
  await expect(strong.locator('em')).toHaveText('move');
  await expect(strong).not.toContainText('**');
});
test('an enabled model exposes the views label and table starter', async ({ page }) => {
  await page.route('**/api/agent/brains', (r) => r.fulfill({ json: { default: 'fake', brains: [{ id: 'fake', label: 'Fake model', costTier: '$', available: true, ui: true }] } }));
  await open(page);
  await replySettings(page);
  await expect(page.getByRole('combobox', { name: 'Model', exact: true }).locator('option:checked')).toHaveText('Fake model $ · views');
  const starter = page.getByRole('button', { name: 'Show my holdings as a table', exact: true }); await expect(starter).toBeVisible();
  await starter.click(); await expect(page.locator('.agent-user:visible').last()).toContainText('Show my holdings as a table');
});
