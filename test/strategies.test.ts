import test from 'node:test';
import assert from 'node:assert';
import { strategies as L } from './publicmath.ts';
import { strategy as PB } from './publicmath.ts';

const DAY = 86400000;
// Deterministic wavy uptrend with drawdowns: exercises all five strategies.
function market(n: number, seed = 7) {
  let s = seed; const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const out = []; let c = 30;
  for (let i = 0; i < n; i++) {
    const regime = Math.sin(i / 90) > -0.3 ? 0.004 : -0.006;
    const o = c * (1 + (rnd() - 0.5) * 0.01);
    c = o * (1 + regime + (rnd() - 0.5) * 0.045 + Math.sin(i / 7) * 0.006);
    const h = Math.max(o, c) * (1 + rnd() * 0.012), l = Math.min(o, c) * (1 - rnd() * 0.012);
    out.push({ t: i * DAY, o, h, l, c, v: 2e6 + rnd() * 3e6 });
  }
  return out;
}
const bars = market(1400);

test('library lists five strategies with rules and sources', () => {
  const ls = L.list();
  assert.deepStrictEqual(ls.map((s: any) => s.id), ['pullback', 'breakout', 'matrend', 'rsi2', 'dcazones']);
  ls.forEach((s: any) => { assert.ok(s.rules.length >= 3); assert.ok(s.source.length > 20); });
});

for (const id of ['pullback', 'breakout', 'matrend', 'rsi2', 'dcazones']) {
  test(`${id}: no look-ahead — signals on a prefix equal the full-history prefix`, () => {
    const full = L.run(id, bars), cut = 1100, part = L.run(id, bars.slice(0, cut));
    const key = id === 'dcazones' ? (r: any) => r.tranches.map((t: any) => t.i) : (r: any) => r.setups.map((s: any) => s.i);
    assert.deepStrictEqual(key(part), key(full).filter((i: any) => i < cut));
    const tr = (r: any) => r.trades.filter((t: any) => t.exitIdx < cut - 1).map((t: any) => [t.entryIdx, t.exitIdx, +t.Rmult.toFixed(9)]);
    assert.deepStrictEqual(tr(part), tr(full));
    assert.ok(full.stage && full.stage.code && full.stage.label);
  });
}

for (const id of ['breakout', 'matrend', 'rsi2']) {
  test(`${id}: produces trades that reconcile (R = pnl / initial risk, all units exited)`, () => {
    const r = L.run(id, bars);
    assert.ok(r.trades.length > 0, 'fixture should trigger ' + id);
    for (const t of r.trades) {
      assert.ok(Math.abs(t.Rmult - t.pnl / t.R) < 1e-12);
      assert.ok(Math.abs(t.exits.reduce((s: any, e: any) => s + e.qty, 0) - 1) < 1e-12);
      assert.ok(t.exitIdx >= t.entryIdx && t.entryIdx > t.setupIdx);
    }
  });
}

test('shared simulator reproduces the frozen pullback engine trade-for-trade', () => {
  const b = bars, a = PB.analyze(b), R = PB.RULES;
  const c = b.map((x) => x.c), e9 = PB.ema(c, 9);
  const sim = L.simulate(b, {
    minBars: R.minBars, maxStopPct: R.maxStopPct, partialR: 3, hardStop: true,
    signal: (i: any) => (PB.conditionsAt(b, PB.ema(c.slice(0, i + 1), 21), PB.ema(c.slice(0, i + 1), 50), i, R).setup ? { type: 'stop', trig: b[i]!.h, stop: b[i]!.l } : null),
    exitRule: (i: any) => (c[i]! < e9[i] ? 'ema9' : null),
  });
  assert.ok(a.trades.length > 3);
  assert.deepStrictEqual(sim.trades.map((t: any) => [t.entryIdx, t.exitIdx, +t.Rmult.toFixed(9)]), a.trades.map((t: any) => [t.entryIdx, t.exitIdx, +t.Rmult.toFixed(9)]));
});

test('MA trend has no intraday stop and reports % per trade; RSI-2 exits within 10 bars of entry', () => {
  const m = L.run('matrend', bars);
  m.trades.forEach((t: any) => assert.ok(t.exits.every((e: any) => e.why !== 'stop')));
  assert.strictEqual(m.measure, 'pct');
  assert.ok(Math.abs(m.stats.expectancy - m.trades.reduce((s: any, t: any) => s + t.pnl / t.entry, 0) / m.trades.length) < 1e-12);
  const r = L.run('rsi2', bars);
  r.trades.forEach((t: any) => assert.ok(t.exitIdx - t.entryIdx <= 11));
});

test('DCA zones: tranches spaced ≥ 21 bars, forward returns use only later data, stats consistent', () => {
  const z = L.run('dcazones', bars);
  assert.ok(z.tranches.length > 2);
  for (let k = 1; k < z.tranches.length; k++) assert.ok(z.tranches[k].i - z.tranches[k - 1].i >= 21);
  z.tranches.forEach((t: any) => { if (t.i + 63 < bars.length) assert.ok(Math.abs(t.fwd - (bars[t.i + 63]!.c / bars[t.i]!.c - 1)) < 1e-12); else assert.strictEqual(t.fwd, null); });
  assert.ok(Math.abs(z.stats.edge - (z.stats.avgFwd - z.stats.baseAvg)) < 1e-12);
});

test('short history reports insufficient data instead of signals', () => {
  for (const id of ['breakout', 'matrend', 'rsi2', 'dcazones']) {
    const r = L.run(id, bars.slice(0, 150));
    assert.strictEqual(r.stage.code, 'insufficient', id);
    assert.strictEqual(r.trades.length, 0);
  }
});
