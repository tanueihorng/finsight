// H3 accessibility pass. axe scans the main views plus keyboard behaviour
// (Tab reachability, Escape close + focus return, modal focus trap).
// Discovery mode: H3_DUMP=<file> writes every violation as JSON lines.
import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import fs from 'node:fs';
import { ensurePin, seeded } from './helpers';

const DUMP = process.env.H3_DUMP;
const SERIOUS = new Set(['serious', 'critical']);
export async function scan(page: Page, name: string) {
  const r = await new AxeBuilder({ page }).analyze();
  const v = r.violations.map((x) => ({ id: x.id, impact: x.impact, help: x.help, n: x.nodes.length,
    nodes: x.nodes.map((n) => ({ t: n.target.join(' '), s: n.failureSummary, h: n.html })) }));
  if (DUMP) fs.appendFileSync(DUMP, JSON.stringify({ name, v }) + '\n');
  const bad = v.filter((x) => SERIOUS.has(String(x.impact)));
  expect(bad, name + ' has serious/critical violations: ' + JSON.stringify(bad)).toEqual([]);
  return v;
}

test('axe: dashboard', async ({ page }) => { await seeded(page); await scan(page, 'dashboard'); });
for (const theme of ['amber', 'teal', 'phosphor']) {
  test('axe: theme ' + theme, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('finsight-theme', t), theme);
    await seeded(page); await scan(page, 'theme-' + theme);
  });
}
test('axe: lock', async ({ page, context }) => {
  await ensurePin(page.request); await context.clearCookies(); await page.goto('/');
  await expect(page.locator('#lock-pin')).toBeVisible(); await scan(page, 'lock');
});
test.describe('narrow', () => {
  test.use({ viewport: { width: 390, height: 844 } });
  test('axe: narrow', async ({ page }) => { await seeded(page); await scan(page, 'narrow'); });
});
test('axe: modals', async ({ page }) => {
  await seeded(page);
  await page.click('#add-toggle'); await expect(page.locator('#trade-sheet')).toHaveAttribute('aria-hidden', 'false'); await scan(page, 'add');
  await page.locator('#trade-sheet [aria-label="Close"]').click();
  await page.click('#cash-btn'); await expect(page.locator('#cash-modal')).toBeVisible();
  await page.locator('#cash-editor .cash-add').first().click();
  await expect(page.locator('#cash-modal .cash-amt').first()).toBeVisible(); await scan(page, 'cash');
  await page.click('#cash-save'); await expect(page.locator('#cash-modal')).toBeHidden();
  await page.click('#import-btn'); await expect(page.locator('#import-modal')).toBeVisible(); await scan(page, 'import');
  await page.click('#import-close');
});
test('axe: kestrel', async ({ page }) => {
  await seeded(page);
  await page.click('#agent-toggle'); await expect(page.locator('.agent-offline').first()).toBeVisible(); await scan(page, 'kestrel-side');
  await page.getByRole('button', { name: 'Dock into the terminal' }).click();
  await expect(page.locator('#agent-dock')).toBeVisible(); await scan(page, 'kestrel-dock');
});
test('axe: chart max', async ({ page }) => {
  await seeded(page);
  await page.locator('#detail-panel [title^="Expand chart"]').first().click();
  await expect(page.locator('.chart-max')).toBeVisible(); await scan(page, 'chart-max');
});

for (const [name, opener, dialog] of [
  ['cash', '#cash-btn', '#cash-modal'], ['import', '#import-btn', '#import-modal'],
  ['layout', '#cards-btn', '#cards-modal'], ['profile', '#profile-btn', '#setup-modal'],
  ['ledger', '#ledger-btn', '#ledger-modal'],
] as const) {
  test(`keyboard: ${name} traps focus, Escape closes and returns focus`, async ({ page }) => {
    await seeded(page);
    await page.locator(opener).focus(); await page.keyboard.press('Enter');
    const box = page.locator(`${dialog} [role="dialog"]`);
    await expect(box).toBeVisible();
    await expect(page.locator('#cmd')).toBeDisabled();
    await expect.poll(() => box.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    const controls = box.locator('button:visible:not(:disabled), input:visible:not(:disabled), select:visible:not(:disabled), textarea:visible:not(:disabled)');
    const first = controls.first(), last = controls.last();
    await first.focus(); await page.keyboard.press('Shift+Tab'); await expect(last).toBeFocused();
    await page.keyboard.press('Tab'); await expect(first).toBeFocused();
    // Programmatic focus also cannot escape to protected/background controls.
    await page.locator('#cmd').evaluate((el) => (el as HTMLElement).focus());
    await expect.poll(() => box.evaluate((el) => el.contains(document.activeElement))).toBe(true);
    await page.keyboard.press('Escape'); await expect(page.locator(dialog)).toBeHidden(); await expect(page.locator(opener)).toBeFocused();
  });
}

test('keyboard: accounts dialog returns focus to the account selector', async ({ page }) => {
  await seeded(page);
  await page.locator('#account-sel').focus(); await page.selectOption('#account-sel', '__manage');
  await expect(page.locator('#accounts-modal [role="dialog"]')).toBeVisible();
  await page.keyboard.press('Escape'); await expect(page.locator('#accounts-modal')).toBeHidden();
  await expect(page.locator('#account-sel')).toBeFocused();
});

test('keyboard: inline Add disclosure and symbol suggestions', async ({ page }) => {
  await seeded(page); await page.locator('#add-toggle').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('#trade-symbol')).toBeFocused();
  await page.locator('#trade-symbol').fill('AA');
  await expect(page.locator('#trade-suggest [role="option"]').first()).toBeVisible();
  await page.keyboard.press('ArrowDown');
  await expect(page.locator('#trade-symbol')).toHaveAttribute('aria-activedescendant', 'trade-option-0');
  await page.keyboard.press('Enter'); await expect(page.locator('#trade-qty')).toBeFocused();
  await page.keyboard.press('Escape'); await expect(page.locator('#trade-sheet')).toHaveAttribute('aria-hidden', 'true'); await expect(page.locator('#add-toggle')).toBeFocused();
});

test('keyboard: all visible dashboard controls are in the Tab cycle', async ({ page }) => {
  await seeded(page); await page.waitForLoadState('networkidle');
  const expected = await page.evaluate(() => {
    const elements = [...document.querySelectorAll<HTMLElement>('button, input, select, textarea, a[href], [tabindex]')]
      .filter((el) => el.tabIndex >= 0 && !el.matches(':disabled') && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden');
    elements.forEach((el, i) => el.dataset.h3Focus = String(i));
    (document.activeElement as HTMLElement)?.blur();
    return elements.map((el) => ({ id: el.dataset.h3Focus!, label: el.id || el.getAttribute('aria-label') || el.textContent?.slice(0, 60) }));
  });
  const seen = new Set<string>();
  for (let i = 0; i < expected.length * 3 && seen.size < expected.length; i++) {
    await page.keyboard.press('Tab');
    const id = await page.evaluate(() => (document.activeElement as HTMLElement)?.dataset.h3Focus);
    if (id) seen.add(id);
  }
  expect(expected.filter((el) => !seen.has(el.id))).toEqual([]);
});

test('keyboard: row selection, sorting and panel rearrangement preserve actions', async ({ page }) => {
  await seeded(page);
  const row = page.locator('#markets [data-sym="^GSPC"]');
  await row.focus(); await page.keyboard.press('Enter'); await expect(page.locator('.detail-sym')).toHaveText('^GSPC');
  const sort = page.locator('#pos-head [data-sort="quantity"]');
  await sort.focus(); await page.keyboard.press('Space'); await expect(sort).not.toHaveAttribute('aria-sort', 'none');
  const grip = page.locator('[data-pid="positions"] .drag-grip');
  await grip.focus(); await page.keyboard.press('ArrowRight');
  await expect(page.locator('.col-right [data-pid="positions"]')).toBeVisible();
  await expect(grip).toBeFocused();
  await expect(grip).toBeInViewport();
  await page.reload(); await expect(page.locator('.col-right [data-pid="positions"]')).toBeVisible();
});

for (const theme of ['violet', 'amber', 'teal', 'phosphor']) {
  test(`keyboard: visible focus ring in ${theme}`, async ({ page }) => {
    await page.addInitScript((t) => localStorage.setItem('finsight-theme', t), theme);
    await seeded(page); await page.locator('#cmd').focus(); await page.keyboard.press('Tab');
    const ring = await page.locator('#cmd-go').evaluate((el) => {
      const css = getComputedStyle(el); return { style: css.outlineStyle, width: css.outlineWidth, color: css.outlineColor };
    });
    expect(ring.style).toBe('solid'); expect(parseFloat(ring.width)).toBeGreaterThanOrEqual(2); expect(ring.color).not.toBe('rgba(0, 0, 0, 0)');
  });
}

for (const [name, opener] of [['layout', '#cards-btn'], ['profile', '#profile-btn'], ['ledger', '#ledger-btn']] as const) {
  test(`axe: ${name} dialog`, async ({ page }) => {
    await seeded(page); await page.click(opener); await scan(page, name);
  });
}
test('axe: accounts dialog', async ({ page }) => {
  await seeded(page); await page.selectOption('#account-sel', '__manage'); await scan(page, 'accounts');
});
test('keyboard: heatmap and allocation provide keyboard symbol selection', async ({ page }) => {
  await seeded(page);
  await page.locator('.hm-tile[data-sym="AAPL"]').focus(); await page.keyboard.press('Enter');
  await expect(page.locator('.detail-sym')).toHaveText('AAPL');
  await page.locator('.donut-legend [data-sym="NVDA"]').focus(); await page.keyboard.press('Space');
  await expect(page.locator('.detail-sym')).toHaveText('NVDA');
});
test('keyboard: an open dialog never intercepts a PIN after session expiry', async ({ page }) => {
  await seeded(page); await page.click('#import-btn');
  await page.evaluate(() => { window.FinSight.auth.lock(); });
  await expect(page.locator('#lock-pin')).toBeVisible(); await page.locator('#lock-pin').fill('24');
  await page.keyboard.press('Tab');
  await expect(page.locator('#lock-pin')).toHaveValue('24');
  expect(await page.evaluate(() => !!document.activeElement?.closest('#lock-screen'))).toBe(true);
});

test('keyboard: rings survive cash and chart input outline resets', async ({ page }) => {
  await seeded(page); await page.click('#cash-btn'); await page.locator('.cash-add').first().click();
  await page.locator('.cash-ccy').first().focus(); await page.keyboard.press('Tab');
  for (const selector of ['.cash-amt']) {
    await expect.poll(() => page.locator(selector).first().evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
  }
  await page.keyboard.press('Escape');
  await page.locator('#detail-panel .pc-sym').focus(); await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  expect(await page.locator('#detail-panel .pc-sym').evaluate((el) => getComputedStyle(el).outlineStyle)).toBe('solid');
});
