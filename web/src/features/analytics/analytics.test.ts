import test from 'node:test';
import assert from 'node:assert/strict';
import { allocationSlices, heatColor, holdingsSig, perfPaths, sectors, treemap, wealthAccount, wealthTotals } from './analytics.ts';
import type { Position } from '../../../../shared/types.ts';

const pos = (symbol: string, marketValue: number, extra: Partial<Position> = {}) => ({ symbol, marketValue, quantity: 1, avgCost: 1, cost: 1, ...extra }) as Position;
const cats = { A: { symbol: 'A', type: 'EQUITY', sector: 'Tech', category: 'Tech' }, E: { symbol: 'E', type: 'ETF', sector: null, category: 'ETF / Fund' } };

test('treemap fills the rectangle without overlap and skips empty values', () => {
  const out = treemap([{ value: 6 }, { value: 3 }, { value: 1 }, { value: 0 }], 0, 0, 100, 50);
  assert.equal(out.length, 3);
  const area = out.reduce((s, r) => s + r.w * r.h, 0);
  assert.ok(Math.abs(area - 5000) < 1e-6);
  assert.deepEqual(treemap([], 0, 0, 10, 10), []);
});

test('heat colours clamp at ±3% and are neutral at 0', () => {
  assert.equal(heatColor(0), 'rgb(26,31,38)');
  assert.equal(heatColor(3), heatColor(9));
  assert.equal(heatColor(-3), 'rgb(205,55,55)');
  assert.equal(heatColor(null), 'rgb(26,31,38)');
});

test('allocation slices sort by value; a single 100% slice has no arc path', () => {
  const s = allocationSlices([pos('A', 100), pos('E', 300)], 'holding', cats, 'Main');
  assert.deepEqual(s.map((x) => [x.label, x.frac, x.color]), [['E', 0.75, '#a78bfa'], ['A', 0.25, '#38bdf8']]);
  assert.ok(s[0]!.path!.startsWith('M'));
  assert.deepEqual(allocationSlices([pos('A', 1), pos('E', 1)], 'class', cats, 'Main').map((x) => x.label).sort(), ['ETFs', 'Stocks']);
  const one = allocationSlices([pos('A', 1)], 'account', cats, 'Main');
  assert.deepEqual(one.map((x) => [x.label, x.path]), [['Main', null]]);
});

test('sectors, wealth model and performance paths', () => {
  assert.deepEqual(sectors([pos('A', 5), pos('X', 2)], cats).map((g) => [g.category, g.value]), [['Tech', 5], ['Other', 2]]);
  const w = wealthAccount('a', 'Main', [pos('A', 70), pos('E', 20)], [{ ccy: 'USD', amount: 10, base: 10 }], cats);
  assert.deepEqual(w.parts, { Stocks: 70, ETFs: 20, Cash: 10 });
  assert.equal(w.net, 100);
  const t = wealthTotals([w, wealthAccount('b', 'Two', [], [{ ccy: 'USD', amount: 5, base: 5 }], cats)]);
  assert.deepEqual([t.net, t.cashCcy.USD, t.maxNet], [105, 15, 100]);
  const p = perfPaths([{ t: 0, value: 1, invested: 1 }, { t: 1, value: 2, invested: 1 }], false);
  assert.equal(p.up, true);
  assert.equal(p.bench, null);
  assert.equal(p.value, 'M4.0,156.0 L596.0,4.0');
  assert.equal(holdingsSig([pos('A', 1, { quantity: 3 })]), 'A:3');
});
