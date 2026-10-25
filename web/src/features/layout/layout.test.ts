import test from 'node:test';
import assert from 'node:assert/strict';
import { dropBefore, parseHidden, parseLayout } from './layout.ts';

test('saved layout/hidden parsing and the drop position match legacy', () => {
  assert.deepEqual(parseHidden('["news",3,"fxrisk"]'), ['news', 'fxrisk']);
  assert.deepEqual(parseHidden('{bad'), []);
  assert.deepEqual(parseHidden(null), []);
  assert.deepEqual(parseLayout('{"left":["a"],"right":["b"]}'), { left: ['a'], right: ['b'] });
  assert.equal(parseLayout('null'), null);
  assert.equal(parseLayout('{bad'), null);
  const items = [{ el: 'a', top: 0, height: 100 }, { el: 'b', top: 100, height: 100 }, { el: 'c', top: 200, height: 100 }];
  assert.equal(dropBefore(items, 10), 'a');     // above a's middle
  assert.equal(dropBefore(items, 120), 'b');
  assert.equal(dropBefore(items, 160), 'c');    // past b's middle
  assert.equal(dropBefore(items, 290), null);   // past the last: append
});
