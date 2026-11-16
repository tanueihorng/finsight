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

// One US regular session (13 Nov 2026, 09:30-16:00 ET = 22:30-05:00 SGT), 5-minute bars.
const usSession = (day: number) => {
  const open = Date.UTC(2026, 10, day, 14, 30);
  return Array.from({ length: 78 }, (_, i) => ({ t: open + i * 300_000, o: 100 + i * 0.1, h: 100.5 + i * 0.1, l: 99.5 + i * 0.1, c: 100 + i * 0.1, v: 1000 }));
};

test('vwap follows the exchange day, not the browser time zone (SGT midnight falls at 11:00 ET)', () => {
  const b = usSession(13);
  const whole = b.reduce((a, x) => a + (x.h + x.l + x.c) / 3 * x.v, 0) / b.reduce((a, x) => a + x.v, 0);
  const v = I.vwap(b, 'America/New_York');
  near(v.at(-1), whole, 1e-9);
  // The old behaviour: the browser's Singapore offset (+480 min) split the session at bar 18.
  assert.ok(Math.abs(I.vwap(b, 480).at(-1) - whole) > 0.5);
  // Next trading day starts a new session at its 09:30 open.
  const two = I.vwap([...b, ...usSession(16)], 'America/New_York');
  const first = b[0]!;
  near(two[78], (first.h + first.l + first.c) / 3, 1e-9);
});

test('exchangeDay: DST, half-hour zones, Asian sessions and unknown zones', () => {
  // New York: -5 h before the 8 Mar 2026 switch, -4 h after.
  assert.strictEqual(I.zoneOffset(Date.UTC(2026, 2, 8, 6), 'America/New_York'), -5 * 3600000);
  assert.strictEqual(I.zoneOffset(Date.UTC(2026, 2, 8, 8), 'America/New_York'), -4 * 3600000);
  // A summer session (13:30-20:00 UTC) stays on one day.
  assert.strictEqual(I.exchangeDay(Date.UTC(2026, 6, 15, 13, 30), 'America/New_York'), I.exchangeDay(Date.UTC(2026, 6, 15, 19, 55), 'America/New_York'));
  // India (+5:30): the day turns at 18:30 UTC, between whole hours.
  assert.strictEqual(I.exchangeDay(Date.UTC(2026, 0, 5, 18, 31), 'Asia/Kolkata') - I.exchangeDay(Date.UTC(2026, 0, 5, 18, 29), 'Asia/Kolkata'), 1);
  // SGX session (09:00-17:00 SGT = 01:00-09:00 UTC) is one Singapore day.
  assert.strictEqual(I.exchangeDay(Date.UTC(2026, 0, 5, 1), 'Asia/Singapore'), I.exchangeDay(Date.UTC(2026, 0, 5, 8, 55), 'Asia/Singapore'));
  // Missing or unknown zone means UTC.
  assert.strictEqual(I.zoneOffset(Date.UTC(2026, 0, 5), undefined), 0);
  assert.strictEqual(I.zoneOffset(Date.UTC(2026, 0, 5), 'Not/AZone'), 0);
});
