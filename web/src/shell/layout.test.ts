import test from 'node:test';
import assert from 'node:assert/strict';
import { applySaved, DEFAULT_COLUMNS, dropBefore, movePanel, parseHidden, parseLayout } from './layout.ts';

test('saved layout applies like legacy applyLayout', () => {
  assert.deepEqual(applySaved(DEFAULT_COLUMNS, null), DEFAULT_COLUMNS);
  const c = applySaved(DEFAULT_COLUMNS, { left: ['news', 'positions'], right: ['wealth', 'ghost'] });
  assert.deepEqual(c.left.slice(-2), ['news', 'positions']); // saved pids move to the end, in order
  assert.ok(!c.right.includes('news'));
  assert.equal(c.right.at(-1), 'wealth');
  assert.ok(!c.left.includes('wealth'));
  assert.ok(!c.right.includes('ghost'));
  assert.equal(c.left.length + c.right.length, DEFAULT_COLUMNS.left.length + DEFAULT_COLUMNS.right.length);
});

test('moving, dropping and parsing', () => {
  const m = movePanel(DEFAULT_COLUMNS, 'news', 'left', 'positions');
  assert.equal(m.left[0], 'news');
  assert.ok(!m.right.includes('news'));
  assert.equal(movePanel(DEFAULT_COLUMNS, 'news', 'left', null).left.at(-1), 'news');
  const items = [{ el: 'a', top: 0, height: 100 }, { el: 'b', top: 100, height: 100 }];
  assert.deepEqual([dropBefore(items, 10), dropBefore(items, 160), dropBefore(items, 199)], ['a', null, null]);
  assert.equal(dropBefore(items, 120), 'b');
  assert.deepEqual(parseHidden('["news",3]'), ['news']);
  assert.equal(parseLayout('{bad'), null);
});
