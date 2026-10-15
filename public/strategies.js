/* FinSight — strategy library (pure functions, no DOM).
 *
 * Ready-made daily-bar strategies that load onto the chart. Each has written
 * rules that are fixed in code (no tuning to results), signals that use only
 * information up to the signal bar's close, and the same trade simulation:
 *   - "stop" entries: next bar trades through the trigger -> fill at max(open, trigger)
 *   - "open" entries: fill at the next bar's open
 *   - stop checked before target inside a bar; exit rules act at the next open
 *   - 10 bps per side + 5 bps entry slippage; R measured on the initial stop
 * These are research aids for one symbol at a time — not signals or advice.
 *
 * Loaded as window.FinStrategies (needs FinIndicators + FinStrategy) or require().
 */
(function (root, factory) {
  const node = typeof module === 'object' && module.exports;
  const I = node ? require('./indicators.js') : root.FinIndicators;
  const P = node ? require('./strategy.js') : root.FinStrategy;
  const api = factory(I, P);
  if (node) module.exports = api; else root.FinStrategies = api;
})(typeof self !== 'undefined' ? self : this, function (I, PB) {
  'use strict';

  const COST = 0.0010, SLIP = 0.0005;
  const fmt = function (v) { return v == null || !isFinite(v) ? '—' : (Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(4)); };
  const pctS = function (v, d) { return v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '') + (v * 100).toFixed(d == null ? 1 : d) + '%'; };

  function cleanBars(bars) {
    return (bars || []).filter(function (b) { return b && [b.o, b.h, b.l, b.c].every(function (x) { return x != null && isFinite(x); }) && b.o > 0; });
  }
  function rollMax(arr, n) { const out = new Array(arr.length).fill(null); for (let i = n - 1; i < arr.length; i++) { let m = -Infinity; for (let k = i - n + 1; k <= i; k++) if (arr[k] > m) m = arr[k]; out[i] = m; } return out; }
  function rollMin(arr, n) { const out = new Array(arr.length).fill(null); for (let i = n - 1; i < arr.length; i++) { let m = Infinity; for (let k = i - n + 1; k <= i; k++) if (arr[k] < m) m = arr[k]; out[i] = m; } return out; }
  function dollarVol50(b, i) { let s = 0; const k0 = Math.max(0, i - 49); for (let k = k0; k <= i; k++) s += b[k].c * (b[k].v || 0); return s / (i - k0 + 1); }
  const liquid = function (b, i) { return b[i].c >= 5 && dollarVol50(b, i) >= 2e7; };

  /**
   * Generic long-only simulator. spec:
   *   minBars, signal(i) -> {type:'stop'|'open', trig?, stop} | null   (at close of i)
   *   exitRule(i, pos) -> reason | null   (at close of i; exit next open)
   *   partialR (sell half at entry + partialR*R) | null, hardStop (intraday stop), maxStopPct
   */
  function simulate(b, spec) {
    const setups = [], trades = [];
    let pos = null, pending = null;
    const close = function (i, px, why) {
      pos.exits.push({ i: i, px: px, qty: pos.qty, why: why });
      pos.pnl += pos.qty * (px - pos.entry) - pos.qty * px * COST;
      pos.qty = 0; pos.exitIdx = i; pos.exitWhy = why; pos.Rmult = pos.pnl / pos.R; pos.retPct = pos.pnl / pos.entry;
      trades.push(pos); pos = null;
    };
    for (let i = 0; i < b.length; i++) {
      const x = b[i];
      let entered = false;
      if (pending && !pos) {
        let fill = null;
        if (pending.type === 'stop' && x.h > pending.trig) fill = Math.max(x.o, pending.trig) * (1 + SLIP);
        else if (pending.type === 'open') fill = x.o * (1 + SLIP);
        if (fill != null) {
          const rps = fill - pending.stop;
          if (rps > 0 && rps / fill <= spec.maxStopPct) {
            pos = { setupIdx: pending.i, entryIdx: i, entry: fill, stop: pending.stop, R: rps, target: spec.partialR ? fill + spec.partialR * rps : null,
              qty: 1, half: false, exitNext: null, pnl: -fill * COST, exits: [] };
            entered = true;
            if (spec.hardStop && x.l <= pos.stop) { pos.sameDayStop = pending.type === 'stop'; close(i, pos.stop, 'stop'); }
            else { const why = spec.exitRule(i, pos); if (why) pos.exitNext = why; }
          }
        }
      }
      pending = null;
      if (pos && !entered) {
        if (pos.exitNext) close(i, x.o, pos.exitNext);
        else if (spec.hardStop && x.l <= pos.stop) close(i, Math.min(x.o, pos.stop), 'stop');
        else {
          if (pos.target != null && !pos.half && x.h >= pos.target) {
            const px = Math.max(x.o, pos.target), q = pos.qty / 2;
            pos.exits.push({ i: i, px: px, qty: q, why: spec.partialR + 'R' });
            pos.pnl += q * (px - pos.entry) - q * px * COST; pos.qty -= q; pos.half = true;
          }
          const why = spec.exitRule(i, pos); if (why) pos.exitNext = why;
        }
      }
      if (i >= spec.minBars) {
        const s = spec.signal(i);
        if (s) { s.i = i; setups.push(s); pending = s; }
      }
    }
    let open = null;
    if (pos) { const last = b[b.length - 1].c, mark = pos.pnl + pos.qty * (last - pos.entry); open = Object.assign({}, pos, { markR: mark / pos.R, markPct: mark / pos.entry }); }
    return { setups: setups, trades: trades, open: open, stats: spec.measure === 'pct' ? pctStats(trades) : PB.stats(trades), measure: spec.measure || 'R' };
  }

  // Per-trade % return stats, for rules without a protective stop (R would be ill-defined).
  function pctStats(trades) {
    const r = trades.map(function (t) { return t.retPct; });
    if (!r.length) return { n: 0 };
    const w = r.filter(function (x) { return x > 0; }), l = r.filter(function (x) { return x <= 0; });
    const mean = function (a) { return a.reduce(function (s, x) { return s + x; }, 0) / a.length; };
    let streak = 0, cur = 0; r.forEach(function (x) { cur = x <= 0 ? cur + 1 : 0; streak = Math.max(streak, cur); });
    return { n: r.length, winRate: w.length / r.length, avgWin: w.length ? mean(w) : null, avgLoss: l.length ? mean(l) : null, expectancy: mean(r),
      totalR: null, compounded: r.reduce(function (p, x) { return p * (1 + x); }, 1) - 1, maxLossStreak: streak, sameDayStops: 0,
      avgBars: mean(trades.map(function (t) { return t.exitIdx - t.entryIdx; })) };
  }

  // Stage for a live signal on the last bar: stop entries project trigger/targets.
  function liveStage(b, s, partialR, label) {
    const li = b.length - 1;
    if (s.type === 'stop') {
      const r = s.trig - s.stop;
      return { code: 'setup', label: label || 'SETUP — watch trigger', trig: s.trig, stop: s.stop, stopPct: r / s.trig * 100,
        t3: s.trig + (partialR || 3) * r, t5: s.trig + 5 * r, entryType: 'stop',
        detail: 'buy stop > ' + fmt(s.trig) + ' · stop ' + fmt(s.stop) + ' (' + (r / s.trig * 100).toFixed(1) + '%)' };
    }
    const e = b[li].c, r = e - s.stop;
    return { code: 'signal', label: label || 'SIGNAL — enter next open', trig: e, stop: s.stop, stopPct: r / e * 100, entryType: 'open',
      t3: partialR ? e + partialR * r : null, detail: 'enter at next open (≈ ' + fmt(e) + ') · ' + (s.stopLabel || 'stop') + ' ' + fmt(s.stop) + ' (' + (r / e * 100).toFixed(1) + '%)' };
  }
  function openStage(open, extra) {
    return { code: 'in-trade', label: 'In simulated trade', detail: 'entry ' + fmt(open.entry) + ' · stop ' + fmt(open.stop) + ' · ' + (open.markR >= 0 ? '+' : '') + open.markR.toFixed(2) + 'R' + (extra || '') };
  }

  // ------------------------------------------------------------------ registry
  const S = {};

  S.pullback = {
    name: 'Pullback (Martin Luk)', short: 'Pullback', kind: 'trade',
    summary: 'Momentum leader pulls back to the 21 EMA; buy the break of the setup bar high.',
    rules: ['Leader: a 1, 3 or 6-month return ≥ 30%; liquid (price ≥ 5, 50-day $ volume ≥ 20M)',
      'Trend: close > EMA50 and EMA21 rising over 5 bars', 'Setup: low of the last 3 bars within 1% of EMA21',
      'Entry: next bar trades above the setup high · stop: setup low (skip if > 7%)', 'Exit: half at 3R; rest at next open after a close < EMA9'],
    source: 'OtherSideBJ thread on Martin Luk (Oct 2026); frozen in TRADE-001 study. Daily proxy — the real method triggers intraday.',
    run: function (bars) {
      const a = PB.analyze(bars);
      return { kind: 'trade', bars: a.bars, setups: a.setups, trades: a.trades, open: a.open, stats: a.stats,
        stage: a.stage.code === 'setup' ? Object.assign({ entryType: 'stop' }, a.stage) : a.stage,
        lines: [{ key: 'EMA9', data: a.e9, color: '#f9a8d4', width: 1 }, { key: 'EMA21', data: a.e21, color: '#c4b5fd', width: 1.3 }, { key: 'EMA50', data: a.e50, color: '#5eead4', width: 1.3 }] };
    },
  };

  S.breakout = {
    name: 'Breakout / VCP (Minervini-style)', short: 'Breakout', kind: 'trade',
    summary: 'Stage-2 uptrend, tight contracting base near highs; buy the break of the 20-day pivot.',
    rules: ['Trend template: close > SMA50 > SMA150 > SMA200; SMA200 up vs 21 bars ago; ≥ 25% above 52-week low; within 25% of 52-week high',
      'Base: 10-bar range ≤ 10% and tighter than the prior 10 bars; 10-bar volume below 50-bar average (dry-up)',
      'Setup: close within 5% of the pivot (20-bar high); liquid',
      'Entry: next bar trades above the pivot · stop: 10-bar low (skip if > 8%)', 'Exit: half at 3R; rest at next open after a close < EMA21'],
    source: 'Daily proxy of Minervini, “Trade Like a Stock Market Wizard” (2013) trend template / VCP and O’Neil pivot buys. Breakout-volume confirmation is not knowable at the trigger, so it is not required.',
    run: function (bars) {
      const b = cleanBars(bars), c = b.map(function (x) { return x.c; }), h = b.map(function (x) { return x.h; }), l = b.map(function (x) { return x.l; }), v = b.map(function (x) { return x.v || 0; });
      const s50 = I.sma(c, 50), s150 = I.sma(c, 150), s200 = I.sma(c, 200), e21 = I.ema(c, 21);
      const hi252 = rollMax(h, 252), lo252 = rollMin(l, 252), hi20 = rollMax(h, 20), hi10 = rollMax(h, 10), lo10 = rollMin(l, 10), v10 = I.sma(v, 10), v50 = I.sma(v, 50);
      const cond = function (i) {
        if (i < 252 || s200[i - 21] == null) return null;
        const tt = c[i] > s50[i] && s50[i] > s150[i] && s150[i] > s200[i] && s200[i] > s200[i - 21] && c[i] >= 1.25 * lo252[i] && c[i] >= 0.75 * hi252[i];
        const r10 = (hi10[i] - lo10[i]) / c[i], prevHi = Math.max.apply(null, h.slice(i - 19, i - 9)), prevLo = Math.min.apply(null, l.slice(i - 19, i - 9));
        const tight = r10 <= 0.10 && (hi10[i] - lo10[i]) < (prevHi - prevLo), dry = v10[i] < v50[i];
        const near = c[i] >= 0.95 * hi20[i];
        return { tt: tt, tight: tight, dry: dry, near: near, liq: liquid(b, i), r10: r10, pivot: hi20[i], stop: lo10[i] };
      };
      const sim = simulate(b, {
        minBars: 252, maxStopPct: 0.08, partialR: 3, hardStop: true,
        signal: function (i) { const k = cond(i); return k && k.tt && k.tight && k.dry && k.near && k.liq ? { type: 'stop', trig: k.pivot, stop: k.stop } : null; },
        exitRule: function (i) { return e21[i] != null && c[i] < e21[i] ? 'ema21' : null; },
      });
      const li = b.length - 1, k = cond(li), last = sim.setups.length && sim.setups[sim.setups.length - 1].i === li ? sim.setups[sim.setups.length - 1] : null;
      let stage;
      if (!k) stage = { code: 'insufficient', label: 'Not enough daily history', detail: 'needs > 252 bars' };
      else if (sim.open) stage = openStage(sim.open);
      else if (last) stage = Object.assign(liveStage(b, last, 3), { detail: liveStage(b, last, 3).detail + ' · base range ' + (k.r10 * 100).toFixed(1) + '%' });
      else if (!k.liq) stage = { code: 'illiquid', label: 'Fails liquidity', detail: 'price < 5 or 50-day $ volume < 20M' };
      else if (!k.tt) stage = { code: 'not-leader', label: 'Fails trend template', detail: 'needs close > 50 > 150 > 200-day, rising 200-day, near 52-week high' };
      else if (!k.tight || !k.dry) stage = { code: 'extended', label: 'Trend OK — no tight base', detail: '10-bar range ' + (k.r10 * 100).toFixed(1) + '% (≤ 10% and contracting needed)' + (k.dry ? '' : ' · volume not drying up') };
      else stage = { code: 'extended', label: 'Base OK — not near pivot', detail: 'pivot ' + fmt(k.pivot) + ' (' + pctS(c[li] / k.pivot - 1) + ')' };
      return Object.assign({ kind: 'trade', bars: b, stage: stage,
        lines: [{ key: 'SMA50', data: s50, color: '#38bdf8', width: 1.2 }, { key: 'SMA150', data: s150, color: '#a78bfa', width: 1 }, { key: 'SMA200', data: s200, color: '#c678dd', width: 1.3 }, { key: 'EMA21', data: e21, color: '#f9a8d4', width: 1, dash: true }] }, sim);
    },
  };

  S.matrend = {
    name: 'MA trend-following (50/200)', short: 'MA trend', kind: 'trade',
    summary: 'In a 50>200 uptrend, buy when price reclaims the 50-day; exit when it closes below the 200-day.',
    rules: ['Trend: SMA50 > SMA200', 'Signal: close crosses back above SMA50 (or a golden cross while above SMA50)',
      'Entry: next open · R measured to SMA200 at the signal (skip if > 30%)',
      'Exit: next open after a close below SMA200, or a death cross — no intraday stop',
      'Results are reported in % per trade: with no stop, R (distance to the 200-day) is not a meaningful unit'],
    source: 'Classic 50/200-day trend rule; related evidence: Faber (2007) “A Quantitative Approach to Tactical Asset Allocation”, Moskowitz–Ooi–Pedersen (2012) time-series momentum.',
    run: function (bars) {
      const b = cleanBars(bars), c = b.map(function (x) { return x.c; });
      const s50 = I.sma(c, 50), s200 = I.sma(c, 200);
      const sig = function (i) {
        if (s200[i] == null || s200[i - 1] == null) return null;
        const up = s50[i] > s200[i], reclaim = c[i] > s50[i] && c[i - 1] <= s50[i - 1], golden = s50[i] > s200[i] && s50[i - 1] <= s200[i - 1] && c[i] > s50[i];
        return up && (reclaim || golden) ? { type: 'open', stop: s200[i], stopLabel: '200-day (R reference)' } : null;
      };
      const sim = simulate(b, {
        minBars: 201, maxStopPct: 0.30, partialR: null, hardStop: false, measure: 'pct', signal: sig,
        exitRule: function (i) { return c[i] < s200[i] ? 'below 200d' : s50[i] < s200[i] ? 'death cross' : null; },
      });
      const li = b.length - 1, last = sim.setups.length && sim.setups[sim.setups.length - 1].i === li ? sim.setups[sim.setups.length - 1] : null;
      let stage;
      if (s200[li] == null) stage = { code: 'insufficient', label: 'Not enough daily history', detail: 'needs > 200 bars' };
      else if (sim.open) stage = { code: 'in-trade', label: 'In simulated trade', detail: 'entry ' + fmt(sim.open.entry) + ' · ' + pctS(sim.open.markPct) + ' · exit on close < 200-day ' + fmt(s200[li]) };
      else if (last) stage = liveStage(b, last, null);
      else if (s50[li] <= s200[li]) stage = { code: 'broken', label: 'Downtrend (50 < 200)', detail: 'waiting for a golden cross' };
      else if (c[li] < s50[li]) stage = { code: 'extended', label: 'Uptrend — below 50-day', detail: 'signal when close reclaims ' + fmt(s50[li]) };
      else stage = { code: 'extended', label: 'Uptrend — no fresh signal', detail: pctS(c[li] / s50[li] - 1) + ' vs 50-day' };
      return Object.assign({ kind: 'trade', bars: b, stage: stage,
        lines: [{ key: 'SMA50', data: s50, color: '#38bdf8', width: 1.3 }, { key: 'SMA200', data: s200, color: '#c678dd', width: 1.5 }] }, sim);
    },
  };

  S.rsi2 = {
    name: 'Mean reversion (RSI-2, Connors)', short: 'RSI-2', kind: 'trade',
    summary: 'Above the 200-day, buy a 2-day RSI washout; sell the bounce above the 5-day average.',
    rules: ['Filter: close > SMA200', 'Signal: RSI(2) < 10 at the close', 'Entry: next open',
      'Exit: next open after a close > SMA5, or after 10 bars', 'Catastrophe stop: entry − 2.5 × ATR(10) (our addition; Connors tests used none)'],
    source: 'Connors & Alvarez, “Short Term Trading Strategies That Work” (2008). Original enters at the close; this enters next open.',
    run: function (bars) {
      const b = cleanBars(bars), c = b.map(function (x) { return x.c; });
      const s200 = I.sma(c, 200), s5 = I.sma(c, 5), r2 = I.rsi(b, 2), a10 = I.atr(b, 10);
      const sim = simulate(b, {
        minBars: 201, maxStopPct: 0.25, partialR: null, hardStop: true,
        signal: function (i) { return s200[i] != null && c[i] > s200[i] && r2[i] != null && r2[i] < 10 && a10[i] ? { type: 'open', stop: c[i] - 2.5 * a10[i], stopLabel: 'catastrophe stop' } : null; },
        exitRule: function (i, pos) { return c[i] > s5[i] ? 'close > SMA5' : i - pos.entryIdx >= 10 ? '10-bar time stop' : null; },
      });
      const li = b.length - 1, last = sim.setups.length && sim.setups[sim.setups.length - 1].i === li ? sim.setups[sim.setups.length - 1] : null;
      let stage;
      if (s200[li] == null) stage = { code: 'insufficient', label: 'Not enough daily history', detail: 'needs > 200 bars' };
      else if (sim.open) stage = openStage(sim.open, ' · exit when close > SMA5 ' + fmt(s5[li]));
      else if (last) stage = Object.assign(liveStage(b, last, null), { detail: liveStage(b, last, null).detail + ' · RSI(2) ' + r2[li].toFixed(1) });
      else if (c[li] <= s200[li]) stage = { code: 'broken', label: 'Below 200-day — no longs', detail: 'filter requires close > ' + fmt(s200[li]) };
      else stage = { code: 'extended', label: 'Uptrend — not oversold', detail: 'RSI(2) ' + (r2[li] != null ? r2[li].toFixed(1) : '—') + ' (needs < 10)' };
      return Object.assign({ kind: 'trade', bars: b, stage: stage,
        lines: [{ key: 'SMA200', data: s200, color: '#c678dd', width: 1.4 }, { key: 'SMA5', data: s5, color: '#ffd166', width: 1 }] }, sim);
    },
  };

  // Long-term add zones from the private technical playbook (placeholders, not policy).
  S.dcazones = {
    name: '200-day / Fib DCA zones (playbook)', short: 'DCA zones', kind: 'zones',
    summary: 'Core-holding add zones: near the 200-day, or the 38.2% retracement of the last 126-bar up-move.',
    rules: ['Trend valid: SMA50 > SMA200', '200-day zone: close within ±3% of SMA200',
      'Fib zone: 126-bar up-impulse (low before high); 38.2% retracement ± 0.35 ATR(14), above the guard at 50% − 0.5 ATR',
      'Tranche marker: first zone touch after ≥ 21 bars; compared by its next-63-bar return vs all days',
      'Stretched: close > SMA50 + 12% · Review: close < SMA200 − 5%'],
    source: 'Your technical playbook / ledger trade-plan placeholders (Oct 2026) — untested proposals, not accepted policy. Fib study (Tsinaslanidis et al. 2022) found no comparative advantage.',
    run: function (bars) {
      const b = cleanBars(bars), c = b.map(function (x) { return x.c; });
      const s50 = I.sma(c, 50), s200 = I.sma(c, 200), atr = I.atr(b, 14);
      const fibAt = function (i) {
        if (i < 125) return null;
        let H = -Infinity, L = Infinity, iH = 0, iL = 0;
        for (let k = i - 125; k <= i; k++) { if (b[k].h > H) { H = b[k].h; iH = k; } if (b[k].l < L) { L = b[k].l; iL = k; } }
        if (!(iL < iH) || !(H > L)) return { up: false, H: H, L: L, iH: iH, iL: iL, from: i - 125 };
        const lv = function (r) { return H - r * (H - L); };
        const a = atr[i] || 0;
        return { up: true, H: H, L: L, iH: iH, iL: iL, from: i - 125, f382: lv(0.382), f50: lv(0.5), f618: lv(0.618), f236: lv(0.236), zLo: lv(0.382) - 0.35 * a, zHi: lv(0.382) + 0.35 * a, guard: lv(0.5) - 0.5 * a };
      };
      const state = function (i) {
        if (s200[i] == null || s50[i] == null) return null;
        const trend = s50[i] > s200[i], f = fibAt(i);
        const in200 = Math.abs(c[i] / s200[i] - 1) <= 0.03;
        const inFib = !!(f && f.up && c[i] >= f.zLo && c[i] <= f.zHi && c[i] > f.guard);
        return { trend: trend, in200: in200, inFib: inFib, zone: trend && (in200 || inFib), stretched: c[i] > s50[i] * 1.12, review: c[i] < s200[i] * 0.95, f: f };
      };
      const tranches = [];
      let lastT = -1e9;
      const first = 200, fwd = 63;
      for (let i = first; i < b.length; i++) {
        const s = state(i); if (!s || !s.zone) continue;
        if (i - lastT >= 21) { tranches.push({ i: i, px: c[i], why: s.in200 ? '200-day' : 'Fib 38.2%', fwd: i + fwd < b.length ? c[i + fwd] / c[i] - 1 : null }); lastT = i; }
      }
      const done = tranches.filter(function (t) { return t.fwd != null; });
      let base = [];
      for (let i = first; i + fwd < b.length; i++) if (s200[i] != null) base.push(c[i + fwd] / c[i] - 1);
      const mean = function (a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : null; };
      const stats = { n: done.length, pending: tranches.length - done.length, avgFwd: mean(done.map(function (t) { return t.fwd; })),
        pctPos: done.length ? done.filter(function (t) { return t.fwd > 0; }).length / done.length : null, baseAvg: mean(base), baseN: base.length };
      stats.edge = stats.avgFwd != null && stats.baseAvg != null ? stats.avgFwd - stats.baseAvg : null;
      const li = b.length - 1, s = state(li);
      let stage;
      if (!s) stage = { code: 'insufficient', label: 'Not enough daily history', detail: 'needs > 200 bars' };
      else if (s.review) stage = { code: 'broken', label: 'Review trigger', detail: 'close ' + pctS(c[li] / s200[li] - 1) + ' vs 200-day (review below −5%) — thesis check, not a sell rule' };
      else if (s.zone) stage = { code: 'setup', zone: true, label: s.in200 ? 'In 200-day add zone' : 'In Fib 38.2% zone', detail: (s.in200 ? '200-day ' + fmt(s200[li]) + ' (' + pctS(c[li] / s200[li] - 1) + ')' : '38.2% ' + fmt(s.f.f382) + ' · guard ' + fmt(s.f.guard)) + ' · an add still needs thesis, valuation and funding' };
      else if (s.stretched) stage = { code: 'extended', label: 'Stretched — no adds', detail: pctS(c[li] / s50[li] - 1) + ' above the 50-day (threshold +12%)' };
      else if (!s.trend) stage = { code: 'not-leader', label: 'Trend invalid (50 < 200)', detail: 'zones need SMA50 > SMA200' };
      else stage = { code: 'extended', label: 'Between zones', detail: '200-day ' + fmt(s200[li]) + ' (' + pctS(c[li] / s200[li] - 1) + ')' + (s.f && s.f.up ? ' · Fib 38.2% ' + fmt(s.f.f382) : '') };
      const band = { upper: s200.map(function (v) { return v == null ? null : v * 1.03; }), lower: s200.map(function (v) { return v == null ? null : v * 0.97; }), color: '#c678dd' };
      return { kind: 'zones', bars: b, stage: stage, tranches: tranches, stats: stats, fib: s && s.f && s.f.up ? s.f : null, bands: [band],
        setups: [], trades: [], open: null,
        lines: [{ key: 'SMA50', data: s50, color: '#38bdf8', width: 1.2 }, { key: 'SMA200', data: s200, color: '#c678dd', width: 1.5 }] };
    },
  };

  const ORDER = ['pullback', 'breakout', 'matrend', 'rsi2', 'dcazones'];
  function list() { return ORDER.map(function (id) { const s = S[id]; return { id: id, name: s.name, short: s.short, kind: s.kind, summary: s.summary, rules: s.rules, source: s.source }; }); }
  function run(id, bars) {
    const s = S[id]; if (!s) throw new Error('Unknown strategy ' + id);
    const r = s.run(bars); r.id = id; r.name = s.name; r.short = s.short;
    return r;
  }
  return { list: list, run: run, simulate: simulate, get: function (id) { return S[id] || null; } };
});
