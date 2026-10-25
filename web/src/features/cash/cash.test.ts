import test from 'node:test';
import assert from 'node:assert/strict';
import { cashStatusText, planCashSave, undoStatusText, type CashDraft } from './cash.ts';

const draft = (rows: [string, string][], orig: Record<string, number> = {}): CashDraft =>
  ({ id: 'a', name: 'Main', orig, rows: rows.map(([ccy, amount]) => ({ ccy, amount })) });
const calls = (r: ReturnType<typeof planCashSave>) => ('calls' in r ? r.calls.map((c) => [c.ccy, c.amount]) : r.error);

test('cash save plan matches legacy saveCash', () => {
  assert.deepEqual(calls(planCashSave([draft([['usd', '5,000']])])), [['USD', 5000]]);
  assert.equal(calls(planCashSave([draft([['US', '5']])])), 'Main: currency must be a 3-letter code (e.g. SGD)');
  assert.equal(calls(planCashSave([draft([['USD', 'abc']])])), 'Main: "abc" is not a number');
  assert.deepEqual(calls(planCashSave([draft([['USD', '-']], { USD: 10 })])), []); // still typing: keep saved value
  assert.deepEqual(calls(planCashSave([draft([], { USD: 10 })])), [['USD', 0]]); // removed row clears
  assert.deepEqual(calls(planCashSave([draft([['SGD', '1'], ['SGD', '2']])])), [['SGD', 3]]); // duplicates add up
  assert.deepEqual(calls(planCashSave([draft([['USD', '10']], { USD: 10 })])), []); // unchanged
  assert.deepEqual(calls(planCashSave([draft([['', '']])])), []);
});

test('status texts', () => {
  assert.equal(cashStatusText('usd', '0'), 'Cleared USD cash');
  assert.equal(cashStatusText('usd', '5000'), 'Cash USD set to 5,000.00');
  assert.equal(undoStatusText({ undone: 'Buy AAPL', available: 2 }), 'UNDID: Buy AAPL · 2 more step(s) available');
  assert.equal(undoStatusText({ undone: 'Buy AAPL', available: 0 }), 'UNDID: Buy AAPL');
});
