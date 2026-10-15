'use strict';
const test = require('node:test');
const assert = require('node:assert');
const S = require('../public/strategy.js');

const DAY = 86400000;
// Steady uptrend with periodic pullbacks: enough momentum to qualify as a leader.
function trendBars(n, { start = 20, drift = 0.006, vol = 5e6 } = {}) {
  const out = []; let c = start;
  for (let i = 0; i < n; i++) {
    const wave = Math.sin(i / 6) * 0.02;
    const o = c; c = c * (1 + drift + wave * 0.5);
    out.push({ t: i * DAY, o, h: Math.max(o, c) * 1.01, l: Math.min(o, c) * 0.99, c, v: vol });
  }
  return out;
}

test('ema seeds with first value and converges', () => {
  const e = S.ema([10, 10, 10, 20], 3);
  assert.strictEqual(e[0], 10);
  assert.strictEqual(e[2], 10);
  assert.strictEqual(e[3], 15); // k = 0.5
});

test('anchored VWAP is volume-weighted typical price from the anchor', () => {
  const bars = [{ h: 9, l: 9, c: 9, v: 1 }, { h: 12, l: 9, c: 9, v: 1 }, { h: 15, l: 15, c: 15, v: 3 }];
  const a = S.anchoredVwap(bars, 1);
  assert.strictEqual(a[0], null);
  assert.strictEqual(a[1], 10);
  assert.strictEqual(a[2], (10 + 45) / 4);
});

test('size reproduces the thread example (10k, 0.5%, 20 -> 19.50)', () => {
  const s = S.size({ equity: 10000, riskPct: 0.5, entry: 20, stop: 19.5, feePerOrder: 1 });
  assert.ok(s.ok);
  assert.strictEqual(s.shares, 100);
  assert.strictEqual(s.value, 2000);
  assert.strictEqual(s.weightPct, 20);
  assert.strictEqual(s.stopPct, 2.5);
  assert.strictEqual(s.feeR, 2 / 50);
});

test('size rejects stops at or above entry and tiny budgets', () => {
  assert.strictEqual(S.size({ equity: 10000, riskPct: 0.5, entry: 20, stop: 20 }).ok, false);
  assert.strictEqual(S.size({ equity: 100, riskPct: 0.5, entry: 500, stop: 400 }).ok, false);
});

test('no look-ahead: setups on a prefix equal the prefix of full-history setups', () => {
  const bars = trendBars(400);
  const full = S.analyze(bars).setups.map((s) => s.i);
  const cut = 300;
  const part = S.analyze(bars.slice(0, cut)).setups.map((s) => s.i);
  assert.deepStrictEqual(part, full.filter((i) => i < cut));
});

test('ambiguous entry bar (trigger and stop both hit) is booked as a stop', () => {
  const bars = trendBars(300);
  const a = S.analyze(bars);
  for (const t of a.trades.filter((x) => x.sameDayStop)) {
    assert.strictEqual(t.entryIdx, t.exitIdx);
    assert.ok(t.Rmult < -0.9);
  }
});

test('short history is reported as insufficient, not as a signal', () => {
  const a = S.analyze(trendBars(100));
  assert.strictEqual(a.stage.code, 'insufficient');
  assert.strictEqual(a.trades.length, 0);
});

test('thin volume fails the liquidity screen', () => {
  const a = S.analyze(trendBars(300, { vol: 100 }));
  assert.strictEqual(a.setups.length, 0);
  assert.ok(['illiquid', 'in-trade'].includes(a.stage.code));
});

test('every closed trade reconciles: R multiple = pnl / initial risk', () => {
  const a = S.analyze(trendBars(500));
  assert.ok(a.trades.length > 0, 'fixture should produce trades');
  for (const t of a.trades) {
    assert.ok(Math.abs(t.Rmult - t.pnl / t.R) < 1e-12);
    const qty = t.exits.reduce((s, e) => s + e.qty, 0);
    assert.ok(Math.abs(qty - 1) < 1e-12, 'all units exited');
  }
});
