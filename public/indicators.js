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

  function rollHigh(b, n) {
    const out = new Array(b.length).fill(null);
    for (let i = n - 1; i < b.length; i++) { let hi = -Infinity; for (let k = i - n + 1; k <= i; k++) if (b[k].h > hi) hi = b[k].h; out[i] = hi; }
    return out;
  }
  function rollLow(b, n) {
    const out = new Array(b.length).fill(null);
    for (let i = n - 1; i < b.length; i++) { let lo = Infinity; for (let k = i - n + 1; k <= i; k++) if (b[k].l < lo) lo = b[k].l; out[i] = lo; }
    return out;
  }

  // Ichimoku Kinko Hyo. Spans A/B are displaced `disp` bars forward, so they are
  // `disp` longer than the input (the projected cloud); the lagging span is
  // the close plotted `disp` bars back.
  function ichimoku(b, conv = 9, base = 26, spanB = 52, disp = 26) {
    const mid = (n) => { const h = rollHigh(b, n), l = rollLow(b, n); return h.map((v, i) => (v == null ? null : (v + l[i]) / 2)); };
    const tenkan = mid(conv), kijun = mid(base), sb = mid(spanB), n = b.length;
    const spanA = new Array(n + disp).fill(null), spanBo = new Array(n + disp).fill(null), lag = new Array(n).fill(null);
    for (let i = 0; i < n; i++) {
      if (tenkan[i] != null && kijun[i] != null) spanA[i + disp] = (tenkan[i] + kijun[i]) / 2;
      if (sb[i] != null) spanBo[i + disp] = sb[i];
      if (i - disp >= 0) lag[i - disp] = b[i].c;
    }
    return { conv: tenkan, base: kijun, spanA, spanB: spanBo, lagging: lag };
  }

  // Parabolic SAR (Wilder): start/step acceleration `step`, cap `max`.
  function psar(b, step = 0.02, max = 0.2) {
    const out = new Array(b.length).fill(null), dir = new Array(b.length).fill(null);
    if (b.length < 2) return { sar: out, dir };
    let up = b[1].c >= b[0].c, af = step, ep = up ? Math.max(b[0].h, b[1].h) : Math.min(b[0].l, b[1].l);
    let sar = up ? Math.min(b[0].l, b[1].l) : Math.max(b[0].h, b[1].h);
    out[1] = sar; dir[1] = up ? 1 : -1;
    for (let i = 2; i < b.length; i++) {
      sar = sar + af * (ep - sar);
      if (up) {
        sar = Math.min(sar, b[i - 1].l, b[i - 2].l);
        if (b[i].l < sar) { up = false; sar = ep; ep = b[i].l; af = step; }
        else if (b[i].h > ep) { ep = b[i].h; af = Math.min(max, af + step); }
      } else {
        sar = Math.max(sar, b[i - 1].h, b[i - 2].h);
        if (b[i].h > sar) { up = true; sar = ep; ep = b[i].h; af = step; }
        else if (b[i].l < ep) { ep = b[i].l; af = Math.min(max, af + step); }
      }
      out[i] = sar; dir[i] = up ? 1 : -1;
    }
    return { sar: out, dir };
  }

  // Commodity Channel Index on the typical price (mean absolute deviation).
  function cci(b, n = 20) {
    const tp = b.map((x) => (x.h + x.l + x.c) / 3), m = sma(tp, n), out = new Array(b.length).fill(null);
    for (let i = n - 1; i < b.length; i++) {
      if (m[i] == null) continue;
      let d = 0; for (let k = i - n + 1; k <= i; k++) d += Math.abs(tp[k] - m[i]);
      d /= n; out[i] = d === 0 ? 0 : (tp[i] - m[i]) / (0.015 * d);
    }
    return out;
  }

  // Money Flow Index: volume-weighted RSI of the typical price.
  function mfi(b, n = 14) {
    const tp = b.map((x) => (x.h + x.l + x.c) / 3), out = new Array(b.length).fill(null);
    for (let i = n; i < b.length; i++) {
      let pos = 0, neg = 0;
      for (let k = i - n + 1; k <= i; k++) { const f = tp[k] * (b[k].v || 0); if (tp[k] > tp[k - 1]) pos += f; else if (tp[k] < tp[k - 1]) neg += f; }
      out[i] = neg === 0 ? (pos === 0 ? 50 : 100) : 100 - 100 / (1 + pos / neg);
    }
    return out;
  }

  // Williams %R: 0 at the n-bar high, -100 at the n-bar low.
  function willr(b, n = 14) {
    const h = rollHigh(b, n), l = rollLow(b, n);
    return b.map((x, i) => (h[i] == null ? null : h[i] === l[i] ? -50 : (h[i] - x.c) / (h[i] - l[i]) * -100));
  }

  // Rolling n-bar high/low band (52-week on daily bars with n = 252).
  function hiLo(b, n = 252) { return { upper: rollHigh(b, n), lower: rollLow(b, n) }; }

  // Standard floor pivots from the previous completed period. periodOf(t) returns
  // a key that changes when a new period starts (day / week / month / year).
  function pivots(b, periodOf) {
    const keys = ['p', 'r1', 'r2', 'r3', 's1', 's2', 's3'], out = {};
    keys.forEach((k) => { out[k] = new Array(b.length).fill(null); });
    let cur = null, h = -Infinity, l = Infinity, c = null, lv = null;
    for (let i = 0; i < b.length; i++) {
      const key = periodOf(b[i].t);
      if (key !== cur) {
        if (cur !== null && c != null) {
          const p = (h + l + c) / 3;
          lv = { p, r1: 2 * p - l, s1: 2 * p - h, r2: p + (h - l), s2: p - (h - l), r3: h + 2 * (p - l), s3: l - 2 * (h - p) };
        }
        cur = key; h = -Infinity; l = Infinity;
      }
      if (b[i].h > h) h = b[i].h; if (b[i].l < l) l = b[i].l; c = b[i].c;
      if (lv) keys.forEach((k) => { out[k][i] = lv[k]; });
    }
    return out;
  }

  // As-of join: for each bar of `b`, the close of the last `other` bar at or
  // before it (never a later one), or null before `other` starts.
  function asOf(b, other) {
    const out = new Array(b.length).fill(null);
    let j = -1;
    for (let i = 0; i < b.length; i++) {
      while (j + 1 < other.length && other[j + 1].t <= b[i].t) j++;
      if (j >= 0 && nz(other[j].c)) out[i] = other[j].c;
    }
    return out;
  }

  // Relative strength (comparative): close / benchmark close, rebased to 100 at the first common bar.
  function relStrength(b, bench) {
    const bc = asOf(b, bench), out = new Array(b.length).fill(null);
    let base = null;
    for (let i = 0; i < b.length; i++) {
      if (bc[i] == null || !bc[i] || !nz(b[i].c)) continue;
      const r = b[i].c / bc[i];
      if (base == null) base = r;
      out[i] = r / base * 100;
    }
    return out;
  }

  // Volume profile over bars [i0, i1): each bar's volume is spread evenly over
  // the price rows its high-low range covers. Value area = smallest set of rows
  // around the point of control holding `vaPct` of the volume.
  function volumeProfile(b, i0, i1, rows = 24, vaPct = 0.7) {
    let lo = Infinity, hi = -Infinity;
    for (let i = i0; i < i1; i++) { if (b[i].l < lo) lo = b[i].l; if (b[i].h > hi) hi = b[i].h; }
    if (!isFinite(lo) || !isFinite(hi)) return null;
    if (hi === lo) { hi += Math.abs(hi) * 0.001 || 0.01; lo -= Math.abs(lo) * 0.001 || 0.01; }
    const step = (hi - lo) / rows, up = new Array(rows).fill(0), dn = new Array(rows).fill(0);
    let total = 0;
    for (let i = i0; i < i1; i++) {
      const x = b[i], v = x.v || 0; if (!v) continue;
      const r0 = Math.min(rows - 1, Math.floor((x.l - lo) / step)), r1 = Math.min(rows - 1, Math.floor((x.h - lo) / step));
      const share = v / (r1 - r0 + 1), isUp = x.c >= (x.o != null ? x.o : x.c);
      for (let r = r0; r <= r1; r++) { if (isUp) up[r] += share; else dn[r] += share; }
      total += v;
    }
    if (!total) return null;
    const tot = up.map((u, r) => u + dn[r]);
    let poc = 0; for (let r = 1; r < rows; r++) if (tot[r] > tot[poc]) poc = r;
    let a = poc, z = poc, acc = tot[poc];
    while (acc < total * vaPct && (a > 0 || z < rows - 1)) {
      const below = a > 0 ? tot[a - 1] : -1, above = z < rows - 1 ? tot[z + 1] : -1;
      if (above >= below) acc += tot[++z]; else acc += tot[--a];
    }
    return { lo, hi, step, up, dn, total, poc, vaLo: a, vaHi: z, pocPrice: lo + (poc + 0.5) * step, val: lo + a * step, vah: lo + (z + 1) * step };
  }

  return { sma, ema, rma, stdev, bollinger, trueRange, atr, keltner, donchian, supertrend, vwap, rsi, macd, stoch, obv, adx, heikinAshi, anchoredVwap,
    rollHigh, rollLow, ichimoku, psar, cci, mfi, willr, hiLo, pivots, asOf, relStrength, volumeProfile };
});
