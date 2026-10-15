/* FinSight — pullback strategy engine (pure functions, no DOM).
 *
 * Daily-bar proxy of the Martin Luk pullback method as frozen in the TRADE-001
 * feasibility study: strength -> pullback to the 21 EMA -> break of the setup
 * bar's high -> stop under the setup bar -> sell half at 3R, trail the rest on
 * a close below the 9 EMA. Single-symbol view: the cross-sectional momentum
 * rank and portfolio limits of the study are NOT applied here, and the real
 * method triggers on 1-15 minute charts. Research aid, not a trade signal.
 *
 * Loaded in the browser as window.FinStrategy and in Node via require().
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinStrategy = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RULES = Object.freeze({
    minBars: 130,          // warm-up before any signal (126-day return + EMA settle)
    momentum: 0.30,        // max(1m, 3m, 6m return) must reach +30%
    lookbacks: [21, 63, 126],
    nearEma21: 0.01,       // low of the last 3 bars within 1% of the 21 EMA
    risingBars: 5,         // 21 EMA above its value 5 bars ago
    maxStopPct: 0.07,      // skip if entry-to-stop distance > 7%
    targetR: 3,            // sell half here
    stretchR: 5,           // reference level only
    minPrice: 5,
    minDollarVol: 2e7,     // 50-day average close x volume
    cost: 0.0010,          // per side, on notional
    slip: 0.0005,          // added to entry fill
  });

  // EMA seeded with the first value (matches the study's backtest engine).
  function ema(values, n) {
    const k = 2 / (n + 1), out = new Array(values.length);
    let e = null;
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      if (v == null || !isFinite(v)) { out[i] = e; continue; }
      e = e == null ? v : v * k + e * (1 - k);
      out[i] = e;
    }
    return out;
  }

  // Anchored VWAP from bar index `from` using typical price (H+L+C)/3.
  function anchoredVwap(bars, from) {
    const out = new Array(bars.length).fill(null);
    let pv = 0, vv = 0;
    for (let i = Math.max(0, from); i < bars.length; i++) {
      const b = bars[i];
      const tp = ((b.h ?? b.c) + (b.l ?? b.c) + b.c) / 3;
      const v = b.v || 0;
      pv += tp * v; vv += v;
      out[i] = vv > 0 ? pv / vv : tp;
    }
    return out;
  }

  function cleanBars(bars) {
    return (bars || []).filter((b) => b && [b.o, b.h, b.l, b.c].every((x) => x != null && isFinite(x)) && b.o > 0);
  }

  // Conditions evaluated at the close of bar i (no look-ahead).
  function conditionsAt(b, e21, e50, i, R) {
    const c = b[i].c;
    const ret = R.lookbacks.map((n) => (i >= n ? c / b[i - n].c - 1 : null));
    let dv = 0;
    for (let k = Math.max(0, i - 49); k <= i; k++) dv += b[k].c * (b[k].v || 0);
    dv /= Math.min(50, i + 1);
    const leader = ret.every((r) => r != null) && Math.max(...ret) >= R.momentum;
    const trend = c > e50[i] && i >= R.risingBars && e21[i] > e21[i - R.risingBars];
    const near = i >= 2 && Math.min(b[i - 2].l, b[i - 1].l, b[i].l) <= e21[i] * (1 + R.nearEma21);
    const liquid = c >= R.minPrice && dv >= R.minDollarVol;
    return { ret, dv, leader, trend, near, liquid, setup: leader && trend && near && liquid };
  }

  /**
   * analyze(bars) -> { e9, e21, e50, setups, trades, open, stage, stats }
   * bars: [{ t, o, h, l, c, v }] ascending, daily.
   */
  function analyze(rawBars, opts) {
    const R = Object.assign({}, RULES, opts || {});
    const b = cleanBars(rawBars);
    const closes = b.map((x) => x.c);
    const e9 = ema(closes, 9), e21 = ema(closes, 21), e50 = ema(closes, 50);
    const setups = [], trades = [];
    let pos = null, pending = null;

    const closeTrade = (i, px, why) => {
      pos.exits.push({ i, px, qty: pos.qty, why });
      pos.pnl += pos.qty * (px - pos.entry) - pos.qty * px * R.cost;
      pos.qty = 0; pos.exitIdx = i; pos.exitWhy = why;
      pos.Rmult = pos.pnl / pos.R;
      trades.push(pos); pos = null;
    };

    for (let i = 0; i < b.length; i++) {
      const x = b[i];
      // 1) pending entry from yesterday's setup (skipped while a trade is open)
      if (pending && !pos && x.h > pending.trig) {
        const fill = Math.max(x.o, pending.trig) * (1 + R.slip);
        const rps = fill - pending.stop;
        if (rps > 0 && rps / fill <= R.maxStopPct) {
          pos = { setupIdx: pending.i, entryIdx: i, entry: fill, stop: pending.stop, R: rps,
            target: fill + R.targetR * rps, qty: 1, half: false, trail: false, pnl: -fill * R.cost, exits: [] };
          // Daily bars cannot order the low vs the trigger: assume the stop came first.
          if (x.l <= pos.stop) { pos.sameDayStop = true; closeTrade(i, pos.stop, 'stop'); }
          else if (x.c < e9[i]) pos.trail = true;
          pending = null;
          // fall through to the screen below with no open-trade management today
          screen(i); continue;
        }
      }
      pending = null;
      // 2) manage an open trade (stop checked before target)
      if (pos && i > pos.entryIdx) {
        if (pos.trail) closeTrade(i, x.o, 'ema9');
        else if (x.l <= pos.stop) closeTrade(i, Math.min(x.o, pos.stop), 'stop');
        else {
          if (!pos.half && x.h >= pos.target) {
            const px = Math.max(x.o, pos.target), q = pos.qty / 2;
            pos.exits.push({ i, px, qty: q, why: '3R' });
            pos.pnl += q * (px - pos.entry) - q * px * R.cost;
            pos.qty -= q; pos.half = true;
          }
          if (x.c < e9[i]) pos.trail = true;
        }
      }
      screen(i);
    }

    function screen(i) {
      if (i < R.minBars) return;
      const cond = conditionsAt(b, e21, e50, i, R);
      if (cond.setup) {
        setups.push({ i, trig: b[i].h, stop: b[i].l });
        pending = { i, trig: b[i].h, stop: b[i].l };
      }
    }

    // open trade marked to the last close
    let open = null;
    if (pos) {
      const last = b[b.length - 1].c;
      open = Object.assign({}, pos, { markR: (pos.pnl + pos.qty * (last - pos.entry)) / pos.R });
    }

    // stage of the latest bar
    const n = b.length, li = n - 1;
    let stage;
    if (n <= R.minBars) stage = { code: 'insufficient', label: 'Not enough daily history', detail: `${n} bars; needs > ${R.minBars}` };
    else {
      const c = conditionsAt(b, e21, e50, li, R);
      const gap = (b[li].c / e21[li] - 1) * 100;
      const base = { ret: c.ret, gapPct: gap, liquid: c.liquid };
      if (open) stage = Object.assign(base, { code: 'in-trade', label: 'In simulated trade', detail: `entry ${fmt(open.entry)} · stop ${fmt(open.stop)} · ${open.markR >= 0 ? '+' : ''}${open.markR.toFixed(2)}R` });
      else if (!c.liquid) stage = Object.assign(base, { code: 'illiquid', label: 'Fails liquidity', detail: 'price < 5 or 50d $vol < 20M' });
      else if (!c.leader) stage = Object.assign(base, { code: 'not-leader', label: 'Not a momentum leader', detail: 'no 1/3/6m return ≥ 30%' });
      else if (!c.trend) stage = Object.assign(base, { code: 'broken', label: 'Leader, trend broken', detail: 'close ≤ EMA50 or EMA21 not rising' });
      else if (c.setup) {
        const trig = b[li].h, stop = b[li].l, r = trig - stop;
        stage = Object.assign(base, { code: 'setup', label: 'SETUP — watch trigger', trig, stop,
          stopPct: r / trig * 100, t3: trig + R.targetR * r, t5: trig + R.stretchR * r,
          detail: `trigger > ${fmt(trig)} · stop ${fmt(stop)} (${(r / trig * 100).toFixed(1)}%)${r / trig > R.maxStopPct ? ' · stop too wide' : ''}` });
      } else stage = Object.assign(base, { code: 'extended', label: 'Leader, extended — wait', detail: `${gap.toFixed(1)}% above EMA21` });
    }

    return { bars: b, e9, e21, e50, setups, trades, open, stage, stats: stats(trades), rules: R };
  }

  function stats(trades) {
    const Rs = trades.map((t) => t.Rmult);
    if (!Rs.length) return { n: 0 };
    const wins = Rs.filter((r) => r > 0), losses = Rs.filter((r) => r <= 0);
    let streak = 0, cur = 0;
    for (const r of Rs) { cur = r <= 0 ? cur + 1 : 0; streak = Math.max(streak, cur); }
    const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
    return { n: Rs.length, winRate: wins.length / Rs.length, avgWin: wins.length ? mean(wins) : null,
      avgLoss: losses.length ? mean(losses) : null, expectancy: mean(Rs), totalR: Rs.reduce((s, x) => s + x, 0),
      maxLossStreak: streak, sameDayStops: trades.filter((t) => t.sameDayStop).length };
  }

  /**
   * Position size for a long: risk budget / (entry - stop), floored to whole
   * shares (or `step` units). Fee drag is two orders expressed in R.
   */
  function size({ equity, riskPct, entry, stop, feePerOrder = 0, step = 1 }) {
    if (!(equity > 0) || !(riskPct > 0) || !(entry > 0) || !(stop >= 0)) return { ok: false, why: 'Enter equity, risk %, entry and stop' };
    const rps = entry - stop;
    if (!(rps > 0)) return { ok: false, why: 'Stop must be below entry for a long' };
    const budget = equity * riskPct / 100;
    const shares = Math.floor(budget / rps / step) * step;
    const value = shares * entry, risk = shares * rps;
    return { ok: shares > 0, why: shares > 0 ? '' : 'Risk budget smaller than one unit of risk',
      budget, rps, stopPct: rps / entry * 100, shares, value, weightPct: value / equity * 100,
      risk, feeR: risk > 0 ? (2 * feePerOrder) / risk : null, cashShort: value > equity };
  }

  function fmt(v) {
    if (v == null || !isFinite(v)) return '—';
    const a = Math.abs(v), d = a >= 1000 ? 2 : a >= 1 ? 2 : 4;
    return v.toFixed(d);
  }

  return { RULES, ema, anchoredVwap, analyze, stats, size, conditionsAt };
});
