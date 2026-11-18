// Regression tests for the ledger and import defects reproduced by the
// SWEEP-002 audit (AUDITFIX-002). Each case is the audit's synthetic example.
import { setSymbol, reset } from './helpers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as pf from '../lib/portfolio.ts';
import { loadPortfolio } from '../lib/store.ts';
import { deleteBuy } from '../lib/ledger.ts';
import { parseCsv, parseIbkrPositions, parseNumberCell } from '../lib/csv.ts';

const day = (n: number) => Date.UTC(2026, 0, n);
const main = () => loadPortfolio().accounts[0]!;

test('a failed replacement import leaves the account unchanged', async () => {
  reset();
  setSymbol('XYZ', { currency: 'USD', price: 20 });
  await pf.buy('XYZ', 2, 10);
  await pf.setCash('USD', 5);
  const before = JSON.stringify(main());
  await assert.rejects(() => pf.importCsv('symbol,quantity,price\nABCDEFGHIJKLMNOPQRSTUVWXYZ,1,2', true), /ABCDEFGHIJKLMNOPQRSTUVWXYZ/);
  assert.equal(JSON.stringify(main()), before);
});

test('a replacement import with valid rows replaces the account', async () => {
  reset();
  setSymbol('XYZ', { currency: 'USD', price: 20 });
  setSymbol('ABC', { currency: 'USD', price: 5 });
  await pf.buy('XYZ', 2, 10);
  const r = await pf.importCsv('symbol,quantity,price\nABC,3,4', true);
  assert.deepEqual(r, { added: 1, total: 1, failed: [], dividends: 0 });
  assert.deepEqual(main().positions.map((p) => [p.symbol, p.quantity]), [['ABC', 3]]);
  assert.deepEqual(main().transactions.map((t) => [t.type, t.symbol]), [['BUY', 'ABC']]);
});

test('an additive import still keeps good rows and reports the bad ones', async () => {
  reset();
  setSymbol('ABC', { currency: 'USD', price: 5 });
  const r = await pf.importCsv('symbol,quantity,price\nABC,3,4\nABCDEFGHIJKLMNOPQRSTUVWXYZ,1,2', false);
  assert.deepEqual(r, { added: 1, total: 2, failed: ['ABCDEFGHIJKLMNOPQRSTUVWXYZ'], dividends: 0 });
});

test('a backdated sale cannot use shares bought after its date', async () => {
  reset();
  setSymbol('XYZ', { currency: 'USD', price: 20 });
  await pf.buy('XYZ', 1, 10, day(1));
  await pf.buy('XYZ', 9, 100, day(20));
  const before = JSON.stringify(main());
  await assert.rejects(() => pf.sell('XYZ', 5, 20, undefined, 'USD', day(10)), /held 1 XYZ on 2026-01-10/);
  assert.equal(JSON.stringify(main()), before);
});

test('a backdated sale is costed only from the shares held on its date', async () => {
  reset();
  setSymbol('XYZ', { currency: 'USD', price: 20 });
  await pf.buy('XYZ', 2, 10, day(1));
  await pf.buy('XYZ', 9, 100, day(20));
  const { realized } = await pf.sell('XYZ', 1, 20, undefined, 'USD', day(10));
  assert.equal(realized, 10); // (20 - 10) x 1, not against the blended cost
  const tx = main().transactions.at(-1)!;
  assert.deepEqual(tx.lotsSold!.map((l) => [new Date(l.t!).toISOString().slice(0, 10), l.q]), [['2026-01-01', 1]]);
  const pos = main().positions[0]!;
  assert.equal(pos.quantity, 10);
  assert.deepEqual(pos.lots.map((l) => l.q), [1, 9]);
});

test('a backdated sale of every eligible share removes those lots, so their buy stays locked', async () => {
  reset();
  setSymbol('XYZ', { currency: 'USD', price: 20 });
  await pf.buy('XYZ', 2, 10, day(1));
  await pf.buy('XYZ', 9, 100, day(20));
  await pf.sell('XYZ', 2, 20, undefined, 'USD', day(10));
  assert.deepEqual(main().positions[0]!.lots.map((l) => l.q), [9]);
  const firstBuy = main().transactions.find((t) => t.type === 'BUY')!;
  await assert.rejects(() => deleteBuy(firstBuy.id), /has been sold/);
});

test('an undated sale still draws on every lot', async () => {
  reset();
  setSymbol('XYZ', { currency: 'USD', price: 20 });
  await pf.buy('XYZ', 1, 10, day(1));
  await pf.buy('XYZ', 9, 100, day(20));
  const { realized } = await pf.sell('XYZ', 5, 20);
  assert.equal(realized, (20 - 91) * 5);
  assert.equal(main().positions[0]!.quantity, 5);
});

test('a sale price must be a finite, nonnegative number', async () => {
  reset();
  setSymbol('XYZ', { currency: 'USD', price: 20 });
  await pf.buy('XYZ', 2, 10);
  const before = JSON.stringify(main());
  await assert.rejects(() => pf.sell('XYZ', 1, -20), /price/i);
  await assert.rejects(() => pf.sell('XYZ', 1, Infinity), /price/i);
  assert.equal(JSON.stringify(main()), before);
  await assert.rejects(() => pf.buy('XYZ', 1, Infinity), /price/i);
});

test('unknown account IDs are rejected instead of showing another account', async () => {
  reset();
  setSymbol('XYZ', { currency: 'USD', price: 20 });
  await pf.buy('XYZ', 1, 10);
  await assert.rejects(() => pf.portfolioWithQuotes('USD', 'removed-account'), /Unknown account/);
  await assert.rejects(() => pf.fxRisk('USD', 'removed-account'), /Unknown account/);
  const ok = await pf.portfolioWithQuotes('USD');
  assert.deepEqual(ok.positions.map((p) => p.symbol), ['XYZ']);
  const all = await pf.portfolioWithQuotes('USD', 'ALL');
  assert.deepEqual(all.positions.map((p) => p.symbol), ['XYZ']);
});

test('numeric cells: grouping, currency marks and scientific notation', () => {
  assert.equal(parseNumberCell('1,234'), 1234);
  assert.equal(parseNumberCell('2,345.67'), 2345.67);
  assert.equal(parseNumberCell('$38.20'), 38.2);
  assert.equal(parseNumberCell('US$ 1,000'), 1000);
  assert.equal(parseNumberCell('12.5 USD'), 12.5);
  assert.equal(parseNumberCell('1e3'), 1000);
  assert.equal(parseNumberCell('1.5E-2'), 0.015);
  assert.equal(parseNumberCell('-4'), -4);
  for (const bad of ['', '1,2', '12,34.5', '1e', 'abc', '1.2.3', '--1', '1 000x']) assert.ok(Number.isNaN(parseNumberCell(bad)), bad);
});

test('flat CSV reads scientific notation as its value', () => {
  assert.deepEqual(parseCsv('symbol,quantity,price\nXYZ,1e3,1e2'), [{ symbol: 'XYZ', quantity: 1000, price: 100, dateMs: null }]);
});

test('IBKR positions read grouped numbers', () => {
  const rows = parseIbkrPositions([['Open Positions', 'Data', 'Summary', 'Stocks', 'USD', 'XYZ', '1,234', '1', '2,345.67']]);
  assert.deepEqual(rows, [{ symbol: 'XYZ', quantity: 1234, price: 2345.67, dateMs: null }]);
});
