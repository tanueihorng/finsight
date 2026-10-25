import test from 'node:test';
import assert from 'node:assert/strict';
import { filterLedger, heldLabel, importStatusText, portfolioCsvRows, realizedCsvRows, typeClass } from './ledger.ts';
import type { LedgerRow, Portfolio, Realized } from '../../../../shared/types.ts';

test('ledger filter, labels and CSV rows match legacy', () => {
  const rows = [{ symbol: 'AAPL', type: 'BUY' }, { symbol: 'NVDA', type: 'SELL' }] as LedgerRow[];
  assert.deepEqual(filterLedger(rows, ' aap').map((r) => r.symbol), ['AAPL']);
  assert.deepEqual(filterLedger(rows, 'sell').map((r) => r.symbol), ['NVDA']);
  assert.equal(filterLedger(rows, '').length, 2);
  assert.deepEqual(['BUY', 'SELL', 'DELETE'].map(typeClass), ['t-buy', 't-sell', 't-del']);
  assert.deepEqual([heldLabel(null), heldLabel(30), heldLabel(400)], ['—', '30d', '1.1y']);
  assert.equal(importStatusText({ added: 1, total: 2, failed: ['X'] }), 'Imported 1/2 · failed: X');
  const rz = { base: 'SGD', rows: [{ time: Date.UTC(2025, 0, 2), symbol: 'NVDA', quantity: 10, price: 200, currency: 'USD', proceeds: 2580, cost: 1200.5, stock: 1000, fx: null, total: 1379.5, heldDays: null }] } as unknown as Realized;
  assert.deepEqual(realizedCsvRows(rz)[1], ['2025-01-02', 'NVDA', 10, 200, 'USD', '2580.00', '1200.50', '1000.00', '', '1379.50', '']);
  const pf = { base: 'SGD', positions: [{ symbol: 'AAPL', quantity: 25, avgCost: 188, currency: 'USD', last: 231.5, marketValue: 7465.875, unrealized: 2380.01 }] } as unknown as Portfolio;
  assert.deepEqual(portfolioCsvRows(pf, 'SGD'), [['symbol', 'quantity', 'avg_price', 'currency', 'last', 'market_value_sgd', 'unrealized_pnl'], ['AAPL', 25, 188, 'USD', 231.5, '7465.88', '2380.01']]);
});
