// Colocated logic tests run under `npm test` (node:test, Node strips the types).
// Import with explicit .ts extensions; keep these files free of CSS/DOM imports.
import test from 'node:test';
import assert from 'node:assert/strict';

test('colocated web/src tests are discovered', () => {
  assert.equal(typeof structuredClone, 'function');
});
