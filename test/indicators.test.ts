import test from 'node:test';
import assert from 'node:assert';
import { indicators as I } from './publicmath.ts';

const near = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);
const bars = (cs: number[]) => cs.map((c, i) => ({ t: i * 86400000, o: c, h: c + 1, l: c - 1, c, v: 100 + i }));

test('sma and ema: definitions on a known series', () => {
  const s = [1, 2, 3, 4, 5, 6];
  assert.deepStrictEqual(I.sma(s, 3), [null, null, 2, 3, 4, 5]);
  const e = I.ema(s, 3); // seed = mean(1,2,3) = 2, k = 0.5
  assert.deepStrictEqual(e.slice(0, 2), [null, null]);
  near(e[2], 2); near(e[3], 3); near(e[4], 4); near(e[5], 5);
});

test('rsi: all gains -> 100, all losses -> 0, flat alternate -> 50', () => {
  near(I.rsi(bars([1, 2, 3, 4, 5, 6, 7, 8]), 3)[7], 100);
  near(I.rsi(bars([8, 7, 6, 5, 4, 3, 2, 1]), 3)[7], 0);
  const alt = I.rsi(bars([10, 11, 10, 11, 10, 11, 10, 11, 10]), 2);
  assert.ok(alt[8] > 30 && alt[8] < 70);
});

test('bollinger uses population SD around the SMA', () => {
  const r = I.bollinger(bars([2, 4, 4, 4, 5, 5, 7, 9]), 8, 2);
  near(r.mid[7], 5); near(r.upper[7], 9); near(r.lower[7], 1); // SD = 2
});

test('true range and ATR (Wilder)', () => {
  const b = [{ h: 10, l: 8, c: 9 }, { h: 12, l: 9, c: 11 }, { h: 11, l: 7, c: 8 }];
  assert.deepStrictEqual(I.trueRange(b), [2, 3, 4]);
  const a = I.atr(b, 2);
  near(a[1], 2.5); near(a[2], (2.5 + 4) / 2);
});

test('macd hist = macd - signal', () => {
  const b = bars(Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 4) * 5 + i * 0.2));
  const m = I.macd(b);
  for (let i = 0; i < b.length; i++) if (m.hist[i] != null) near(m.hist[i], m.macd[i] - m.signal[i]);
  assert.strictEqual(m.macd[24], null);
  assert.notStrictEqual(m.macd[25], null);
});

test('stochastic bounded 0..100 and donchian channel', () => {
  const b = bars(Array.from({ length: 40 }, (_, i) => 50 + Math.sin(i / 3) * 10));
  const s = I.stoch(b);
  s.k.forEach((v: number | null) => { if (v != null) assert.ok(v >= 0 && v <= 100); });
  const d = I.donchian(b, 5);
  for (let i = 4; i < b.length; i++) assert.ok(d.upper[i] >= d.mid[i] && d.mid[i] >= d.lower[i]);
});

test('obv accumulates signed volume', () => {
  const b = [{ c: 1, v: 10 }, { c: 2, v: 5 }, { c: 1, v: 3 }, { c: 1, v: 7 }];
  assert.deepStrictEqual(I.obv(b), [0, 5, 2, 2]);
});

test('vwap resets each session; anchored vwap starts at the anchor', () => {
  const b = [
    { t: 0, h: 10, l: 10, c: 10, v: 1 }, { t: 3600e3, h: 20, l: 20, c: 20, v: 1 },
    { t: 86400e3, h: 30, l: 30, c: 30, v: 2 },
  ];
  assert.deepStrictEqual(I.vwap(b), [10, 15, 30]);
  assert.deepStrictEqual(I.anchoredVwap(b, 1), [null, 20, (20 + 60) / 3]);
});

test('supertrend flips direction on a trend reversal', () => {
  const up = Array.from({ length: 30 }, (_, i) => 100 + i * 2), down = Array.from({ length: 30 }, (_, i) => 158 - i * 4);
  const st = I.supertrend(bars(up.concat(down)), 10, 3);
  assert.strictEqual(st.dir[29], 1);
  assert.strictEqual(st.dir[59], -1);
});

test('adx in range and heikin-ashi close is OHLC/4', () => {
  const b = bars(Array.from({ length: 60 }, (_, i) => 100 + i));
  const a = I.adx(b, 14);
  a.adx.forEach((v: number | null) => { if (v != null) assert.ok(v >= 0 && v <= 100); });
  assert.ok(a.plusDI[59] > a.minusDI[59]);
  const ha = I.heikinAshi([{ t: 0, o: 1, h: 4, l: 0, c: 3 }]);
  near(ha[0].c, 2); near(ha[0].o, 2);
});
