'use strict';
// Pure helpers for chart alerts: the value of a drawn line at the latest bar
// and indicator readings. Lines are measured in bar-index space, exactly as
// the chart draws them (public/chart.js idxOfTime), so an alert fires where
// the line is on screen rather than at a calendar-time interpolation.
const I = require('../public/indicators.js');

function medianStep(bars) {
  const n = bars.length;
  if (n < 2) return 86400000;
  const steps = [];
  for (let i = Math.max(1, n - 20); i < n; i++) steps.push(bars[i].t - bars[i - 1].t);
  steps.sort((a, b) => a - b);
  return steps[steps.length >> 1] || 86400000;
}

// Fractional bar index of a timestamp, extrapolated outside the data.
function idxOfTime(bars, t) {
  const n = bars.length;
  if (!n) return 0;
  if (t <= bars[0].t) return (t - bars[0].t) / medianStep(bars);
  if (t >= bars[n - 1].t) return (n - 1) + (t - bars[n - 1].t) / medianStep(bars);
  let lo = 0, hi = n - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (bars[mid].t <= t) lo = mid; else hi = mid - 1; }
  return lo + (t - bars[lo].t) / ((bars[lo + 1].t - bars[lo].t) || 1);
}

// Price of the line through pts[0], pts[1] at the latest bar (extended forward).
// Log-scale charts draw straight lines in log space; `log` follows that.
function lineValueNow(bars, pts, log) {
  if (!bars.length || !pts || pts.length < 2) return null;
  const i0 = idxOfTime(bars, pts[0].t), i1 = idxOfTime(bars, pts[1].t), k = bars.length - 1;
  if (Math.abs(i1 - i0) < 1e-9) return null;
  const f = log ? Math.log : (v) => v, finv = log ? Math.exp : (v) => v;
  if (log && (pts[0].p <= 0 || pts[1].p <= 0)) return null;
  const slope = (f(pts[1].p) - f(pts[0].p)) / (i1 - i0);
  return finv(f(pts[0].p) + slope * (k - i0));
}

const IND_TYPES = { rsi: 'RSI', sma: 'SMA', ema: 'EMA', mfi: 'MFI', cci: 'CCI', willr: '%R' };

// Latest reading of an indicator alert's series.
function indicatorNow(bars, type, length) {
  if (!bars.length) return null;
  const n = Math.max(1, Math.min(500, Math.round(length) || 14));
  let s;
  if (type === 'rsi') s = I.rsi(bars, n);
  else if (type === 'sma') s = I.sma(bars.map((b) => b.c), n);
  else if (type === 'ema') s = I.ema(bars.map((b) => b.c), n);
  else if (type === 'mfi') s = I.mfi(bars, n);
  else if (type === 'cci') s = I.cci(bars, n);
  else if (type === 'willr') s = I.willr(bars, n);
  else return null;
  const v = s[s.length - 1];
  return v == null || !isFinite(v) ? null : v;
}

// sma/ema compare the live price with the average; the others compare the
// oscillator with a fixed level.
const isPriceVsAverage = (type) => type === 'sma' || type === 'ema';

module.exports = { idxOfTime, lineValueNow, indicatorNow, isPriceVsAverage, IND_TYPES };
