// Cost-basis review: flags, marks, the weekly range check and average-cost rewrite with undo.
import { setSymbol, reset, DAY, dataDir } from './helpers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as pf from '../lib/portfolio.ts';
import * as store from '../lib/store.ts';
import * as cb from '../lib/costbasis.ts';
import type { StoredPortfolio } from '../lib/model.ts';

const T = Date.UTC(2026, 0, 15, 12);
const pos = (symbol: string, px: number, t: number | null, tx?: string) => ({ symbol, currency: 'USD', quantity: 10, avgCost: px, lots: [{ q: 10, px, fxUsd: 1, t, ...(tx ? { tx } : {}) }] });
const book = (): Pick<StoredPortfolio, 'accounts'> => ({ accounts: [{
  id: 'a', name: 'Broker', cash: {}, dividends: [],
  positions: [pos('AAA', 10, T), pos('BBB', 20, T + 3600e3), pos('CCC', 30, T), pos('DDD', 0, T - 40 * DAY), pos('FND', 9.6, T - 90 * DAY, 'tx1')],
  transactions: [{ id: 'tx1', type: 'TRANSFER', symbol: 'FND', transferSide: 'in' }],
}] });

test('costbasis: bulk-import dates, zero cost and unquoted holdings are flagged with reasons', () => {
  const r = cb.review(book(), {}, { unquoted: new Set(['FND']) });
  const f = (s: string) => r.rows.find((x) => x.symbol === s)!.flags.map((x) => x.flag);
  assert.deepEqual(f('AAA'), ['bulk-date']);
  assert.deepEqual(f('BBB'), ['bulk-date']); // same UTC day, different hour
  assert.deepEqual(f('DDD'), ['zero-cost']);
  assert.deepEqual(f('FND'), ['unquoted']);
  assert.equal(r.counts.flagged, 5);
  assert.ok(r.rows.find((x) => x.symbol === 'AAA')!.flags[0]!.reason.includes('2 other holdings'));
  // A transferred-in lot can't be rewritten here.
  assert.equal(r.rows.find((x) => x.symbol === 'FND')!.editable, false);
  assert.equal(r.checked, false);
});

test('costbasis: a confirmation clears heuristics until the cost changes; placeholder is a flag', () => {
  const marks = { 'a|AAA': { status: 'confirmed' as const, avgCostAtMark: 10, at: 1 }, 'a|BBB': { status: 'confirmed' as const, avgCostAtMark: 19, at: 1 }, 'a|CCC': { status: 'placeholder' as const, avgCostAtMark: 30, at: 1, note: 'from app' } };
  const r = cb.review(book(), marks);
  const f = (s: string) => r.rows.find((x) => x.symbol === s)!.flags.map((x) => x.flag);
  assert.deepEqual(f('AAA'), []);
  assert.deepEqual(f('BBB'), ['bulk-date', 'stale-confirmation']);
  assert.deepEqual(f('CCC'), ['bulk-date', 'marked-placeholder']);
  assert.equal(r.counts.confirmed, 2);
  assert.equal(r.counts.placeholder, 1);
});

test('costbasis: weekly range check', () => {
  const weeks = [{ t: T - 7 * DAY, h: 12, l: 10 }, { t: T - 2 * DAY, h: 11, l: 9 }];
  assert.equal(cb.lotInRange(10.5, T, weeks).inRange, true);
  assert.equal(cb.lotInRange(11.2, T, weeks).inRange, true); // within 2% slack
  assert.equal(cb.lotInRange(14, T, weeks).inRange, false);
  assert.equal(cb.lotInRange(10, null, weeks).inRange, null);
  assert.equal(cb.lotInRange(10, T + 30 * DAY, weeks).inRange, null); // no bar near the date
  const checks = new Map([['a|AAA', [cb.lotInRange(50, T, weeks)]]]);
  const r = cb.review(book(), {}, { lotChecks: checks });
  assert.ok(r.rows.find((x) => x.symbol === 'AAA')!.flags.some((x) => x.flag === 'out-of-range'));
  assert.equal(r.checked, true);
});

test('costbasis: setAverageCost scales lots and buys, records a confirmation, and undoes', async () => {
  reset();
  setSymbol('AAPL', { currency: 'USD', price: 120 });
  await pf.buy('AAPL', 10, 100, Date.now() - 30 * DAY, undefined, 'SGD');
  await pf.buy('AAPL', 10, 200, Date.now() - 10 * DAY, undefined, 'SGD');
  const acc = store.loadPortfolio().accounts[0]!;
  assert.equal(acc.positions[0]!.avgCost, 150);
  const out = await cb.setAverageCost(acc.id, 'aapl', 75);
  assert.deepEqual(out, { symbol: 'AAPL', before: 150, after: 75 });
  const after = store.loadPortfolio().accounts[0]!;
  assert.deepEqual(after.positions[0]!.lots.map((l) => l.px), [50, 100]);
  assert.deepEqual(after.transactions.filter((t) => t.type === 'BUY').map((t) => t.price).sort((x, y) => x! - y!), [50, 100]);
  const mark = cb.loadMarks()[`${acc.id}|AAPL`]!;
  assert.equal(mark.status, 'confirmed'); assert.equal(mark.avgCostAtMark, 75);
  assert.equal((fs.statSync(path.join(dataDir, 'cost-review.json')).mode & 0o777), 0o600);
  await store.undo();
  assert.equal(store.loadPortfolio().accounts[0]!.positions[0]!.avgCost, 150);
  // After undo the confirmation no longer matches: it shows as stale.
  const r = await cb.costReview();
  assert.ok(r.rows[0]!.flags.some((x) => x.flag === 'stale-confirmation'));
  await assert.rejects(() => cb.setAverageCost(acc.id, 'AAPL', -1), /positive/);
  await assert.rejects(() => cb.setAverageCost(acc.id, 'NOPE', 5), /not found/);
});

test('costbasis: marks validate and clear', async () => {
  reset();
  setSymbol('AAPL', { currency: 'USD', price: 120 });
  await pf.buy('AAPL', 1, 100, null, undefined, 'SGD');
  const id = store.loadPortfolio().accounts[0]!.id;
  cb.setMark(id, 'AAPL', 'placeholder', ' typed from memory ');
  assert.equal(cb.loadMarks()[`${id}|AAPL`]!.note, 'typed from memory');
  assert.throws(() => cb.setMark(id, 'AAPL', 'accepted'), /status/);
  cb.setMark(id, 'AAPL', 'clear');
  assert.deepEqual(cb.loadMarks(), {});
});
