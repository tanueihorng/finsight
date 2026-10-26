import './helpers.ts'; // isolated data dir before lib/ loads
import test from 'node:test';
import assert from 'node:assert';
import * as journal from '../lib/journal.ts';
import * as charts from '../lib/charts.ts';

test('journal: long trade with partial exits computes net R on the initial stop', () => {
  const e = journal.create({ symbol: 'amd', kind: 'paper', side: 'long', entry: 20, stop: 19.5, target: 21.5, qty: 100, fees: 2 });
  assert.strictEqual(e.symbol, 'AMD');
  assert.strictEqual(e.m.riskPerUnit, 0.5);
  assert.strictEqual(e.m.plannedRR, 3);
  assert.strictEqual(e.m.riskAmount, 50);
  const u = journal.update(e.id, { exits: [{ price: 21.5, qty: 50 }, { price: 20, qty: 50 }], status: 'closed' });
  assert.strictEqual(u.m.netPnl, 73); // 50*1.5 + 0 - 2 fees
  assert.strictEqual(u.m.netR, 73 / 50);
  assert.strictEqual(u.m.remaining, 0);
});

test('journal: short side signs P&L and validates the stop side', () => {
  const e = journal.create({ symbol: 'TSLA', side: 'short', entry: 100, stop: 105, qty: 10, exits: [{ price: 90, qty: 10 }], status: 'closed' });
  assert.strictEqual(e.m.netPnl, 100);
  assert.strictEqual(e.m.netR, 2);
  assert.throws(() => journal.create({ symbol: 'X', side: 'long', entry: 10, stop: 11 }), /below entry/);
  assert.throws(() => journal.create({ symbol: 'X', side: 'short', entry: 10, stop: 9 }), /above entry/);
});

test('journal: rejects overselling, bad numbers and bad symbols', () => {
  assert.throws(() => journal.create({ symbol: 'X', entry: 10, stop: 9, qty: 1, exits: [{ price: 11, qty: 2 }] }), /exceed/);
  assert.throws(() => journal.create({ symbol: 'X', entry: 'abc' }), /number/);
  assert.throws(() => journal.create({ symbol: '' }), /Symbol/);
  assert.throws(() => journal.create({ symbol: 'X', exits: [{ price: -1, qty: 1 }] }), /positive/);
});

test('journal: stats aggregate closed trades only; CSV neutralises formulas', () => {
  const all = journal.list();
  const s = journal.stats(all);
  assert.strictEqual(s.n, 2);
  assert.ok(Math.abs(s.totalR! - (73 / 50 + 2)) < 1e-12);
  journal.create({ symbol: 'Y', notes: '=HYPERLINK("x")' });
  const csv = journal.toCsv(journal.list());
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.includes(',-0.5,') || !csv.includes("'-"), 'numbers are not formula-escaped');
});

test('journal: image must be a real PNG data URL; delete removes the entry', () => {
  const e = journal.create({ symbol: 'IMG' });
  assert.throws(() => journal.saveImage(e.id, 'data:image/png;base64,AAAA'), /Not a PNG/);
  const png = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex').toString('base64');
  assert.ok(journal.saveImage(e.id, 'data:image/png;base64,' + png));
  assert.ok(journal.imagePath(e.id));
  assert.ok(journal.remove(e.id));
  assert.strictEqual(journal.imagePath(e.id), null);
  assert.throws(() => journal.saveImage('../../etc', 'x'), /Bad id/);
});

test('charts: drawings are validated, per symbol, and removable', () => {
  const n = charts.putDrawings('nvda', [
    { id: 'a1', type: 'trend', pts: [{ t: 1, p: 2 }, { t: 3, p: 4 }], style: { color: '#ff0000', width: 2, dash: 'dash' }, junk: 1 },
    { id: 'bad', type: 'trend', pts: [{ t: 'x', p: 2 }] },
    { id: 'b2', type: 'text', pts: [{ t: 1, p: 2 }], text: 'hello', style: { color: 'red' } },
  ]);
  assert.strictEqual(n, 2);
  const d = charts.getDrawings('NVDA');
  assert.strictEqual((d[0] as unknown as Record<string, unknown>).junk, undefined); // unknown fields are dropped
  assert.strictEqual(d[1]!.style.color, undefined);
  assert.throws(() => charts.getDrawings('../x'), /Bad symbol/);
  charts.putDrawings('NVDA', []);
  assert.deepStrictEqual(charts.getDrawings('NVDA'), []);
});

test('charts: named layouts save/delete and current settings persist', () => {
  charts.saveLayout('Pullback', { indicators: [{ type: 'ema', params: { length: 21 } }] });
  charts.putCurrent({ chartType: 'candles' });
  const l = charts.getLayouts();
  assert.ok(l.layouts.Pullback!.savedAt);
  assert.strictEqual(l.current!.chartType, 'candles');
  assert.throws(() => charts.saveLayout('<script>', {}), /Layout name/);
  assert.ok(charts.deleteLayout('Pullback'));
});
