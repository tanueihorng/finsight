import test from 'node:test';
import assert from 'node:assert/strict';
import { previewSandbox, type DraftTrade, type SandboxSnapshot } from '../shared/sandbox.ts';

const snap: SandboxSnapshot = {
  account: 'main', name: 'Main', book: 'real', currency: 'USD', capturedAt: 100, cash: 25, otherCash: [],
  instruments: [
    { symbol: 'OLD', quantity: 10, currency: 'USD', price: 10, marketTime: 100, stale: false, exclusion: null },
    { symbol: 'NEW', quantity: 0, currency: 'USD', price: 20, marketTime: 100, stale: false, exclusion: null },
    { symbol: 'FOREIGN', quantity: 2, currency: 'SGD', price: 5, marketTime: 100, stale: false, exclusion: 'Outside this currency.' },
    { symbol: 'NOQUOTE', quantity: 3, currency: 'USD', price: null, marketTime: null, stale: true, exclusion: null },
  ],
};
const sell: DraftTrade = { side: 'sell', symbol: 'OLD', quantity: 5, price: null, fee: 1 };
const buy: DraftTrade = { side: 'buy', symbol: 'NEW', quantity: 3, price: null, fee: 2 };

test('sell proceeds fund the next buy; values and fees reconcile on pinned marks', () => {
  const original = structuredClone(snap);
  const preview = previewSandbox(snap, [sell, buy], snap.cash);
  assert.equal(preview.error, null);
  assert.equal(preview.before.pricedValue, 100);
  assert.equal(preview.before.unpriced, 1);
  assert.deepEqual(preview.result?.after.rows.map((row) => [row.symbol, row.quantity, row.value]), [
    ['NEW', 3, 60], ['OLD', 5, 50], ['NOQUOTE', 3, null],
  ]);
  assert.equal(preview.result?.cash, 12);
  assert.equal(preview.result?.fees, 3);
  assert.equal(preview.result?.after.largest?.weight, 60 / 110);
  assert.equal(preview.result!.cash + preview.result!.after.pricedValue!, 125 - 3);
  assert.deepEqual(snap, original);
});

test('blocks oversells, unavailable funding or instruments, and missing prices at the affected step', () => {
  const cases: [DraftTrade[], number | null, number | null, RegExp][] = [
    [[buy, sell], 25, 0, /Insufficient cash/],
    [[sell, { ...sell, quantity: 6 }], 25, 1, /Oversell/],
    [[{ ...buy, symbol: 'OTHER' }], 25, 0, /Pin a snapshot/],
    [[{ ...buy, symbol: 'FOREIGN' }], 25, 0, /Outside this currency/],
    [[{ ...buy, symbol: 'NOQUOTE' }], 25, 0, /available snapshot quote/],
    [[{ ...buy, quantity: 1e200, price: 1e200 }], 25, 0, /too large/],
    [[buy], null, null, /opening cash/],
  ];
  for (const [trades, cash, row, expected] of cases) {
    const preview = previewSandbox(snap, trades, cash);
    assert.equal(preview.row, row);
    assert.equal(preview.result, null);
    assert.match(preview.error!, expected);
  }
});

test('assumed execution price changes cash while valuation keeps the pinned mark', () => {
  const result = previewSandbox(snap, [{ ...buy, quantity: 1, price: 15, fee: 0 }], 15).result;
  assert.equal(result?.cash, 0);
  assert.equal(result?.after.rows.find((p) => p.symbol === 'NEW')?.value, 20);
});
