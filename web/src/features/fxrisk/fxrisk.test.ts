import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shock, targetExposure, conversion } from './fxrisk.ts';
test('FX shocks apply only to foreign exposure and work in either direction', () => {
  assert.deepEqual(shock(2000, 15), { impact: 300, value: 2300 });
  assert.deepEqual(shock(2000, -15), { impact: -300, value: 1700 });
  assert.deepEqual(shock(0, 15), { impact: 0, value: 0 });
});
test('target exposure uses whole-book denominator and strict half-percent tolerance', () => {
  assert.deepEqual(targetExposure(10000, 6000, '70'), { current: 60, pct: 70, gap: 1000, onTarget: false });
  assert.equal(targetExposure(10000, 6000, '50').gap, -1000);
  assert.equal(targetExposure(10000, 6000, '60.49').onTarget, true);
  assert.equal(targetExposure(10000, 6000, '60.5').onTarget, false);
  assert.equal(targetExposure(0, 0, '70').gap, null);
  assert.equal(targetExposure(10000, 6000, '').gap, null);
});
test('conversion divides by base-per-foreign rate and uses an inverse monthly log band', () => {
  assert.equal(conversion('', 1.29, 1), null); assert.equal(conversion('0', 1.29, 1), null);
  assert.deepEqual(conversion('1290', 1.29, 0), { now: 1000, band: null });
  const c = conversion('1290', 1.29, 1)!, b = c.band!;
  assert.equal(c.now, 1000);
  assert.ok(Math.abs(b.lo * b.hi - 1.29 ** 2) < 1e-12);
  assert.ok(b.min < c.now && b.max > c.now);
  assert.ok(Math.abs(b.min * b.max - c.now ** 2) < 1e-8);
  assert.equal(conversion('2580', 1.29, 1)!.band!.min, b.min * 2);
  assert.equal(b.spread, c.now - b.min);
});
