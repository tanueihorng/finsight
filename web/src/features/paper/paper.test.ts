import { test } from 'node:test';
import assert from 'node:assert/strict';
import { keyStats, bookSymbol, chartOrders, dayChange, emptyForm, estimate, fillText, formOrder, limitsBody, limitsText, orderLabel, quickAmount, usd, type PaperOrder } from './paper.ts';

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

test('the ticket estimate: price from the limit or last, value and buying power after', () => {
  const f = { ...emptyForm('AAPL'), amount: '10' };
  assert.deepEqual(estimate(f, 200, 5000), { price: 200, qty: 10, value: 2000, after: 3000 });
  assert.deepEqual(estimate({ ...f, type: 'limit', limitPrice: '190' }, 200, 5000), { price: 190, qty: 10, value: 1900, after: 3100 });
  assert.deepEqual(estimate({ ...f, sizeBy: 'usd', amount: '500' }, 250, 5000), { price: 250, qty: 2, value: 500, after: 4500 });
  assert.deepEqual(estimate({ ...f, side: 'sell' }, 200, 5000), { price: 200, qty: 10, value: 2000, after: 5000 });
  assert.deepEqual(estimate(f, null, 5000), { price: null, qty: null, value: null, after: null });
  assert.deepEqual(estimate({ ...f, type: 'limit' }, 200, 5000).price, null); // no limit typed: no estimate
  assert.deepEqual(estimate({ ...f, amount: '' }, 200, 5000).value, null);
});

test('quick sizes use buying power to buy and the position to sell', () => {
  const f = emptyForm('AAPL');
  assert.equal(quickAmount(f, 25, 200, 10000, 0), '12');
  assert.equal(quickAmount({ ...f, sizeBy: 'usd' }, 50, 200, 10000, 0), '5000');
  assert.equal(quickAmount({ ...f, side: 'sell' }, 50, 200, 10000, 7), '3.5');
  assert.equal(quickAmount({ ...f, side: 'sell' }, 100, 200, 10000, 0), '');
  assert.equal(quickAmount(f, 100, null, 10000, 0), '');
});

test('open limit orders become chart lines for their symbol only', () => {
  const o = { id: '1', symbol: 'BRK.B', side: 'buy', type: 'limit', tif: 'day', qty: 5, notional: null, limitPrice: 410.5, origin: 'kestrel' } as PaperOrder;
  assert.equal(bookSymbol('BRK.B'), 'BRK-B');
  assert.deepEqual(chartOrders([o, { ...o, id: '2', symbol: 'AAPL' }, { ...o, id: '3', type: 'market', limitPrice: null }], 'BRK-B'),
    [{ side: 'buy', price: 410.5, label: 'BUY LMT 5 @ 410.50 · KESTREL' }]);
});

test('key stats read from the quote and details; gaps show a dash, past earnings are dropped', () => {
  const now = Date.parse('2026-11-01T00:00:00Z');
  const stats = Object.fromEntries(keyStats({ prevClose: 180.71, dayLow: 180.7, dayHigh: 183.13, weekLow52: 120, weekHigh52: 190.5, volume: 1_160_000 },
    { marketCap: 4.43e12, trailingPE: 52.34, forwardPE: 0, dividendYield: 0.02, earningsStart: Date.parse('2026-11-19T21:00:00Z'), earningsEstimated: true }, now));
  assert.deepEqual(stats, { 'Prev close': '180.71', 'Day range': '180.70 – 183.13', '52W range': '120.00 – 190.50', Volume: '1.16M', 'Mkt cap': '4.43T', 'P/E': '52.3', 'Fwd P/E': '—', Earnings: 'Nov 19 (est.)', 'Div yield': '0.02%' });
  assert.equal(Object.fromEntries(keyStats(null, { earningsStart: Date.parse('2026-10-01') }, now)).Earnings, '—');
  assert.ok(keyStats(null, null).every(([, v]) => v === '—'));
});
