import test from 'node:test';
import assert from 'node:assert';
import { vsFair } from '../shared/valuation.ts';

test('valuation: price against the owner range', () => {
  assert.strictEqual(vsFair(100, 'USD', undefined), null);
  assert.strictEqual(vsFair(null, 'USD', { low: 1 }), null);
  assert.strictEqual(vsFair(100, 'USD', {}), null);
  const b = vsFair(80, 'USD', { low: 100, high: 150, currency: 'usd' });
  assert.ok(b && b.state === 'below'); assert.ok(b.state === 'below' && Math.abs(b.gapPct + 20) < 1e-9);
  const a = vsFair(165, 'USD', { low: 100, high: 150 }); // currency defaults to the price currency
  assert.ok(a && a.state === 'above' && Math.abs(a.gapPct - 10) < 1e-9);
  const w = vsFair(120, 'USD', { low: 100, high: 150 });
  assert.deepStrictEqual(w, { state: 'within', gapPct: 0, low: 100, high: 150, currency: 'USD' });
  // One-sided ranges work.
  assert.strictEqual(vsFair(90, 'USD', { high: 100 })?.state, 'within');
  assert.strictEqual(vsFair(110, 'USD', { low: 100 })?.state, 'within');
  // Currency mismatch is never converted.
  assert.deepStrictEqual(vsFair(100, 'USD', { low: 50, currency: 'TWD' }), { state: 'currency', currency: 'TWD', priceCurrency: 'USD' });
});
