'use strict';
// Dividends: income received (gross, withholding tax, net), forward income from
// current holdings, and upcoming ex-dividend / earnings dates.
//
// Withholding: IBKR statements record the tax actually withheld (used as-is).
// Otherwise a per-market rate is assumed. Defaults are for a Singapore tax
// resident (no US treaty, so US dividends lose 30%); change them with the
// WHT command, e.g. `WHT US 15` if you hold a W-8BEN treaty rate.
const { getFxRate, getQuotes, getQuoteDetails, getDividendHistory } = require('./market');
const { loadPortfolio, savePortfolio, viewPositions, viewDividends, withLock } = require('./store');

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_WHT = { US: 30, SG: 0, HK: 0, UK: 0, EU: 15, JP: 15.315, AU: 0, CA: 25, OTHER: 0 };
const SUFFIX_MARKET = {
  SI: 'SG', HK: 'HK', L: 'UK', DE: 'EU', PA: 'EU', AS: 'EU', MI: 'EU', MC: 'EU', SW: 'EU', BR: 'EU',
  T: 'JP', AX: 'AU', TO: 'CA', V: 'CA',
};
function marketOf(symbol) {
  const m = String(symbol || '').toUpperCase().match(/\.([A-Z]+)$/);
  if (!m) return 'US';
  return SUFFIX_MARKET[m[1]] || 'OTHER';
}
function whtRates(settings) {
  return { ...DEFAULT_WHT, ...((settings && settings.withholding) || {}) };
}
// { gross, tax, net, rate, actual } in the dividend's own currency.
function dividendNet(d, settings) {
  const gross = Number(d.amount) || 0;
  if (d.tax != null && Number.isFinite(Number(d.tax))) {
    const tax = Math.abs(Number(d.tax));
    return { gross, tax, net: gross - tax, rate: gross ? (tax / gross) * 100 : 0, actual: true };
  }
  const rate = whtRates(settings)[marketOf(d.symbol)] ?? 0;
  const tax = gross * rate / 100;
  return { gross, tax, net: gross - tax, rate, actual: false };
}

function setWithholding(market, pct) {
  market = String(market || '').toUpperCase();
  if (!(market in DEFAULT_WHT)) throw new Error(`Market must be one of ${Object.keys(DEFAULT_WHT).join(', ')}`);
  const v = Number(pct);
  if (!(v >= 0 && v <= 100)) throw new Error('Rate must be 0–100 (%)');
  return withLock(() => {
    const p = loadPortfolio();
    p.settings.withholding = { ...(p.settings.withholding || {}), [market]: v };
    savePortfolio(p);
    return whtRates(p.settings);
  });
}

// Estimated next ex-date from the payment cadence (median gap of recent ex-dates).
function estimateNextEx(history, now = Date.now()) {
  if (!history || history.length < 2) return null;
  const recent = history.slice(-6);
  const gaps = recent.slice(1).map((d, i) => d.t - recent[i].t).sort((a, b) => a - b);
  const gap = gaps[Math.floor(gaps.length / 2)];
  if (!(gap > 20 * DAY_MS)) return null;
  const last = recent[recent.length - 1];
  if (now - last.t > 2 * gap + 30 * DAY_MS) return null; // looks like it stopped paying
  let next = last.t + gap;
  while (next < now - DAY_MS) next += gap;
  return { t: next, amount: last.amount, gapDays: Math.round(gap / DAY_MS) };
}
function trailingPerShare(history, now = Date.now()) {
  return (history || []).filter((d) => d.t > now - 365 * DAY_MS).reduce((s, d) => s + d.amount, 0);
}

async function dividendsReport(base, accountId) {
  base = (base || 'SGD').toUpperCase();
  const p = loadPortfolio();
  const settings = p.settings;
  const divs = viewDividends(p, accountId);
  const positions = viewPositions(p, accountId);
  const fx = {};
  const rate = async (c) => {
    c = (c || 'USD').toUpperCase();
    if (fx[c] == null) { try { fx[c] = await getFxRate(c, base); } catch { fx[c] = 1; } }
    return fx[c];
  };

  // ---- received ----
  const yearAgo = Date.now() - 365 * DAY_MS;
  const sum = () => ({ gross: 0, tax: 0, net: 0 });
  const total = sum(), ttm = sum(), bySym = {};
  const recent = [];
  for (const d of divs) {
    const k = await rate(d.currency);
    const n = dividendNet(d, settings);
    const g = n.gross * k, t = n.tax * k, net = n.net * k;
    total.gross += g; total.tax += t; total.net += net;
    const ms = Date.parse(d.date);
    if (Number.isFinite(ms) && ms >= yearAgo) { ttm.gross += g; ttm.tax += t; ttm.net += net; }
    const s = bySym[d.symbol] || (bySym[d.symbol] = { symbol: d.symbol, ...sum() });
    s.gross += g; s.tax += t; s.net += net;
    recent.push({ ...d, baseAmount: g, baseTax: t, baseNet: net, whtRate: n.rate, whtActual: n.actual });
  }
  recent.sort((a, b) => (a.date < b.date ? 1 : -1));

  // ---- forward income from current holdings ----
  const syms = positions.map((x) => x.symbol);
  let details = {};
  try { details = await getQuoteDetails(syms); } catch {}
  const quotes = syms.length ? await getQuotes(syms) : [];
  const qmap = Object.fromEntries(quotes.map((q) => [q.symbol.toUpperCase(), q]));
  const hist = await Promise.all(syms.map((s) => getDividendHistory(s).catch(() => [])));
  const fwdTotal = sum();
  const forward = [];
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    const S = pos.symbol.toUpperCase();
    const det = details[S] || {};
    const trailing = trailingPerShare(hist[i]);
    const perShare = det.dividendRate ?? (trailing || null); // forward rate if Yahoo has it, else last 12 months
    if (!perShare) continue;
    const ccy = (qmap[S]?.currency || pos.currency || 'USD').toUpperCase();
    const k = await rate(ccy);
    const n = dividendNet({ symbol: S, amount: perShare * pos.quantity }, settings);
    const price = qmap[S]?.price;
    const est = estimateNextEx(hist[i]);
    const exKnown = det.exDividendDate && det.exDividendDate > Date.now() - DAY_MS ? det.exDividendDate : null;
    forward.push({
      symbol: pos.symbol, currency: ccy, perShare, source: det.dividendRate != null ? 'forward' : 'trailing',
      annualGross: n.gross * k, annualTax: n.tax * k, annualNet: n.net * k, whtRate: n.rate,
      yieldOnCost: pos.avgCost ? (perShare / pos.avgCost) * 100 : null,
      currentYield: price ? (perShare / price) * 100 : null,
      nextEx: exKnown || est?.t || null, nextExEstimated: !exKnown && !!est,
      nextPay: det.dividendDate && det.dividendDate > Date.now() - DAY_MS ? det.dividendDate : null,
    });
    fwdTotal.gross += n.gross * k; fwdTotal.tax += n.tax * k; fwdTotal.net += n.net * k;
  }
  forward.sort((a, b) => b.annualNet - a.annualNet);

  return {
    base, account: accountId || p.activeId, count: divs.length,
    total: total.gross, ttm: ttm.gross, // kept for older clients
    received: { total, ttm }, bySymbol: Object.values(bySym).sort((a, b) => b.gross - a.gross), recent: recent.slice(0, 15),
    forward, forwardTotal: fwdTotal, withholding: whtRates(settings),
  };
}

// Upcoming earnings and ex-dividend dates for holdings + watchlist (next 60 days).
async function upcomingEvents(accountId) {
  const p = loadPortfolio();
  const held = new Set(viewPositions(p, accountId).map((x) => x.symbol.toUpperCase()));
  const syms = [...new Set([...held, ...p.watchlist.map((s) => s.toUpperCase())])]
    .filter((s) => !/[=^]/.test(s) && !/-USD$/.test(s)); // skip FX, indices, crypto
  if (!syms.length) return { events: [], ok: true };
  let details = {}, ok = true;
  try { details = await getQuoteDetails(syms); } catch { ok = false; }
  const now = Date.now(), horizon = now + 60 * DAY_MS;
  const events = [];
  const hist = await Promise.all(syms.map((s) => getDividendHistory(s).catch(() => [])));
  syms.forEach((s, i) => {
    const d = details[s] || {};
    if (d.earningsStart && d.earningsStart > now - DAY_MS && d.earningsStart < horizon) {
      events.push({ symbol: s, kind: 'EARNINGS', t: d.earningsStart, estimated: !!d.earningsEstimated, held: held.has(s) });
    }
    const exKnown = d.exDividendDate && d.exDividendDate > now - DAY_MS ? d.exDividendDate : null;
    const est = exKnown ? null : estimateNextEx(hist[i], now);
    const ex = exKnown || est?.t;
    if (ex && ex < horizon) {
      events.push({ symbol: s, kind: 'EX-DIV', t: ex, estimated: !exKnown, amount: est?.amount ?? null, held: held.has(s) });
    }
  });
  events.sort((a, b) => a.t - b.t);
  return { events, ok };
}

module.exports = {
  DEFAULT_WHT, marketOf, whtRates, dividendNet, setWithholding, estimateNextEx, trailingPerShare,
  dividendsReport, upcomingEvents,
};
