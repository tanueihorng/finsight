'use strict';
// Portfolio performance from what you actually held on each day.
//
// Replays every BUY / SELL / DELETE in time order to rebuild holdings day by day,
// values them with historical prices AND historical FX (so currency moves show
// up), and treats buys and sells as cash flows rather than gains. From that:
//   - value over time vs net money invested
//   - time-weighted return (TWR): how the holdings did, independent of when
//     you added or withdrew money (compare this with an index)
//   - money-weighted return (XIRR): your personal annual return, timing included
//   - a benchmark: the index's TWR in your base currency, plus a "shadow"
//     portfolio that puts the same cash flows into the index on the same days.
// Holdings with no transaction history (legacy data, hand-edited files) are
// treated as held for the whole window and listed in `approx`. A buy whose price
// is outside that day's trading range (an average cost typed in or imported
// without a purchase date) enters at market value instead — we don't know when
// it was really bought, so its earlier gain isn't counted as return here.
// Those are listed in `transfers`.
const { getFxRate, getHistory, getQuote } = require('./market');
const { loadPortfolio, viewDividends } = require('./store');
const { DAY_MS, periodReturn, chainReturns, annualize, xirr } = require('./returns');

const RANGE_DAYS = { '1mo': 31, '3mo': 92, '6mo': 183, ytd: null, '1y': 366, '2y': 731, '5y': 1827, max: null };
// Smallest Yahoo range that covers a span of `days`.
const YAHOO_RANGES = [['1mo', 31], ['3mo', 92], ['6mo', 183], ['1y', 366], ['2y', 731], ['5y', 1827], ['10y', 3653], ['max', Infinity]];
function yahooRangeFor(days) { return YAHOO_RANGES.find(([, d]) => days <= d)[0]; }

const BENCHMARKS = {
  '^GSPC': 'S&P 500', '^IXIC': 'Nasdaq Composite', URTH: 'MSCI World (ETF)', '^STI': 'Straits Times Index',
  VT: 'FTSE All-World (ETF)', '^HSI': 'Hang Seng',
};

const dayKey = (t) => new Date(t).toISOString().slice(0, 10);

// Sorted [{ day, c }] -> lookup(day) returning the latest close on/before `day`
// (forward-fill), or the first close when `day` precedes the series.
function stepLookup(series) {
  return (day) => {
    if (!series.length) return null;
    let lo = 0, hi = series.length - 1, best = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (series[mid].day <= day) { best = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return series[best >= 0 ? best : 0].c;
  };
}
function toSeries(points) {
  const byDay = new Map();
  for (const p of points || []) if (p.c != null) byDay.set(dayKey(p.t), p); // last bar of a day wins
  return [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([day, p]) => ({ day, c: p.c, h: p.h ?? p.c, l: p.l ?? p.c }));
}
// Was `price` actually tradeable around `day`? Checks the bar on/before `day`
// and the next one (a back-dated buy may land on a weekend), with 3% slack.
function tradedNear(series, day, price) {
  if (!series.length || !(price > 0)) return true; // can't tell -> trust the entry
  let i = series.findIndex((x) => x.day > day);
  if (i < 0) i = series.length;
  const bars = series.slice(Math.max(0, i - 1), i + 1);
  const lo = Math.min(...bars.map((b) => b.l)), hi = Math.max(...bars.map((b) => b.h));
  return price >= lo * 0.97 && price <= hi * 1.03;
}

// Historical native->base FX as a lookup(day); falls back to today's spot.
async function fxLookup(from, base, yRange, interval) {
  from = (from || 'USD').toUpperCase();
  if (from === base) return () => 1;
  for (const [sym, inv] of [[`${from}${base}=X`, false], [`${base}${from}=X`, true]]) {
    try {
      const s = toSeries((await getHistory(sym, yRange, interval)).points).map((x) => ({ day: x.day, c: inv ? 1 / x.c : x.c }));
      if (s.length) return stepLookup(s);
    } catch {}
  }
  let spot = 1;
  try { spot = await getFxRate(from, base); } catch {}
  return () => spot;
}

// Transactions (+ reconciliation openings) for the accounts in view, oldest first.
function collectEvents(p, accountId) {
  const id = accountId || p.activeId;
  const accounts = id === 'ALL' ? p.accounts : [p.accounts.find((a) => a.id === id) || p.accounts[0]].filter(Boolean);
  const events = [], approx = new Set(), currency = {};
  for (const a of accounts) {
    for (const pos of a.positions) currency[pos.symbol.toUpperCase()] = (pos.currency || 'USD').toUpperCase();
    const txs = [...a.transactions].filter((t) => Number.isFinite(t.time)).sort((x, y) => x.time - y.time);
    const held = {};
    for (const t of txs) {
      const sym = String(t.symbol || '').toUpperCase();
      if (!sym) continue;
      if (t.currency) currency[sym] = currency[sym] || String(t.currency).toUpperCase();
      const key = a.id + '|' + sym;
      if (t.type === 'BUY' && t.quantity > 0) {
        events.push({ t: t.time, key, sym, dq: t.quantity, price: t.price, kind: 'BUY' });
        held[key] = (held[key] || 0) + t.quantity;
      } else if (t.type === 'SELL' && t.quantity > 0) {
        events.push({ t: t.time, key, sym, dq: -t.quantity, price: t.price, kind: 'SELL' });
        held[key] = (held[key] || 0) - t.quantity;
      } else if (t.type === 'DELETE') {
        events.push({ t: t.time, key, sym, dq: null, kind: 'DELETE' }); // qty resolved during replay
        held[key] = 0;
      }
    }
    // The history must end at today's actual holdings. Anything it can't explain
    // (no transactions recorded) becomes an opening balance held all along.
    const cur = {};
    for (const pos of a.positions) cur[a.id + '|' + pos.symbol.toUpperCase()] = { sym: pos.symbol.toUpperCase(), q: pos.quantity };
    for (const k of new Set([...Object.keys(cur), ...Object.keys(held)])) {
      const diff = (cur[k]?.q || 0) - (held[k] || 0);
      if (Math.abs(diff) > 1e-6) {
        const sym = cur[k]?.sym || k.split('|').slice(1).join('|');
        events.push({ t: -Infinity, key: k, sym, dq: diff, kind: 'OPEN' });
        approx.add(sym);
      }
    }
  }
  events.sort((x, y) => x.t - y.t);
  const dividends = viewDividends(p, accountId)
    .map((d) => ({ t: Date.parse(d.date), sym: String(d.symbol).toUpperCase(), amount: Number(d.amount), currency: (d.currency || 'USD').toUpperCase() }))
    .filter((d) => Number.isFinite(d.t) && Number.isFinite(d.amount));
  return { events, approx: [...approx], currency, dividends };
}

async function portfolioPerformance(range, base, accountId, benchmark) {
  base = (base || 'SGD').toUpperCase();
  range = RANGE_DAYS[range] !== undefined ? range : '1y';
  benchmark = benchmark === 'none' ? null : (benchmark || '^GSPC');
  const now = Date.now();
  const p = loadPortfolio();
  const { events, approx, currency, dividends } = collectEvents(p, accountId);
  const empty = { range, base, points: [], changePct: null, twr: null, xirr: null, approx, benchmark: null };
  if (!events.length) return empty;

  // Window: the requested range, clipped to when you started (unless some
  // holdings are openings with unknown dates — those need the full range).
  const firstReal = events.find((e) => e.t > -Infinity)?.t ?? now;
  const hasOpenings = events.some((e) => e.t === -Infinity);
  let startMs;
  if (range === 'max') startMs = hasOpenings ? now - 5 * 365 * DAY_MS : firstReal;
  else if (range === 'ytd') startMs = Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
  else startMs = now - RANGE_DAYS[range] * DAY_MS;
  if (!hasOpenings) startMs = Math.max(startMs, firstReal - DAY_MS);
  const spanDays = Math.ceil((now - startMs) / DAY_MS) + 7;
  const yRange = yahooRangeFor(spanDays);
  const interval = spanDays > 800 ? '1wk' : '1d';
  const startDay = dayKey(startMs);

  // Price + FX series for every symbol held at any point in the window.
  const syms = [...new Set(events.map((e) => e.sym))];
  const priceOf = {}, missing = [];
  await Promise.all(syms.map(async (s) => {
    try {
      const series = toSeries((await getHistory(s, yRange, interval)).points);
      if (series.length) { priceOf[s] = stepLookup(series); priceOf[s].series = series; return; }
    } catch {}
    // No history: hold at the latest known price so the position isn't dropped.
    let px = null;
    try { px = (await getQuote(s)).price; } catch {}
    if (px == null) px = [...events].reverse().find((e) => e.sym === s && e.price != null)?.price ?? 0;
    priceOf[s] = () => px; priceOf[s].series = [];
    missing.push(s);
  }));
  const ccys = new Set([...syms.map((s) => currency[s] || 'USD'), ...dividends.map((d) => d.currency)]);
  const fxOf = {};
  await Promise.all([...ccys].map(async (c) => { fxOf[c] = await fxLookup(c, base, yRange, interval); }));

  let bench = null;
  if (benchmark) {
    try {
      const h = await getHistory(benchmark, yRange, interval);
      const bs = toSeries(h.points);
      const bccy = (h.meta?.currency || 'USD').toUpperCase();
      if (!fxOf[bccy]) fxOf[bccy] = await fxLookup(bccy, base, yRange, interval);
      if (bs.length) bench = { symbol: benchmark, name: BENCHMARKS[benchmark] || h.meta?.name || benchmark, px: stepLookup(bs), ccy: bccy };
    } catch {}
  }
  const benchBase = (day) => bench.px(day) * fxOf[bench.ccy](day);

  // Timeline = every trading day any held symbol printed a bar in the window.
  const daySet = new Set();
  for (const s of syms) for (const x of priceOf[s].series) if (x.day >= startDay) daySet.add(x.day);
  if (!daySet.size) daySet.add(dayKey(now));
  const days = [...daySet].sort();

  const qty = {}; // key -> quantity
  const transfers = new Set();
  const symOfKey = {};
  const valueOn = (day) => {
    let v = 0;
    for (const [k, q] of Object.entries(qty)) {
      if (q <= 1e-12) continue;
      const s = symOfKey[k];
      v += q * priceOf[s](day) * fxOf[currency[s] || 'USD'](day);
    }
    return v;
  };
  // Apply one event on `day`; returns the base-currency cash flow (+ in, - out).
  const apply = (e, day, opening = false) => {
    symOfKey[e.key] = e.sym;
    const fx = fxOf[currency[e.sym] || 'USD'](day);
    const cur = qty[e.key] || 0;
    if (e.kind === 'BUY' && !opening && !tradedNear(priceOf[e.sym].series, dayKey(e.t), e.price)) {
      qty[e.key] = cur + e.dq;
      transfers.add(e.sym);
      return e.dq * priceOf[e.sym](day) * fx; // transfer-in at market value
    }
    if (e.kind === 'DELETE') {
      qty[e.key] = 0;
      return -cur * priceOf[e.sym](day) * fx; // stopped tracking: leaves at market value
    }
    qty[e.key] = cur + e.dq;
    if (e.kind === 'OPEN') return 0;
    return e.dq * e.price * fx; // BUY > 0, SELL < 0
  };

  // Everything before the window builds the opening book (no flows counted).
  let ei = 0;
  while (ei < events.length && events[ei].t < startMs) { apply(events[ei], days[0], true); ei++; }
  const t0 = Date.parse(days[0] + 'T00:00:00Z');
  const tEnd = Date.parse(days[days.length - 1] + 'T00:00:00Z');
  const clampT = (t) => Math.min(tEnd, Math.max(t0, t));
  let di = 0;
  const divs = dividends.filter((d) => d.t >= startMs).sort((a, b) => a.t - b.t);

  const startValue = valueOn(days[0]);
  let prev = startValue, invested = startValue;
  let benchUnits = bench && startValue > 0 ? startValue / benchBase(days[0]) : 0;
  const rets = [], points = [];
  const cash = startValue > 0 ? [{ t: t0, amount: -startValue }] : [];
  let totalIn = 0, totalOut = 0, totalIncome = 0;

  for (let i = 0; i < days.length; i++) {
    const day = days[i];
    const isLast = i === days.length - 1;
    let inflow = 0, outflow = 0, income = 0;
    // Events up to and including this bar's day (the last bar absorbs anything newer).
    while (ei < events.length && (isLast || dayKey(events[ei].t) <= day)) {
      const f = apply(events[ei], day);
      if (f > 0) inflow += f; else outflow -= f;
      if (bench && f) benchUnits = Math.max(0, benchUnits + f / benchBase(day));
      if (f) cash.push({ t: clampT(events[ei].t), amount: -f });
      ei++;
    }
    while (di < divs.length && (isLast || dayKey(divs[di].t) <= day)) {
      const d = divs[di++];
      const amt = d.amount * fxOf[d.currency](day);
      income += amt;
      cash.push({ t: clampT(d.t), amount: amt });
    }
    const value = valueOn(day);
    rets.push(periodReturn(prev, value, inflow, outflow, income));
    totalIn += inflow; totalOut += outflow; totalIncome += income;
    invested += inflow - outflow;
    prev = value;
    points.push({ t: Date.parse(day + 'T00:00:00Z'), value, invested, bench: bench ? benchUnits * benchBase(day) : null });
  }

  const endValue = prev;
  const spanMs = tEnd - t0;
  const twr = chainReturns(rets);
  if (endValue > 0) cash.push({ t: tEnd, amount: endValue });
  const mwr = xirr(cash);
  const benchTwr = bench ? benchBase(days[days.length - 1]) / benchBase(days[0]) - 1 : null;
  const gain = endValue - startValue - totalIn + totalOut + totalIncome; // money made, in base

  return {
    range, base, interval, points,
    start: startValue, end: endValue,
    netInvested: totalIn - totalOut, totalIn, totalOut, income: totalIncome, gain,
    twr: twr * 100, twrAnnual: (annualize(twr, spanMs) ?? 0) * 100,
    xirr: mwr == null ? null : mwr * 100,                           // annualised
    mwr: mwr == null ? null : (Math.pow(1 + mwr, spanMs / (365.25 * DAY_MS)) - 1) * 100, // same, over the window
    spanDays: Math.round(spanMs / DAY_MS),
    changePct: twr * 100, // kept for older clients: headline % = TWR
    benchmark: bench ? {
      symbol: bench.symbol, name: bench.name, twr: benchTwr * 100, twrAnnual: (annualize(benchTwr, spanMs) ?? 0) * 100,
      shadowEnd: points[points.length - 1].bench,
    } : null,
    approx, missing, transfers: [...transfers],
  };
}

module.exports = { portfolioPerformance, collectEvents, BENCHMARKS };
