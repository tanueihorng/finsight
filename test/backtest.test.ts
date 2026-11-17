import { dataDir } from './helpers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as bt from '../lib/backtest.ts';

const DAY = 864e5;
// Same deterministic wavy market as the strategy-library tests.
function market(n: number, seed = 7) {
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out = []; let c = 30;
  for (let i = 0; i < n; i++) {
    const regime = Math.sin(i / 90) > -0.3 ? 0.004 : -0.006;
    const o = c * (1 + (rnd() - 0.5) * 0.01);
    c = o * (1 + regime + (rnd() - 0.5) * 0.045 + Math.sin(i / 7) * 0.006);
    const h = Math.max(o, c) * (1 + rnd() * 0.012), l = Math.min(o, c) * (1 - rnd() * 0.012);
    out.push({ t: Date.UTC(2021, 0, 1) + i * DAY, o, h, l, c, v: 2e6 + rnd() * 3e6 });
  }
  return out;
}

test('backtest: stats arithmetic', () => {
  const s = bt.statsOf([{ retPct: 0.1, Rmult: 2 }, { retPct: -0.05, Rmult: -1 }], 'R');
  assert.equal(s.n, 2); assert.equal(s.winRate, 50);
  assert.ok(Math.abs(s.avgRetPct! - 2.5) < 1e-9);
  assert.equal(s.expectancyR, 0.5);
  assert.ok(Math.abs(s.compoundedPct! - 4.5) < 1e-9); // 1.1 x 0.95
  assert.equal(bt.statsOf([], 'pct').winRate, null);
  assert.equal(bt.statsOf([{ retPct: 0.1 }], 'pct').expectancyR, null);
});

test('backtest: a run splits by date, compares with buy-and-hold and matches the engine', () => {
  const data = new Map([['AAA', market(1400, 7)], ['BBB', market(1400, 11)], ['TINY', market(50, 3)]]);
  const run = bt.runOn('rsi2', data, { range: '5y', now: 1 });
  assert.deepEqual(run.universe, ['AAA', 'BBB', 'TINY']);
  assert.equal(run.symbols.find((x) => x.symbol === 'TINY')!.error, 'Not enough daily history');
  const a = run.symbols.find((x) => x.symbol === 'AAA')!;
  assert.equal(a.all.n, a.inSample.n + a.outOfSample.n);
  assert.ok(a.outOfSample.n > 0 && a.inSample.n > a.outOfSample.n);
  assert.equal(run.total.all.n, run.symbols.reduce((s, x) => s + x.all.n, 0));
  assert.equal(run.total.compared, 2);
  assert.ok(a.buyHoldPct != null && a.timeInMarketPct! > 0 && a.timeInMarketPct! < 100);
  assert.ok(run.notes.some((n) => /Survivorship/.test(n)));
  assert.throws(() => bt.runOn('dcazones', data, { range: '5y' }), /non-trading/);
});

test('backtest: the paper gate needs enough trades, in and out of sample', () => {
  assert.equal(bt.gateOf({ n: 40 } as any, { n: 12 } as any).passes, true);
  const g = bt.gateOf({ n: 5 } as any, { n: 1 } as any);
  assert.equal(g.passes, false); assert.equal(g.reasons.length, 2);
  const thin = bt.runOn('breakout', new Map([['AAA', market(400)]]), { range: '2y' });
  assert.throws(() => bt.promotionRecord(thin, '', Date.UTC(2026, 10, 7)), /Not enough evidence/);
});

test('backtest: promotion record, statuses and accepted refusal', () => {
  const data = new Map([['AAA', market(1400, 7)], ['BBB', market(1400, 11)], ['CCC', market(1400, 5)]]);
  const run = bt.runOn('rsi2', data, { range: '5y', now: 1 });
  assert.ok(run.gate.passes, run.gate.reasons.join(' '));
  const rec = bt.promotionRecord(run, ' try it ', Date.UTC(2026, 10, 7));
  assert.equal(rec.status, 'paper'); assert.equal(rec.since, '2026-11-07'); assert.equal(rec.note, 'try it');
  assert.equal(rec.evidence.n, run.total.all.n);
  assert.throws(() => bt.setStatus('rsi2', 'accepted'), /Only you can accept/);
  assert.throws(() => bt.setStatus('nope', 'clear'), /Unknown/);
  assert.throws(() => bt.setStatus('rsi2', 'backtested'), /Nothing recorded/);
  assert.deepEqual(bt.strategies().map((s) => s.id), ['pullback', 'breakout', 'matrend', 'rsi2']);
  assert.equal(bt.strategies().find((s) => s.id === 'pullback')!.libraryStatus, 'backtested');
  assert.equal(fs.existsSync(path.join(dataDir, 'strategy-status.json')), false);
});

test('backtest: paper tracking only counts signals on or after the promotion date', () => {
  const bars = market(1400, 7);
  const since = new Date(bars[1100]!.t).toISOString().slice(0, 10);
  const track = bt.trackOn('rsi2', since, new Map([['AAA', bars]]));
  assert.ok(track.trades.length > 0);
  for (const t of track.trades) assert.ok(t.entryDate >= since);
  const full = bt.trackOn('rsi2', '2000-01-01', new Map([['AAA', bars]]));
  assert.ok(full.trades.length > track.trades.length);
});

test('backtest: universe validation', () => {
  assert.deepEqual(bt.cleanUniverse('aapl, msft aapl'), ['AAPL', 'MSFT']);
  assert.throws(() => bt.cleanUniverse(''), /at least one/);
  assert.throws(() => bt.cleanUniverse(['A;B']), /Not a symbol/);
  assert.throws(() => bt.cleanUniverse(Array.from({ length: 41 }, (_, i) => 'S' + i)), /At most/);
});
