'use strict';
// Chart enhancements: new indicator maths, line/indicator alerts, the ledger
// trades overlay and brush drawings. Offline, against the fake market.
const { setSymbol, dailyBars, reset, DAY } = require('./helpers');
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../public/indicators.js');
const am = require('../lib/alertmath');
const pf = require('../lib/portfolio');
const { chartTrades } = require('../lib/ledger');
const charts = require('../lib/charts');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);
const bars = (cs) => cs.map((c, i) => ({ t: i * DAY, o: c, h: c + 1, l: c - 1, c, v: 100 }));

test('asOf join never uses a later bar', () => {
  const main = [{ t: 10 }, { t: 20 }, { t: 30 }, { t: 40 }];
  const other = [{ t: 15, c: 1 }, { t: 30, c: 2 }, { t: 45, c: 3 }];
  assert.deepEqual(I.asOf(main, other), [null, 1, 2, 2]);
});

test('relative strength rebases to 100 and tracks out/under-performance', () => {
  const a = bars([10, 11, 12]), b = bars([100, 100, 120]);
  const rs = I.relStrength(a, b);
  near(rs[0], 100); near(rs[1], 110); near(rs[2], 100);
});

test('ichimoku spans are displaced forward and the lagging span back', () => {
  const b = bars(Array.from({ length: 60 }, (_, i) => 100 + i));
  const r = I.ichimoku(b, 9, 26, 52, 26);
  assert.equal(r.spanA.length, 60 + 26);
  assert.equal(r.spanA[25 + 26], (r.conv[25] + r.base[25]) / 2);
  assert.equal(r.lagging[0], b[26].c);
  assert.equal(r.spanB[51 + 26], (b[51].h + b[0].l) / 2);
});

test('parabolic SAR stays below price in a steady uptrend', () => {
  const b = bars(Array.from({ length: 30 }, (_, i) => 100 + i * 2));
  const r = I.psar(b);
  for (let i = 5; i < 30; i++) { assert.equal(r.dir[i], 1); assert.ok(r.sar[i] < b[i].l); }
});

test('Williams %R, MFI and CCI bounds and definitions', () => {
  const up = bars(Array.from({ length: 30 }, (_, i) => 100 + i));
  near(I.willr(up, 14)[29], (up[29].h - up[29].c) / (up[29].h - (up[16].l)) * -100);
  assert.equal(I.mfi(up, 14)[29], 100); // only positive money flow
  const flat = bars(Array.from({ length: 30 }, () => 50));
  assert.equal(I.cci(flat, 20)[29], 0);
});

test('pivots use the previous period high/low/close', () => {
  const b = [
    { t: 0, h: 12, l: 8, c: 10 }, { t: 1, h: 14, l: 9, c: 11 },
    { t: 10, h: 20, l: 15, c: 18 }, { t: 11, h: 21, l: 16, c: 19 },
  ];
  const r = I.pivots(b, (t) => Math.floor(t / 10));
  assert.equal(r.p[0], null);
  const p = (14 + 8 + 11) / 3;
  near(r.p[2], p); near(r.r1[2], 2 * p - 8); near(r.s1[2], 2 * p - 14); near(r.p[3], p);
});

test('volume profile conserves volume and finds the point of control', () => {
  const b = [
    { o: 10, h: 11, l: 10, c: 11, v: 100 },
    { o: 11, h: 11, l: 10, c: 10, v: 300 },
    { o: 15, h: 20, l: 15, c: 20, v: 50 },
  ];
  const vp = I.volumeProfile(b, 0, 3, 10, 0.7);
  const tot = vp.up.reduce((a, x) => a + x, 0) + vp.dn.reduce((a, x) => a + x, 0);
  near(tot, 450, 1e-6);
  assert.ok(vp.pocPrice >= 10 && vp.pocPrice <= 11.5);
  assert.ok(vp.val <= vp.pocPrice && vp.vah >= vp.pocPrice);
});

test('line alert value follows bar-index geometry, including log lines', () => {
  const b = [0, 1, 2, 3, 4].map((i) => ({ t: (i + (i > 2 ? 2 : 0)) * DAY, c: 1 })); // weekend gap after bar 2
  // through bar 0 @100 and bar 2 @110: +5 per bar, so bar 4 = 120 regardless of the calendar gap
  near(am.lineValueNow(b, [{ t: 0, p: 100 }, { t: 2 * DAY, p: 110 }], false), 120);
  near(am.lineValueNow(b, [{ t: 0, p: 100 }, { t: 2 * DAY, p: 121 }], true), 100 * Math.pow(1.1, 4), 1e-9);
  assert.equal(am.lineValueNow(b, [{ t: 0, p: 100 }, { t: 0, p: 110 }]), null);
});

test('line, indicator and price alerts evaluate and label', async () => {
  reset();
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i); // steady rise to 159
  setSymbol('ACME', { currency: 'USD', bars: dailyBars(closes) });
  const b = dailyBars(closes);
  // flat line at 150: price 159 is above it
  await pf.alertAdd({ symbol: 'acme', kind: 'line', op: '>', line: { pts: [{ t: b[0].t, p: 150 }, { t: b[10].t, p: 150 }], interval: '1d' } });
  await pf.alertAdd({ symbol: 'ACME', kind: 'ind', op: '>', price: 70, ind: { type: 'rsi', length: 14, interval: '1d' } });
  await pf.alertAdd({ symbol: 'ACME', kind: 'ind', op: '<', ind: { type: 'sma', length: 20, interval: '1d' } });
  await pf.alertAdd({ symbol: 'ACME', op: '<', price: 100 });
  const out = await pf.alertsWithStatus();
  assert.equal(out.length, 4);
  const [line, rsi, sma, price] = out;
  assert.equal(line.met, true); near(line.level, 150, 1e-9);
  assert.equal(rsi.met, true); assert.ok(rsi.currentValue > 70);
  assert.equal(sma.met, false); // price is above its rising 20-day average
  assert.equal(price.met, false);
  assert.match(line.label, /crosses above trend line/);
  assert.match(sma.label, /price ≤ SMA\(20, 1d\)/);
  await assert.rejects(pf.alertAdd({ symbol: 'ACME', kind: 'ind', op: '>', price: 1, ind: { type: 'nope', length: 3 } }), /Unknown indicator/);
  await assert.rejects(pf.alertAdd({ symbol: 'ACME', kind: 'line', line: { pts: [{ t: 1, p: 1 }, { t: 1, p: 2 }] } }), /two points/);
  // moving the line re-arms the alert with the new level
  const upd = await pf.alertUpdate({ id: line.id, line: { pts: [{ t: b[0].t, p: 170 }, { t: b[10].t, p: 170 }], interval: '1d' } });
  assert.equal(upd.alerts.find((a) => a.id === line.id).triggeredAt, null);
  const again = (await pf.alertsWithStatus()).find((a) => a.id === line.id);
  assert.equal(again.met, false); near(again.level, 170, 1e-9);
});

test('chart trades overlay lists buys/sells and the open average cost', async () => {
  reset();
  setSymbol('ACME', { currency: 'USD', price: 120, prevClose: 118 });
  setSymbol('USDSGD=X', { currency: 'SGD', price: 1.3 });
  const t0 = Date.now() - 30 * DAY;
  await pf.buy('ACME', 10, 100, t0, undefined, 'SGD');
  await pf.buy('ACME', 10, 110, t0 + 5 * DAY, undefined, 'SGD');
  await pf.sell('ACME', 5, 130);
  const d = chartTrades('acme');
  assert.deepEqual(d.trades.map((t) => t.side), ['buy', 'buy', 'sell']);
  assert.equal(d.position.quantity, 15);
  assert.ok(d.position.avgCost > 100 && d.position.avgCost < 110);
  assert.equal(chartTrades('NOPE').position, null);
});

test('brush drawings keep many points; other tools stay capped', () => {
  reset();
  const pts = Array.from({ length: 50 }, (_, i) => ({ t: i * DAY, p: 100 + i }));
  assert.equal(charts.putDrawings('ACME', [{ id: 'b1', type: 'brush', pts }, { id: 't1', type: 'trend', pts }]), 1);
  assert.equal(charts.getDrawings('ACME')[0].pts.length, 50);
});
