import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayChange, emptyForm, fillText, formOrder, limitsBody, limitsText, orderLabel, usd, type PaperOrder } from './paper.ts';

test('order labels and fills read as the panel shows them', () => {
  assert.equal(orderLabel({ side: 'buy', symbol: 'NVDA', type: 'market', qty: 4, notional: null, limitPrice: null, tif: 'day' }), 'BUY 4 NVDA · market · day');
  assert.equal(orderLabel({ side: 'sell', symbol: 'AAPL', type: 'limit', qty: 0.5, notional: null, limitPrice: 230, tif: 'day' }), 'SELL 0.5 AAPL · limit 230.00 · day');
  assert.equal(orderLabel({ side: 'buy', symbol: 'VOO', type: 'market', qty: null, notional: 500, limitPrice: null, tif: 'day' }), 'BUY US$500.00 VOO · market · day');
  const o = { filledQty: 3, filledAvgPrice: 468.2, status: 'filled' } as PaperOrder;
  assert.equal(fillText(o), '3 @ 468.20');
  assert.equal(fillText({ ...o, filledQty: 0, status: 'partially_filled' }), 'partially filled');
  assert.equal(usd(null), '—');
});

test('the ticket form becomes an order body or the first problem', () => {
  const f = { ...emptyForm('aapl'), amount: '10' };
  assert.deepEqual(formOrder(f), { body: { symbol: 'AAPL', side: 'buy', type: 'market', tif: 'day', qty: 10 } });
  assert.deepEqual(formOrder({ ...f, sizeBy: 'usd', amount: '250' }), { body: { symbol: 'AAPL', side: 'buy', type: 'market', tif: 'day', notional: 250 } });
  assert.deepEqual(formOrder({ ...f, type: 'limit', limitPrice: '199.5', tif: 'gtc' }), { body: { symbol: 'AAPL', side: 'buy', type: 'limit', tif: 'gtc', qty: 10, limitPrice: 199.5 } });
  assert.deepEqual(formOrder({ ...f, symbol: ' ' }), { error: 'Enter a US ticker' });
  assert.deepEqual(formOrder({ ...f, type: 'limit' }), { error: 'Enter a limit price' });
  assert.deepEqual(formOrder({ ...f, amount: '0.5', tif: 'gtc' }), { error: 'Fractional and USD-amount orders must be day orders' });
  assert.deepEqual(formOrder({ ...f, sizeBy: 'usd', type: 'limit', limitPrice: '1' }), { error: 'A USD amount works with market orders only' });
});

test('limits: empty means none; the summary lists what is set', () => {
  assert.deepEqual(limitsBody({ maxOrderUsd: '1000', maxOrdersPerDay: '', maxPositionPct: ' 10 ', symbols: '' }), { maxOrderUsd: 1000, maxOrdersPerDay: null, maxPositionPct: 10, symbols: null });
  assert.equal(limitsText({ maxOrderUsd: null, maxOrdersPerDay: null, maxPositionPct: null, symbols: null }), 'no limits');
  assert.equal(limitsText({ maxOrderUsd: 1000, maxOrdersPerDay: 3, maxPositionPct: null, symbols: ['AAPL'] }), '≤ US$1,000.00 per order · ≤ 3 orders a day · only AAPL');
  assert.deepEqual(dayChange({ number: 'x', status: 'ACTIVE', cash: 0, equity: 101000, buyingPower: 0, lastEquity: 100000 }), { abs: 1000, pct: 1 });
  assert.equal(dayChange(null), null);
});
