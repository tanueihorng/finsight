'use strict';
// Return math — pure functions, no I/O (covered by test/returns.test.js).

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365.25 * DAY_MS;

// One period's return with external cash flows (modified Dietz, daily form).
// Inflows are assumed to arrive at the start of the period (they were at risk
// for it), outflows at the end (they left after it), so a full sell-out can't
// shrink the denominator to ~0 and explode the return.
//   prev    value at the end of the previous period (after its flows)
//   value   value at the end of this period (after this period's flows)
//   inflow  money added this period (>= 0)     outflow  money taken out (>= 0)
//   income  dividends paid out this period (>= 0; part of the return)
function periodReturn(prev, value, inflow = 0, outflow = 0, income = 0) {
  const denom = prev + inflow;
  if (!(denom > 1e-9)) return 0;
  return (value - prev - inflow + outflow + income) / denom;
}

// Chain period returns into a cumulative time-weighted return (fraction).
function chainReturns(returns) {
  let g = 1;
  for (const r of returns) g *= 1 + r;
  return g - 1;
}

// Annualise a cumulative return over a span in ms. Spans under a year are
// returned as-is (annualising a few weeks produces silly numbers).
function annualize(cumulative, spanMs) {
  if (cumulative == null || !(spanMs > 0)) return null;
  const years = spanMs / YEAR_MS;
  if (years < 1) return cumulative;
  if (cumulative <= -1) return -1;
  return Math.pow(1 + cumulative, 1 / years) - 1;
}

// Money-weighted return (XIRR): the annual rate r that makes the NPV of the
// dated cash flows zero. flows = [{ t: ms, amount }]; negative = money you put
// in, positive = money you got back (sales, dividends, final value).
// Returns null when there's no sign change (no solution exists).
function xirr(flows) {
  const fs = flows.filter((f) => Number.isFinite(f.amount) && f.amount !== 0 && Number.isFinite(f.t));
  if (fs.length < 2) return null;
  if (!fs.some((f) => f.amount < 0) || !fs.some((f) => f.amount > 0)) return null;
  const t0 = Math.min(...fs.map((f) => f.t));
  const yrs = fs.map((f) => (f.t - t0) / YEAR_MS);
  const npv = (r) => fs.reduce((s, f, i) => s + f.amount / Math.pow(1 + r, yrs[i]), 0);
  const dnpv = (r) => fs.reduce((s, f, i) => s - (yrs[i] * f.amount) / Math.pow(1 + r, yrs[i] + 1), 0);

  // Newton from a sensible guess; fall back to bisection if it wanders off.
  let r = 0.1;
  for (let i = 0; i < 50; i++) {
    const v = npv(r), d = dnpv(r);
    if (!Number.isFinite(v) || !Number.isFinite(d) || d === 0) break;
    const next = r - v / d;
    if (!(next > -0.9999)) break;
    if (Math.abs(next - r) < 1e-10) return next;
    r = next;
  }
  let lo = -0.9999, hi = 10;
  let flo = npv(lo), fhi = npv(hi);
  if (!Number.isFinite(flo) || !Number.isFinite(fhi) || flo * fhi > 0) return null;
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2, fm = npv(mid);
    if (Math.abs(fm) < 1e-9 || hi - lo < 1e-12) return mid;
    if (flo * fm < 0) { hi = mid; fhi = fm; } else { lo = mid; flo = fm; }
  }
  return (lo + hi) / 2;
}

module.exports = { DAY_MS, YEAR_MS, periodReturn, chainReturns, annualize, xirr };
