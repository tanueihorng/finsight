import { test } from 'node:test';
import assert from 'node:assert/strict';
import { inflClass, INFL_GAUGES } from './macro.ts';
test('inflation thresholds and gauge definitions preserve legacy values', () => {
  assert.equal(inflClass(2), 'up'); assert.equal(inflClass(2.5), 'warn'); assert.equal(inflClass(3.1), 'down');
  assert.equal(INFL_GAUGES.length, 7); assert.equal(INFL_GAUGES[0]?.t, 'pc1');
});
