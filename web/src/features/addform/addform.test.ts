import test from 'node:test';
import assert from 'node:assert/strict';
import { buyQS, buyStatus, moveIndex } from './addform.ts';

test('buy status, query string and arrow-key clamping match legacy', () => {
  assert.equal(buyStatus('AAPL', '5', '200', '2025-01-02'), 'BOUGHT 5 AAPL @ 200 on 2025-01-02');
  assert.equal(buyStatus('AMD', '2', '150', null), 'BOUGHT 2 AMD @ 150');
  assert.equal(buyQS({ base: 'SGD', account: 'a b' }), '?base=SGD&account=a%20b');
  assert.deepEqual([moveIndex(-1, 1, 2), moveIndex(1, 1, 2), moveIndex(-1, -1, 2), moveIndex(1, -1, 2)], [0, 1, 0, 0]);
});
