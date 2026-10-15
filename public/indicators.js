/* FinSight — technical indicator maths (pure, no DOM).
 * Every function takes an array of bars [{ t, o, h, l, c, v }] (or a numeric
 * series where noted) and returns arrays aligned to the input, with null where
 * the indicator is not yet defined. Loaded as window.FinIndicators or require().
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FinIndicators = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const closes = (b) => b.map((x) => x.c);
  const nz = (v) => v != null && isFinite(v);

  function sma(src, n) {
    const out = new Array(src.length).fill(null);
    let sum = 0, cnt = 0;
    for (let i = 0; i < src.length; i++) {
      const v = src[i];
      if (nz(v)) { sum += v; cnt++; }
      if (i >= n) { const o = src[i - n]; if (nz(o)) { sum -= o; cnt--; } }
      if (i >= n - 1 && cnt === n) out[i] = sum / n;
    }
    return out;
  }

  // EMA seeded with the SMA of the first n valid values (standard charting convention).
  function ema(src, n) {
    const out = new Array(src.length).fill(null);
    const k = 2 / (n + 1);
    let e = null, seed = 0, cnt = 0;
    for (let i = 0; i < src.length; i++) {
      const v = src[i];
      if (!nz(v)) { out[i] = e; continue; }
      if (e == null) {
        seed += v; cnt++;
        if (cnt === n) { e = seed / n; out[i] = e; }
        continue;
      }
      e = v * k + e * (1 - k);
      out[i] = e;
    }
    return out;
  }

  // Wilder's smoothing (RMA), seeded with the SMA of the first n values.
  function rma(src, n) {
    const out = new Array(src.length).fill(null);
    let e = null, seed = 0, cnt = 0;
    for (let i = 0; i < src.length; i++) {
      const v = src[i];
      if (!nz(v)) { out[i] = e; continue; }
      if (e == null) { seed += v; cnt++; if (cnt === n) { e = seed / n; out[i] = e; } continue; }
      e = (e * (n - 1) + v) / n;
      out[i] = e;
    }
    return out;
  }

  function stdev(src, n) {
    const m = sma(src, n), out = new Array(src.length).fill(null);
    for (let i = n - 1; i < src.length; i++) {
      if (m[i] == null) continue;
      let s = 0;
      for (let k = i - n + 1; k <= i; k++) s += (src[k] - m[i]) ** 2;
      out[i] = Math.sqrt(s / n); // population SD, as TradingView's BB
    }
    return out;
  }

  function bollinger(b, n = 20, mult = 2) {
    const c = closes(b), mid = sma(c, n), sd = stdev(c, n);
    return { mid, upper: mid.map((m, i) => (m == null ? null : m + mult * sd[i])), lower: mid.map((m, i) => (m == null ? null : m - mult * sd[i])) };
  }

  function trueRange(b) {
    return b.map((x, i) => (i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - b[i - 1].c), Math.abs(x.l - b[i - 1].c))));
  }
  function atr(b, n = 14) { return rma(trueRange(b), n); }

  function keltner(b, n = 20, mult = 2, atrLen = 10) {
    const mid = ema(closes(b), n), a = atr(b, atrLen);
    return { mid, upper: mid.map((m, i) => (m == null || a[i] == null ? null : m + mult * a[i])), lower: mid.map((m, i) => (m == null || a[i] == null ? null : m - mult * a[i])) };
  }

  function donchian(b, n = 20) {
    const upper = new Array(b.length).fill(null), lower = new Array(b.length).fill(null), mid = new Array(b.length).fill(null);
    for (let i = n - 1; i < b.length; i++) {
      let hi = -Infinity, lo = Infinity;
      for (let k = i - n + 1; k <= i; k++) { if (b[k].h > hi) hi = b[k].h; if (b[k].l < lo) lo = b[k].l; }
      upper[i] = hi; lower[i] = lo; mid[i] = (hi + lo) / 2;
    }
    return { upper, lower, mid };
  }

  // SuperTrend: returns line value and direction (1 up / -1 down) per bar.
  function supertrend(b, n = 10, mult = 3) {
    const a = atr(b, n), line = new Array(b.length).fill(null), dir = new Array(b.length).fill(null);
    let up = null, dn = null, d = 1;
    for (let i = 0; i < b.length; i++) {
      if (a[i] == null) continue;
      const hl2 = (b[i].h + b[i].l) / 2;
      let bu = hl2 + mult * a[i], bl = hl2 - mult * a[i];
      if (dn != null && i > 0 && !(bl > dn || b[i - 1].c < dn)) bl = dn;
      if (up != null && i > 0 && !(bu < up || b[i - 1].c > up)) bu = up;
      if (up != null) {
        if (d === -1 && b[i].c > up) d = 1;
        else if (d === 1 && b[i].c < dn) d = -1;
      }
      up = bu; dn = bl;
      line[i] = d === 1 ? bl : bu; dir[i] = d;
    }
    return { line, dir };
  }

  // Session VWAP: resets when the calendar day (exchange-agnostic, UTC offset given) changes.
  function vwap(b, tzOffsetMin = 0) {
    const out = new Array(b.length).fill(null);
    let pv = 0, vv = 0, day = null;
    for (let i = 0; i < b.length; i++) {
      const d = Math.floor((b[i].t + tzOffsetMin * 60000) / 86400000);
      if (d !== day) { day = d; pv = 0; vv = 0; }
      const tp = (b[i].h + b[i].l + b[i].c) / 3, v = b[i].v || 0;
      pv += tp * v; vv += v;
      out[i] = vv > 0 ? pv / vv : tp;
    }
    return out;
  }

  function rsi(b, n = 14) {
    const c = closes(b), up = [null], dn = [null];
    for (let i = 1; i < c.length; i++) { const d = c[i] - c[i - 1]; up.push(Math.max(d, 0)); dn.push(Math.max(-d, 0)); }
    const au = rma(up.map((v, i) => (i === 0 ? null : v)), n), ad = rma(dn.map((v, i) => (i === 0 ? null : v)), n);
    return au.map((u, i) => (u == null || ad[i] == null ? null : ad[i] === 0 ? 100 : 100 - 100 / (1 + u / ad[i])));
  }

  function macd(b, fast = 12, slow = 26, signal = 9) {
    const c = closes(b), f = ema(c, fast), s = ema(c, slow);
    const line = f.map((v, i) => (v == null || s[i] == null ? null : v - s[i]));
    const sig = ema(line, signal);
    return { macd: line, signal: sig, hist: line.map((v, i) => (v == null || sig[i] == null ? null : v - sig[i])) };
  }

  function stoch(b, n = 14, kSmooth = 3, dSmooth = 3) {
    const raw = new Array(b.length).fill(null);
    for (let i = n - 1; i < b.length; i++) {
      let hi = -Infinity, lo = Infinity;
      for (let k = i - n + 1; k <= i; k++) { if (b[k].h > hi) hi = b[k].h; if (b[k].l < lo) lo = b[k].l; }
      raw[i] = hi === lo ? 50 : (b[i].c - lo) / (hi - lo) * 100;
    }
    const k = sma(raw, kSmooth);
    return { k, d: sma(k, dSmooth) };
  }

  function obv(b) {
    const out = new Array(b.length).fill(null);
    let v = 0;
    for (let i = 0; i < b.length; i++) {
      if (i > 0) v += b[i].c > b[i - 1].c ? (b[i].v || 0) : b[i].c < b[i - 1].c ? -(b[i].v || 0) : 0;
      out[i] = v;
    }
    return out;
  }

  function adx(b, n = 14) {
    const pdm = [null], ndm = [null];
    for (let i = 1; i < b.length; i++) {
      const upM = b[i].h - b[i - 1].h, dnM = b[i - 1].l - b[i].l;
      pdm.push(upM > dnM && upM > 0 ? upM : 0);
      ndm.push(dnM > upM && dnM > 0 ? dnM : 0);
    }
    const tr = trueRange(b).map((v, i) => (i === 0 ? null : v));
    const str = rma(tr, n), sp = rma(pdm, n), sn = rma(ndm, n);
    const pdi = str.map((t, i) => (t == null || !t ? null : 100 * sp[i] / t));
    const ndi = str.map((t, i) => (t == null || !t ? null : 100 * sn[i] / t));
    const dx = pdi.map((p, i) => (p == null || ndi[i] == null || p + ndi[i] === 0 ? null : 100 * Math.abs(p - ndi[i]) / (p + ndi[i])));
    return { adx: rma(dx, n), plusDI: pdi, minusDI: ndi };
  }

  function heikinAshi(b) {
    const out = [];
    for (let i = 0; i < b.length; i++) {
      const x = b[i], c = (x.o + x.h + x.l + x.c) / 4;
      const o = i === 0 ? (x.o + x.c) / 2 : (out[i - 1].o + out[i - 1].c) / 2;
      out.push({ t: x.t, o, h: Math.max(x.h, o, c), l: Math.min(x.l, o, c), c, v: x.v });
    }
    return out;
  }

  function anchoredVwap(b, from) {
    const out = new Array(b.length).fill(null);
    let pv = 0, vv = 0;
    for (let i = Math.max(0, from); i < b.length; i++) {
      const tp = (b[i].h + b[i].l + b[i].c) / 3, v = b[i].v || 0;
      pv += tp * v; vv += v; out[i] = vv > 0 ? pv / vv : tp;
    }
    return out;
  }

  return { sma, ema, rma, stdev, bollinger, trueRange, atr, keltner, donchian, supertrend, vwap, rsi, macd, stoch, obv, adx, heikinAshi, anchoredVwap };
});
