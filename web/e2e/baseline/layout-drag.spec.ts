import { test, expect } from '@playwright/test';
import { unlock, dragPanel } from '../helpers';

test('dragging a panel to the other column persists after reload', async ({ page }) => {
  await unlock(page);
  await expect(page.locator('.col-right > .panel[data-pid="markets"]')).toHaveCount(1);
  await dragPanel(page, 'markets', '.col-left');
  await expect(page.locator('.col-left > .panel[data-pid="markets"]')).toHaveCount(1);
  const order = () => page.locator('.col-left > .panel.draggable-block').evaluateAll((ps) => ps.map((p) => (p as HTMLElement).dataset.pid));
  const before = await order();
  await page.reload();
  await expect(page.locator('body')).not.toHaveClass(/\blocked\b/);
  await expect(page.locator('.col-left > .panel[data-pid="markets"]')).toHaveCount(1);
  expect(await order()).toEqual(before);
  await expect(page.locator('.panel[data-pid="markets"]')).toHaveCount(1);
});
