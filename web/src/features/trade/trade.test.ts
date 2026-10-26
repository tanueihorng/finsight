import test from 'node:test';
import assert from 'node:assert/strict';
import { booksFor, previewBuy, previewSell, sellQty, tradeError, undoLabel } from './trade.ts';
import type { Position } from '../../../../shared/types.ts';

test('buy preview blends the average cost', () => {
  const r = previewBuy(15, 156, 1, 232.5);
  assert.equal(r.cost, 232.5);
  assert.equal(r.after, 16);
  assert.ok(Math.abs(r.newAvg - (15 * 156 + 232.5) / 16) < 1e-9);
  assert.equal(previewBuy(0, 0, 2, 10).newAvg, 10);
});

test('sell preview realizes against the average cost', () => {
  const r = previewSell(15, 156, 5, 232.5);
  assert.equal(r.proceeds, 1162.5);
  assert.equal(r.realized, 382.5);
  assert.ok(Math.abs(r.realizedPct - 49.0384615) < 1e-6);
  assert.equal(r.after, 10);
  assert.equal(previewSell(5, 0, 5, 1).realizedPct, 0); // free shares: no division by zero
});

test('sell quick picks: whole shares round down, All is exact', () => {
  assert.equal(sellQty(15, 0.25), 3);
  assert.equal(sellQty(15, 0.5), 7);
  assert.equal(sellQty(1, 0.25), 1);
  assert.equal(sellQty(15, 1), 15);
  assert.equal(sellQty(2.5, 0.5), 1.25);
  assert.equal(sellQty(0.123456, 1), 0.123456);
});

test('trade validation', () => {
  assert.match(tradeError('buy', 0, 10, 0, '', '2026-10-26')!, /share count/);
  assert.match(tradeError('buy', 1, NaN, 0, '', '2026-10-26')!, /price/);
  assert.match(tradeError('sell', 16, 10, 15, '', '2026-10-26')!, /only hold 15/);
  assert.match(tradeError('buy', 1, 10, 0, '2026-10-27', '2026-10-26')!, /future/);
  assert.equal(tradeError('sell', 15, 10, 15, '2026-10-01', '2026-10-26'), null);
});

test('books: one account view trades there; All Accounts lists each holder', () => {
  const p = { symbol: 'AAPL', quantity: 20, avgCost: 150, holdings: [
    { accountId: 'main', account: 'Main', quantity: 15, avgCost: 156 }, { accountId: 'ibkr', account: 'IBKR', quantity: 5, avgCost: 132 }] } as Position;
  assert.deepEqual(booksFor(p, 'main', 'Main'), [{ accountId: 'main', account: 'Main', quantity: 20, avgCost: 150 }]);
  assert.deepEqual(booksFor(p, 'ALL', 'All').map((b) => b.accountId), ['main', 'ibkr']);
  assert.deepEqual(booksFor(undefined, 'main', 'Main'), []);
});

test('undo label matches lib/portfolio.ts', () => {
  assert.equal(undoLabel('buy', 1, 'AAPL'), 'Buy 1 AAPL');
  assert.equal(undoLabel('sell', 0.5, 'BTC-USD'), 'Sell 0.5 BTC-USD');
});
