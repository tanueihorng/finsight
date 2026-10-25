import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Alert } from '../../../../shared/types.ts';
import { createTriggerTracker } from './triggers.ts';
const alert = (id: string, met: boolean): Alert => ({ id, met, symbol: 'NVDA', op: '>', kind: 'price', price: 100, createdAt: 1, triggeredAt: met ? 2 : null, label: 'NVDA ≥ 100', currentPrice: 182, currentValue: 182, level: 100 });
test('existing triggers seed silently; newly triggered ids fire once including re-arms', () => {
  const track = createTriggerTracker(); assert.deepEqual(track([alert('old', true), alert('new', false)]), []);
  assert.deepEqual(track([alert('old', true), alert('new', true)]).map((a) => a.id), ['new']);
  assert.deepEqual(track([alert('new', true)]), []); assert.deepEqual(track([alert('new', false)]), []); assert.deepEqual(track([alert('new', true)]), []);
});
