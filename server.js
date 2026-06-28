'use strict';
/*
 * FINSIGHT // PERSONAL TERMINAL  -  backend
 * ----------------------------------------------------------------------------
 * Zero-dependency Node.js server (built-in http + native fetch, Node 18+).
 *   - Proxies FREE, no-key data sources (Yahoo Finance, World Bank, FRED)
 *   - Stores your portfolio locally in data/portfolio.json
 *   - Serves the terminal UI from public/
 *
 * Run:   node server.js          then open http://localhost:8000
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');
const { execFile } = require('child_process');
const crypto = require('crypto');

const PORT = process.env.PORT || 8000;
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, 'public');
const DATA_DIR = path.join(ROOT, 'data');
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio.json');

// NOTE: a "rich" desktop Chrome UA triggers Yahoo bot-detection (HTTP 429) from
// server-side fetch. A minimal UA is accepted. Keep this simple.
const UA = 'Mozilla/5.0';

// --------------------------------------------------------------------------
// Tiny in-memory cache so we don't hammer the upstream APIs while polling.
// --------------------------------------------------------------------------
const cache = new Map(); // key -> { at, ttl, value }
function cacheGet(key) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < hit.ttl) return hit.value;
  return null;
}
function cacheSet(key, value, ttl) {
  cache.set(key, { at: Date.now(), ttl, value });
  return value;
}

// --------------------------------------------------------------------------
// HTTP fetch helpers (with timeout + Yahoo host fallback)
// --------------------------------------------------------------------------
async function fetchJson(url, { timeout = 12000, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*', ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function yahooFetch(pathAndQuery) {
  // Try query1 then query2 for resilience.
  let lastErr;
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      return await fetchJson(`https://${host}${pathAndQuery}`);
    } catch (e) { lastErr = e; }
  }
  throw lastErr;
}

// --------------------------------------------------------------------------
// Market data: normalized quote / history / search via Yahoo chart endpoint
// --------------------------------------------------------------------------
function normalizeQuote(symbol, meta) {
  const price = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose != null ? meta.chartPreviousClose : meta.previousClose;
  const change = price != null && prev != null ? price - prev : null;
  const changePct = change != null && prev ? (change / prev) * 100 : null;
  return {
    symbol: meta.symbol || symbol,
    name: meta.longName || meta.shortName || meta.symbol || symbol,
    currency: meta.currency || 'USD',
    exchange: meta.fullExchangeName || meta.exchangeName || '',
    type: meta.instrumentType || '',
    price,
    prevClose: prev,
    change,
    changePct,
    dayHigh: meta.regularMarketDayHigh,
    dayLow: meta.regularMarketDayLow,
    weekHigh52: meta.fiftyTwoWeekHigh,
    weekLow52: meta.fiftyTwoWeekLow,
    volume: meta.regularMarketVolume,
    marketTime: meta.regularMarketTime ? meta.regularMarketTime * 1000 : null,
  };
}

async function getQuote(symbol) {
  const key = `q:${symbol}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const data = await yahooFetch(`/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`);
  const result = data?.chart?.result?.[0];
  if (!result?.meta) throw new Error(`No data for ${symbol}`);
  return cacheSet(key, normalizeQuote(symbol, result.meta), 15000);
}

async function getQuotes(symbols) {
  const out = await Promise.allSettled(symbols.map(getQuote));
  return out.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { symbol: symbols[i], error: String(r.reason && r.reason.message || r.reason) }
  );
}

// FX rate: how many units of `to` per 1 unit of `from` (e.g. USD->SGD ~ 1.29).
// Uses Yahoo FX pairs (FROMTO=X) with an inverse fallback. Free, no key.
async function getFxRate(from, to) {
  from = (from || 'USD').toUpperCase();
  to = (to || 'USD').toUpperCase();
  if (from === to) return 1;
  const key = `fx:${from}:${to}`;
  const cached = cacheGet(key);
  if (cached != null) return cached;
  try {
    const q = await getQuote(`${from}${to}=X`);
    if (q.price) return cacheSet(key, q.price, 60000);
  } catch {}
  try {
    const q = await getQuote(`${to}${from}=X`); // inverse pair
    if (q.price) return cacheSet(key, 1 / q.price, 60000);
  } catch {}
  throw new Error(`No FX rate ${from}->${to}`);
}

// Returns a function t(ms) -> USD->base rate at that time (weekly FX history).
// Buys within the last 7 days use the current rate so a fresh buy shows ~0 FX P&L.
async function usdToBaseAt(base) {
  base = (base || 'USD').toUpperCase();
  if (base === 'USD') return () => 1;
  let curRate = 1;
  try { curRate = await getFxRate('USD', base); } catch {}
  const key = `usdbaseseries:${base}`;
  let series = cacheGet(key);
  if (!series) {
    try {
      const h = await getHistory(`USD${base}=X`, '10y', '1wk'); // match fxRateAt's window
      series = (h.points || []).filter((pt) => pt.c != null).map((pt) => ({ t: pt.t, c: pt.c }));
    } catch { series = []; }
    cacheSet(key, series, 6 * 60 * 60000);
  }
  const recentMs = 7 * 24 * 60 * 60000;
  return (t) => {
    if (!t) return null;
    if (Date.now() - t < recentMs || !series.length) return curRate;
    let best = series[0].c;
    for (const pt of series) { if (pt.t <= t) best = pt.c; else break; }
    return best;
  };
}

// Historical FX rate: units of `to` per 1 `from`, on/just before timestamp t (ms).
// Used to record the true exchange rate for a back-dated / imported purchase.
async function fxRateAt(from, to, t) {
  from = (from || 'USD').toUpperCase();
  to = (to || 'USD').toUpperCase();
  if (from === to) return 1;
  if (!t || Date.now() - t < 5 * 24 * 60 * 60000) return getFxRate(from, to); // recent -> spot
  const day = new Date(t).toISOString().slice(0, 10);
  const key = `fxat:${from}:${to}:${day}`;
  const cached = cacheGet(key);
  if (cached != null) return cached;
  for (const [sym, inverse] of [[`${from}${to}=X`, false], [`${to}${from}=X`, true]]) {
    try {
      const h = await getHistory(sym, '10y', '1wk');
      const pts = (h.points || []).filter((p) => p.c != null);
      if (pts.length) {
        let best = pts[0].c;
        for (const p of pts) { if (p.t <= t) best = p.c; else break; }
        return cacheSet(key, inverse ? 1 / best : best, 24 * 60 * 60000);
      }
    } catch {}
  }
  return getFxRate(from, to); // fallback to spot
}

// Weekly FX volatility: stdev of weekly log-returns of `from`->`to` over 5y.
// Drives a simple 1-week parametric VaR. Free (Yahoo weekly history); cached 6h.
async function weeklyFxVol(from, to) {
  from = (from || 'USD').toUpperCase(); to = (to || 'USD').toUpperCase();
  if (from === to) return 0;
  const key = `fxvol:${from}:${to}`;
  const cached = cacheGet(key); if (cached != null) return cached;
  let closes = [];
  for (const [sym, inv] of [[`${from}${to}=X`, false], [`${to}${from}=X`, true]]) {
    try {
      const h = await getHistory(sym, '5y', '1wk');
      const pts = (h.points || []).filter((pt) => pt.c != null).map((pt) => (inv ? 1 / pt.c : pt.c));
      if (pts.length > 30) { closes = pts; break; }
    } catch {}
  }
  if (closes.length < 30) return cacheSet(key, 0, 6 * 60 * 60000);
  const rets = [];
  for (let i = 1; i < closes.length; i++) if (closes[i - 1] > 0 && closes[i] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  const n = rets.length;
  if (n < 2) return cacheSet(key, 0, 6 * 60 * 60000);
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return cacheSet(key, Math.sqrt(variance), 6 * 60 * 60000);
}

async function getHistory(symbol, range = '1mo', interval = '1d') {
  const key = `h:${symbol}:${range}:${interval}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const data = await yahooFetch(
    `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`
  );
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No history for ${symbol}`);
  const ts = result.timestamp || [];
  const q = result.indicators?.quote?.[0] || {};
  const closes = q.close || [], opens = q.open || [], highs = q.high || [], lows = q.low || [], vols = q.volume || [];
  // Keep `c` (and the c-not-null filter) so every existing consumer that reads
  // point.c — performance/fx/wb/fred — is unaffected; OHLCV is purely additive
  // so the security-detail chart can render candlesticks + volume.
  const points = ts
    .map((t, i) => ({ t: t * 1000, o: opens[i], h: highs[i], l: lows[i], c: closes[i], v: vols[i] }))
    .filter((p) => p.c != null);
  const payload = { symbol, range, interval, meta: result.meta ? normalizeQuote(symbol, result.meta) : null, points };
  return cacheSet(key, payload, 60000);
}

async function search(q) {
  const key = `s:${q.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const data = await yahooFetch(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`);
  const quotes = (data?.quotes || [])
    .filter((x) => x.symbol)
    .map((x) => ({
      symbol: x.symbol,
      name: x.longname || x.shortname || x.symbol,
      exchange: x.exchDisp || x.exchange || '',
      type: x.typeDisp || x.quoteType || '',
    }));
  return cacheSet(key, quotes, 5 * 60000);
}

// World market overview groups (all free, no key) -----------------------------
const MARKET_GROUPS = {
  Indices: [
    ['^GSPC', 'S&P 500'], ['^DJI', 'Dow Jones'], ['^IXIC', 'Nasdaq'], ['^RUT', 'Russell 2000'],
    ['^FTSE', 'FTSE 100'], ['^GDAXI', 'DAX'], ['^FCHI', 'CAC 40'], ['^N225', 'Nikkei 225'],
    ['^HSI', 'Hang Seng'], ['000001.SS', 'Shanghai'], ['^NSEI', 'Nifty 50'], ['^STI', 'STI Singapore'],
    ['^VIX', 'VIX (volatility)'],
  ],
  FX: [
    ['EURUSD=X', 'EUR/USD'], ['GBPUSD=X', 'GBP/USD'], ['USDJPY=X', 'USD/JPY'],
    ['USDCNY=X', 'USD/CNY'], ['USDINR=X', 'USD/INR'], ['USDSGD=X', 'USD/SGD'],
  ],
  Crypto: [
    ['BTC-USD', 'Bitcoin'], ['ETH-USD', 'Ethereum'], ['SOL-USD', 'Solana'], ['BNB-USD', 'BNB'],
  ],
  Commodities: [
    ['GC=F', 'Gold'], ['SI=F', 'Silver'], ['CL=F', 'WTI Crude'], ['BZ=F', 'Brent'], ['NG=F', 'Nat Gas'],
  ],
  Rates: [
    ['^TNX', 'US 10Y'], ['^TYX', 'US 30Y'], ['^FVX', 'US 5Y'],
  ],
};

async function getMarkets() {
  const key = 'markets';
  const cached = cacheGet(key);
  if (cached) return cached;
  const groups = {};
  for (const [group, items] of Object.entries(MARKET_GROUPS)) {
    const quotes = await getQuotes(items.map((i) => i[0]));
    groups[group] = quotes.map((qd, idx) => ({ ...qd, label: items[idx][1] }));
  }
  return cacheSet(key, groups, 15000);
}

// World Bank macro data (free, no key) ---------------------------------------
async function worldBank(country, indicator) {
  const key = `wb:${country}:${indicator}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const url = `https://api.worldbank.org/v2/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(
    indicator
  )}?format=json&per_page=60`;
  const data = await fetchJson(url);
  const meta = Array.isArray(data) ? data[0] : null;
  const rows = (Array.isArray(data) ? data[1] : []) || [];
  const series = rows
    .filter((r) => r.value != null)
    .map((r) => ({ year: r.date, value: r.value }))
    .sort((a, b) => Number(a.year) - Number(b.year));
  const label = rows[0]?.indicator?.value || indicator;
  const countryName = rows[0]?.country?.value || country;
  const payload = { country, countryName, indicator, label, series };
  return cacheSet(key, payload, 6 * 60 * 60000);
}

// FRED (US Federal Reserve) macro data — free, NO API KEY via the graph CSV export.
async function getFred(series, transform, start) {
  series = (series || 'DGS10').toUpperCase();
  transform = transform || 'lin';
  start = start || '2015-01-01';
  const key = `fred:${series}:${transform}:${start}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(series)}` +
    `&transformation=${encodeURIComponent(transform)}&cosd=${encodeURIComponent(start)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  if (!res.ok) throw new Error(`FRED HTTP ${res.status}`);
  const text = await res.text();
  const lines = text.trim().split(/\r?\n/);
  const points = [];
  for (let i = 1; i < lines.length; i++) {
    const [date, val] = lines[i].split(',');
    const v = parseFloat(val);
    if (date && Number.isFinite(v)) points.push({ date, value: v });
  }
  const payload = { series, transform, points };
  return cacheSet(key, payload, 60 * 60000);
}

// Economic calendar (free, no key) -------------------------------------------
// Curated FOMC schedule — the Fed publishes the whole year ahead and the dates
// are fixed, so the next rate decision + dot-plot (SEP) are always known even
// without a feed. SEP = Summary of Economic Projections ("dot plot"). Refresh
// this list once a year (federalreserve.gov/monetarypolicy/fomccalendars.htm).
const FOMC_SCHEDULE = [
  { start: '2026-01-27', end: '2026-01-28', sep: false },
  { start: '2026-03-17', end: '2026-03-18', sep: true },
  { start: '2026-04-28', end: '2026-04-29', sep: false },
  { start: '2026-06-16', end: '2026-06-17', sep: true },
  { start: '2026-07-28', end: '2026-07-29', sep: false },
  { start: '2026-09-15', end: '2026-09-16', sep: true },
  { start: '2026-10-27', end: '2026-10-28', sep: false },
  { start: '2026-12-08', end: '2026-12-09', sep: true },
];

// Upcoming macro events: the curated FOMC anchor + this-week high-impact US (and
// any SG) releases from Forex Factory's key-free weekly JSON (CPI, PCE, NFP, GDP,
// the rate decision itself…). No API key, no account. Personal/local use only —
// the feed rate-limits hard, so we cache for an hour and degrade gracefully.
async function getCalendar() {
  const key = 'calendar';
  const cached = cacheGet(key);
  if (cached) return cached;
  const now = Date.now();

  // FOMC: the decision lands on the 2nd day; keep meetings whose end is today/future.
  const fomc = FOMC_SCHEDULE
    .map((m) => ({ ...m, decisionMs: Date.parse(m.end + 'T18:30:00Z') })) // ~14:00 ET, DST-neutral
    .filter((m) => m.decisionMs >= now - 12 * 60 * 60000);
  const nextFomc = fomc[0] || null;
  const nextSep = fomc.find((m) => m.sep) || null;

  // This-week high-impact events (best effort).
  let events = [], eventsOk = false;
  try {
    const res = await fetch('https://nfs.faireconomy.media/ff_calendar_thisweek.json',
      { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
    if (res.ok) {
      const all = await res.json();
      events = (Array.isArray(all) ? all : [])
        .filter((e) => (e.country === 'USD' && e.impact === 'High') || e.country === 'SGD')
        .map((e) => ({
          title: e.title, country: e.country, time: e.date, impact: e.impact || '',
          forecast: e.forecast || '', previous: e.previous || '',
        }))
        .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
      eventsOk = true;
    }
  } catch {}

  const payload = { now, fomc, nextFomc, nextSep, events, eventsOk,
    sepUrl: 'https://www.federalreserve.gov/monetarypolicy/fomccalendars.htm' };
  return cacheSet(key, payload, 60 * 60000); // 1h
}

// --------------------------------------------------------------------------
// Portfolio store (persisted to data/portfolio.json)
// --------------------------------------------------------------------------
function newAccountId() { return 'acc' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
function loadPortfolio() {
  let p, raw;
  try { raw = fs.readFileSync(PORTFOLIO_FILE, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') p = {}; else throw e; } // missing = fresh start
  if (raw !== undefined) {
    try { p = JSON.parse(raw); }
    catch {
      // File exists but is corrupt: back it up rather than silently wiping the portfolio.
      try { fs.renameSync(PORTFOLIO_FILE, PORTFOLIO_FILE.replace(/\.json$/, '') + '.corrupt.' + Date.now() + '.json'); } catch {}
      throw new Error('portfolio.json was corrupt; backed up to a .corrupt.json file. Restart to begin fresh, or restore the backup.');
    }
  }
  // Migrate the legacy single-portfolio shape into one "Main" account.
  if (!Array.isArray(p.accounts)) {
    p.accounts = [{ id: 'main', name: 'Main', type: 'Brokerage',
      positions: Array.isArray(p.positions) ? p.positions : [],
      transactions: Array.isArray(p.transactions) ? p.transactions : [] }];
    delete p.positions; delete p.transactions; delete p.realizedPnl;
  }
  if (!Array.isArray(p.watchlist)) p.watchlist = [];
  if (!Array.isArray(p.alerts)) p.alerts = [];
  if (!p.accounts.length) p.accounts.push({ id: 'main', name: 'Main', type: 'Brokerage', positions: [], transactions: [] });
  for (const a of p.accounts) {
    if (!a.id) a.id = newAccountId();
    if (!a.name) a.name = 'Account';
    if (!Array.isArray(a.positions)) a.positions = [];
    if (!Array.isArray(a.transactions)) a.transactions = [];
    if (!Array.isArray(a.dividends)) a.dividends = []; // [{symbol, date, amount, currency}]
    // Lot migration: coerce q/px to numbers, then derive quantity/avgCost from lots
    // so a hand-edited file can't leave avgCost undefined/NaN and poison P&L.
    for (const pos of a.positions) {
      if (!Array.isArray(pos.lots) || !pos.lots.length) {
        pos.lots = [{ q: Number(pos.quantity) || 0, px: Number(pos.avgCost) || 0, fxUsd: null, t: null }];
      }
      recalcPosition(pos);
    }
  }
  if (!p.activeId || !p.accounts.find((a) => a.id === p.activeId)) p.activeId = p.accounts[0].id;
  return p;
}
function recalcPosition(pos) {
  pos.quantity = pos.lots.reduce((s, l) => s + (Number.isFinite(l.q) ? l.q : 0), 0);
  const costNative = pos.lots.reduce((s, l) => s + (Number.isFinite(l.q) ? l.q : 0) * (Number.isFinite(l.px) ? l.px : 0), 0);
  pos.avgCost = pos.quantity ? costNative / pos.quantity : 0;
}
function savePortfolio(p) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Write to a temp file then atomically rename, so a crash mid-write can't truncate the live file.
  const tmp = PORTFOLIO_FILE + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(p, null, 2));
  fs.renameSync(tmp, PORTFOLIO_FILE);
  return p;
}
function findPos(acc, symbol) {
  return acc.positions.find((x) => x.symbol.toUpperCase() === symbol.toUpperCase());
}
// Resolve a writable account (rejects the read-only "ALL" view and bad ids).
function resolveAccount(p, accountId) {
  const id = accountId || p.activeId;
  if (id === 'ALL') throw new Error('Pick a specific account first (not "All Accounts")');
  const a = p.accounts.find((x) => x.id === id);
  if (!a) throw new Error('Unknown account');
  return a;
}
// Positions/transactions for a view (one account, or "ALL" = merged across accounts).
function viewPositions(p, accountId) {
  const id = accountId || p.activeId;
  if (id === 'ALL') {
    const map = new Map();
    for (const a of p.accounts) for (const pos of a.positions) {
      const k = pos.symbol.toUpperCase();
      if (!map.has(k)) map.set(k, { symbol: pos.symbol, name: pos.name, currency: pos.currency, lots: [] });
      const m = map.get(k); m.lots.push(...pos.lots); if (pos.name) m.name = pos.name;
    }
    const list = [...map.values()]; list.forEach(recalcPosition); return list;
  }
  const a = p.accounts.find((x) => x.id === id) || p.accounts[0];
  return a ? a.positions : [];
}
function viewTransactions(p, accountId) {
  const id = accountId || p.activeId;
  if (id === 'ALL') return p.accounts.flatMap((a) => a.transactions);
  const a = p.accounts.find((x) => x.id === id) || p.accounts[0];
  return a ? a.transactions : [];
}
function viewDividends(p, accountId) {
  const id = accountId || p.activeId;
  if (id === 'ALL') return p.accounts.flatMap((a) => a.dividends || []);
  const a = p.accounts.find((x) => x.id === id) || p.accounts[0];
  return a ? (a.dividends || []) : [];
}
// Dividend income (received), converted to base. Total, trailing-12-month, by symbol, recent.
async function dividendsReport(base, accountId) {
  base = (base || 'SGD').toUpperCase();
  const p = loadPortfolio();
  const divs = viewDividends(p, accountId);
  const fx = {};
  for (const d of divs) { const c = (d.currency || 'USD').toUpperCase(); if (fx[c] == null) { try { fx[c] = await getFxRate(c, base); } catch { fx[c] = 1; } } }
  const conv = (d) => d.amount * (fx[(d.currency || 'USD').toUpperCase()] ?? 1);
  const yearAgo = Date.now() - 365 * 24 * 60 * 60000;
  let total = 0, ttm = 0; const bySym = {};
  for (const d of divs) {
    const v = conv(d); total += v;
    const t = Date.parse(d.date); if (Number.isFinite(t) && t >= yearAgo) ttm += v;
    bySym[d.symbol] = (bySym[d.symbol] || 0) + v;
  }
  const bySymbol = Object.entries(bySym).map(([symbol, amount]) => ({ symbol, amount })).sort((a, b) => b.amount - a.amount);
  const recent = [...divs].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 15).map((d) => ({ ...d, baseAmount: conv(d) }));
  return { base, account: accountId || p.activeId, total, ttm, count: divs.length, bySymbol, recent };
}

// Core buy without the lock — callers must hold the lock (buy / importCsv do).
async function buyUnlocked(symbol, quantity, price, dateMs, accountId, base) {
  symbol = symbol.toUpperCase();
  quantity = Number(quantity);
  price = Number(price);
  if (!symbol || !(quantity > 0) || !(price >= 0)) throw new Error('Need symbol, quantity > 0, price >= 0');
  const p = loadPortfolio();
  const acc = resolveAccount(p, accountId);
  let info = {};
  try { const q = await getQuote(symbol); info = { name: q.name, currency: q.currency }; } catch {}
  const currency = (info.currency || findPos(acc, symbol)?.currency || 'USD').toUpperCase();
  const now = Date.now();
  const t = (dateMs && Number.isFinite(dateMs) && dateMs < now) ? dateMs : now; // purchase date
  let fxUsd = null; // native -> USD rate at purchase time (anchor for FX P&L)
  try { fxUsd = (t === now) ? await getFxRate(currency, 'USD') : await fxRateAt(currency, 'USD', t); } catch {}
  // Persist USD->base at purchase time too, so historical FX P&L in this base is
  // reproducible and doesn't drift with the cached weekly series.
  let usdBase = null; const usdBaseCcy = (base || '').toUpperCase();
  if (usdBaseCcy && usdBaseCcy !== 'USD') {
    try { usdBase = (t === now) ? await getFxRate('USD', usdBaseCcy) : await fxRateAt('USD', usdBaseCcy, t); } catch {}
  }
  let pos = findPos(acc, symbol);
  if (!pos) { pos = { symbol, name: info.name || symbol, currency, quantity: 0, avgCost: 0, lots: [] }; acc.positions.push(pos); }
  const lot = { q: quantity, px: price, fxUsd, t };
  if (usdBase != null) { lot.usdBase = usdBase; lot.usdBaseCcy = usdBaseCcy; }
  pos.lots.push(lot);
  if (info.name) pos.name = info.name;
  pos.currency = currency;
  recalcPosition(pos);
  acc.transactions.push({ type: 'BUY', symbol, quantity, price, currency, fxUsd, time: t });
  savePortfolio(p);
  return p;
}
const buy = (symbol, quantity, price, dateMs, accountId, base) => withLock(() => buyUnlocked(symbol, quantity, price, dateMs, accountId, base));

function sell(symbol, quantity, price, accountId, base) {
  return withLock(async () => {
    symbol = symbol.toUpperCase();
    quantity = Number(quantity);
    const p = loadPortfolio();
    const acc = resolveAccount(p, accountId);
    const pos = findPos(acc, symbol);
    if (!pos) throw new Error(`No position in ${symbol}`);
    if (!(quantity > 0)) throw new Error('Quantity must be > 0');
    if (quantity > pos.quantity + 1e-9) throw new Error(`You only hold ${pos.quantity} ${symbol}`);
    // If price not supplied, use current market price.
    if (price == null || price === '' || Number.isNaN(Number(price))) {
      try { price = (await getQuote(symbol)).price; } catch { throw new Error('Could not fetch price; supply a sell price'); }
    }
    price = Number(price);
    const realized = (price - pos.avgCost) * quantity;
    // Selling (effectively) the whole position -> factor 0 so no float dust survives.
    const full = quantity >= pos.quantity - 1e-9;
    const factor = full ? 0 : (pos.quantity - quantity) / pos.quantity; // proportional lot reduction
    // Snapshot the consumed slice of each lot (with its purchase-time FX) BEFORE
    // scaling them down, so realized P&L can later be split into stock vs FX.
    const currency = (pos.currency || 'USD').toUpperCase();
    const consumed = 1 - factor;
    const lotsSold = (pos.lots || [])
      .map((l) => ({ q: l.q * consumed, px: l.px, fxUsd: l.fxUsd ?? null, t: l.t ?? null,
        usdBase: l.usdBase ?? null, usdBaseCcy: l.usdBaseCcy ?? null }))
      .filter((l) => l.q > 1e-12);
    let fxUsdSell = null; // native -> USD at sell time (anchor for realized-FX split)
    try { fxUsdSell = await getFxRate(currency, 'USD'); } catch {}
    // Persist USD->base at sell time too, so the realized stock/FX split is
    // reproducible and doesn't drift across the 7-day u2b boundary later.
    let usdBaseSell = null; const usdBaseSellCcy = (base || '').toUpperCase();
    if (usdBaseSellCcy && usdBaseSellCcy !== 'USD') {
      try { usdBaseSell = await getFxRate('USD', usdBaseSellCcy); } catch {}
    }
    pos.lots.forEach((l) => { l.q *= factor; });
    recalcPosition(pos);
    const tx = { type: 'SELL', symbol, quantity, price, realized, currency, fxUsdSell, lotsSold, time: Date.now() };
    if (usdBaseSell != null) { tx.usdBaseSell = usdBaseSell; tx.usdBaseSellCcy = usdBaseSellCcy; }
    acc.transactions.push(tx);
    if (pos.quantity <= 1e-9) acc.positions = acc.positions.filter((x) => x !== pos);
    savePortfolio(p);
    return { portfolio: p, realized };
  });
}

function del(symbol, accountId) {
  return withLock(() => {
    const p = loadPortfolio();
    const acc = resolveAccount(p, accountId);
    const before = acc.positions.length;
    acc.positions = acc.positions.filter((x) => x.symbol.toUpperCase() !== symbol.toUpperCase());
    if (acc.positions.length === before) throw new Error(`No position in ${symbol}`);
    acc.transactions.push({ type: 'DELETE', symbol: symbol.toUpperCase(), time: Date.now() });
    savePortfolio(p);
    return p;
  });
}

// Account management
function listAccounts() {
  const p = loadPortfolio();
  return { accounts: p.accounts.map((a) => ({ id: a.id, name: a.name, type: a.type || '', count: a.positions.length })), activeId: p.activeId };
}
function accountAdd(name, type) {
  return withLock(() => {
    const p = loadPortfolio();
    const id = newAccountId();
    p.accounts.push({ id, name: String(name || 'Account').slice(0, 40), type: String(type || '').slice(0, 30), positions: [], transactions: [] });
    p.activeId = id;
    savePortfolio(p);
    return id;
  });
}
function accountRename(id, name, type) {
  return withLock(() => {
    const p = loadPortfolio();
    const a = p.accounts.find((x) => x.id === id);
    if (!a) throw new Error('Unknown account');
    if (name != null) a.name = String(name).slice(0, 40);
    if (type != null) a.type = String(type).slice(0, 30);
    savePortfolio(p);
  });
}
function accountRemove(id) {
  return withLock(() => {
    const p = loadPortfolio();
    if (p.accounts.length <= 1) throw new Error('Cannot remove your only account');
    p.accounts = p.accounts.filter((x) => x.id !== id);
    if (p.activeId === id) p.activeId = p.accounts[0].id;
    savePortfolio(p);
  });
}

// native->base FX rate for a purchase lot. Prefers the USD->base rate persisted
// at buy time (reproducible, drift-free) when it was captured for THIS base;
// otherwise reconstructs from the USD anchor + weekly USD->base history (u2b);
// else falls back to today's rate.
function lotBuyRate(l, base, u2b, rateNow) {
  if (l.fxUsd != null && l.usdBase != null && l.usdBaseCcy === base) return l.fxUsd * l.usdBase;
  if (l.fxUsd != null && l.t) return l.fxUsd * u2b(l.t);
  return rateNow;
}

// Portfolio enriched with live quotes + P&L, all rolled up into `base` currency.
// Per-share avg/last stay in each security's NATIVE currency; market values,
// cost, P&L and totals are converted to `base` at current FX (best effort).
async function portfolioWithQuotes(base = 'SGD', accountId) {
  base = (base || 'SGD').toUpperCase();
  const p = loadPortfolio();
  const srcPositions = viewPositions(p, accountId);
  const srcTx = viewTransactions(p, accountId);
  const symbols = srcPositions.map((x) => x.symbol);
  const quotes = symbols.length ? await getQuotes(symbols) : [];
  const qmap = Object.fromEntries(quotes.map((q) => [q.symbol, q]));

  // Resolve FX rates for every currency present (positions + sell history).
  const currencies = new Set();
  srcPositions.forEach((pos) => currencies.add((qmap[pos.symbol]?.currency || pos.currency || 'USD').toUpperCase()));
  srcTx.forEach((t) => { if (t.type === 'SELL') currencies.add((t.currency || 'USD').toUpperCase()); });
  const fx = {}; const fxMissing = [];
  for (const c of currencies) {
    try { fx[c] = await getFxRate(c, base); }
    catch { fx[c] = 1; if (c !== base) fxMissing.push(c); }
  }
  const rate = (c) => fx[(c || 'USD').toUpperCase()] ?? 1;
  const u2b = await usdToBaseAt(base); // t(ms) -> USD->base rate at that time

  let totalValue = 0, totalCost = 0, dayPnl = 0, totalStockPnl = 0, totalFxPnl = 0, prevValue = 0;
  const positions = srcPositions.map((pos) => {
    const { lots, ...rest } = pos;
    const q = qmap[pos.symbol] || {};
    const currency = (q.currency || pos.currency || 'USD').toUpperCase();
    const fxRate = rate(currency);                              // native -> base NOW
    const last = q.price != null ? q.price : pos.avgCost;       // native per-share
    const prevClose = q.prevClose != null ? q.prevClose : last; // native prior close
    const marketValue = last * pos.quantity * fxRate;           // base
    const costAtNow = pos.avgCost * pos.quantity * fxRate;      // original cost re-priced at today's FX
    // actual amount paid, in base, using each lot's purchase-time FX
    let costAtBuy = 0;
    for (const l of (lots || [])) {
      costAtBuy += l.q * l.px * lotBuyRate(l, base, u2b, fxRate); // native->base at buy
    }
    const stockPnl = marketValue - costAtNow;                   // pure price move @ today's FX
    // Base-currency holdings carry no FX risk; force fxPnl to exactly 0 (avoids a
    // sub-0.1% round-trip residual from the two non-reciprocal FX quotes), matching
    // fxRisk()'s `currency === base` skip so the two totals reconcile.
    const cost = (currency === base) ? costAtNow : costAtBuy;   // true cost basis = what you actually paid
    const fxPnl = costAtNow - cost;                            // pure FX move on your cost (0 when native==base)
    const unrealized = marketValue - cost;                     // = stockPnl + fxPnl
    const unrealizedPct = cost ? (unrealized / cost) * 100 : 0;
    const dayChange = (q.change != null ? q.change : 0) * pos.quantity * fxRate; // base
    totalValue += marketValue; totalCost += cost; dayPnl += dayChange;
    totalStockPnl += stockPnl; totalFxPnl += fxPnl; prevValue += prevClose * pos.quantity * fxRate;
    return {
      ...rest, currency, fxRate, last, change: q.change ?? null, changePct: q.changePct ?? null,
      marketValue, cost, costAtNow, unrealized, unrealizedPct, stockPnl, fxPnl, dayChange, name: q.name || pos.name,
    };
  });
  positions.forEach((pos) => { pos.weight = totalValue ? (pos.marketValue / totalValue) * 100 : 0; });
  positions.sort((a, b) => b.marketValue - a.marketValue);

  // Realized P&L across all sells in view. Sells that captured FX at sell time
  // (new sells: lotsSold + fxUsdSell) are split into stock vs FX, valued at the
  // sell-moment FX. Legacy sells (no snapshot) fall back to native realized at
  // today's FX, contributing only to the total (no stock/FX split).
  let realizedPnl = 0, realizedStockPnl = 0, realizedFxPnl = 0, realizedLegacy = 0;
  for (const t of srcTx) {
    if (t.type !== 'SELL' || t.realized == null) continue;
    if (Array.isArray(t.lotsSold) && t.fxUsdSell != null) {
      // native -> base at sell: prefer the rate persisted at sell time for THIS base
      // (drift-free), else reconstruct from the USD anchor + weekly history.
      const usdBaseSell = (t.usdBaseSell != null && t.usdBaseSellCcy === base) ? t.usdBaseSell : u2b(t.time);
      const sellRate = t.fxUsdSell * usdBaseSell;
      let costNative = 0, costBase = 0;
      for (const l of t.lotsSold) {
        costNative += l.q * l.px; costBase += l.q * l.px * lotBuyRate(l, base, u2b, sellRate);
      }
      const proceedsBase = t.price * t.quantity * sellRate;
      const stock = proceedsBase - costNative * sellRate;          // price move @ sell FX
      const fx = costNative * sellRate - costBase;                 // currency move buy->sell
      realizedStockPnl += stock; realizedFxPnl += fx; realizedPnl += stock + fx;
    } else {
      realizedPnl += t.realized * rate(t.currency);                // legacy: no FX split
      realizedLegacy++;
    }
  }

  return {
    base, fx, fxMissing,
    account: accountId || p.activeId,
    positions,
    summary: {
      totalValue, totalCost,
      totalUnrealized: totalValue - totalCost,
      totalUnrealizedPct: totalCost ? ((totalValue - totalCost) / totalCost) * 100 : 0,
      totalStockPnl, totalFxPnl,
      dayPnl, dayPct: prevValue ? (dayPnl / prevValue) * 100 : 0,
      realizedPnl, realizedStockPnl, realizedFxPnl, realizedLegacy,
    },
    transactions: srcTx.slice(-50).reverse(),
  };
}

// --------------------------------------------------------------------------
// FX risk view — currency exposure + per-buy FX P&L for foreign holdings.
// You fund in `base` (e.g. SGD) but hold foreign-currency stocks (USD), so part
// of your value rides on the exchange rate. This decomposes, per currency:
//   exposure   = current market value of those holdings, in base
//   blended    = your weighted-average native->base cost rate ("entry FX")
//   fxPnl      = base gained/lost from the rate moving, on your cost
// plus a per-lot list so you can see the FX gain/loss of each historical buy.
// Reuses the same per-lot anchoring (lot.fxUsd + usdToBaseAt) as the portfolio
// view, so totalFxPnl here matches summary.totalFxPnl for foreign holdings.
// --------------------------------------------------------------------------
async function fxRisk(base = 'SGD', accountId) {
  base = (base || 'SGD').toUpperCase();
  const p = loadPortfolio();
  const srcPositions = viewPositions(p, accountId);
  const symbols = srcPositions.map((x) => x.symbol);
  const quotes = symbols.length ? await getQuotes(symbols) : [];
  const qmap = Object.fromEntries(quotes.map((q) => [q.symbol, q]));

  // Current native->base spot for every currency held.
  const currencies = new Set();
  srcPositions.forEach((pos) => currencies.add((qmap[pos.symbol]?.currency || pos.currency || 'USD').toUpperCase()));
  const spot = {};
  for (const c of currencies) { try { spot[c] = await getFxRate(c, base); } catch { spot[c] = 1; } }
  const u2b = await usdToBaseAt(base); // t(ms) -> USD->base rate at that time

  const byCcy = {};     // ccy -> { mvNative, mvBase, costNative, costBase, fxPnl }
  const lots = [];
  let totalValue = 0, totalFxPnl = 0;
  for (const pos of srcPositions) {
    const q = qmap[pos.symbol] || {};
    const currency = (q.currency || pos.currency || 'USD').toUpperCase();
    const last = q.price != null ? q.price : pos.avgCost;
    const rateNow = spot[currency] ?? 1;             // native -> base, now
    const mvBase = last * pos.quantity * rateNow;
    totalValue += mvBase;
    if (currency === base) continue;                 // base-currency holdings carry no FX risk
    const e = byCcy[currency] || (byCcy[currency] = { mvNative: 0, mvBase: 0, costNative: 0, costBase: 0, fxPnl: 0 });
    e.mvNative += last * pos.quantity;
    e.mvBase += mvBase;
    for (const l of (pos.lots || [])) {
      const rBuy = lotBuyRate(l, base, u2b, rateNow); // native->base at buy
      const costNotional = l.q * l.px;               // native cost of this lot
      const fxPnl = costNotional * (rateNow - rBuy); // currency-only gain on this lot, in base
      e.costNative += costNotional;
      e.costBase += costNotional * rBuy;
      e.fxPnl += fxPnl;
      totalFxPnl += fxPnl;
      lots.push({
        symbol: pos.symbol, currency, t: l.t || null, q: l.q, px: l.px,
        entryRate: rBuy, nowRate: rateNow, fxPnl,
        dated: !!l.t, recent: l.t ? (Date.now() - l.t < 7 * 24 * 60 * 60000) : false,
      });
    }
  }
  lots.sort((a, b) => (b.t || 0) - (a.t || 0));       // newest buys first

  // Weekly FX volatility per exposure currency, for a 1-week parametric VaR.
  const vols = {};
  for (const ccy of Object.keys(byCcy)) vols[ccy] = await weeklyFxVol(ccy, base);

  const exposures = Object.entries(byCcy).map(([ccy, e]) => {
    const blendedEntry = e.costNative ? e.costBase / e.costNative : spot[ccy]; // weighted-avg native->base cost
    const nowRate = spot[ccy];
    const sigma = vols[ccy] || 0;                          // weekly log-return stdev
    return {
      ccy, base,
      notionalNative: e.mvNative,
      notionalBase: e.mvBase,
      pct: totalValue ? (e.mvBase / totalValue) * 100 : 0,
      blendedEntry, nowRate, breakeven: blendedEntry,
      driftPct: blendedEntry ? ((nowRate - blendedEntry) / blendedEntry) * 100 : 0,
      fxPnl: e.fxPnl,
      fxPnlPct: e.costBase ? (e.fxPnl / e.costBase) * 100 : 0,
      sigmaWeeklyPct: sigma * 100,
      oneSigmaBase: e.mvBase * sigma,                       // ~68% of weeks stay within ±this
      var95Base: e.mvBase * 1.645 * sigma,                 // 95% 1-week VaR
    };
  }).sort((a, b) => b.notionalBase - a.notionalBase);

  const foreignBase = exposures.reduce((s, e) => s + e.notionalBase, 0);
  // Portfolio-level VaR: sum per-currency (conservative; exact for a single ccy).
  const vol = {
    sigmaWeeklyPct: foreignBase ? (exposures.reduce((s, e) => s + e.oneSigmaBase, 0) / foreignBase) * 100 : 0,
    oneSigmaBase: exposures.reduce((s, e) => s + e.oneSigmaBase, 0),
    var95Base: exposures.reduce((s, e) => s + e.var95Base, 0),
  };
  return { base, totalValue, foreignBase, totalFxPnl, exposures, vol, lots: lots.slice(0, 100) };
}

// --------------------------------------------------------------------------
// Watchlist (symbols you track but don't own)
// --------------------------------------------------------------------------
async function watchlistWithQuotes() {
  const p = loadPortfolio();
  const syms = p.watchlist || [];
  return syms.length ? await getQuotes(syms) : [];
}
async function watchAdd(symbol) {
  symbol = (symbol || '').toUpperCase().trim();
  if (!symbol) throw new Error('Symbol required');
  try { await getQuote(symbol); } catch { throw new Error(`Unknown symbol ${symbol}`); }
  return withLock(() => {
    const p = loadPortfolio();
    if (!p.watchlist.includes(symbol)) { p.watchlist.push(symbol); savePortfolio(p); }
    return p;
  });
}
function watchRemove(symbol) {
  symbol = (symbol || '').toUpperCase().trim();
  return withLock(() => {
    const p = loadPortfolio();
    p.watchlist = p.watchlist.filter((s) => s !== symbol);
    savePortfolio(p);
    return p;
  });
}

// --------------------------------------------------------------------------
// Price alerts
// --------------------------------------------------------------------------
async function alertAdd({ symbol, op, price, note }) {
  symbol = (symbol || '').toUpperCase().trim();
  op = (op === '<' || op === 'below' || op === 'under') ? '<' : '>';
  price = Number(price);
  if (!symbol || !(price > 0)) throw new Error('Need a symbol and a price > 0');
  try { await getQuote(symbol); } catch { throw new Error(`Unknown symbol ${symbol}`); }
  return withLock(() => {
    const p = loadPortfolio();
    const id = 'a' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    p.alerts.push({ id, symbol, op, price, note: note || '', createdAt: Date.now(), triggeredAt: null });
    savePortfolio(p);
    return p;
  });
}
function alertRemove(id) {
  return withLock(() => {
    const p = loadPortfolio();
    p.alerts = p.alerts.filter((a) => a.id !== id);
    savePortfolio(p);
    return p;
  });
}
// Native macOS desktop notification (works even when the browser is closed).
// Disable with NOTIFY=0.
function desktopNotify(title, message) {
  if (process.env.NOTIFY === '0' || process.platform !== 'darwin') return;
  try {
    execFile('osascript',
      ['-e', 'on run {t, m}', '-e', 'display notification m with title t sound name "Ping"', '-e', 'end run', title, message],
      () => {});
  } catch {}
}

// Serialize every portfolio read-modify-write (buy/sell/del/watch/alert/import/
// reset and the background alert timer) onto one promise chain so concurrent
// saves can't clobber each other. NOTE: locked functions must never call another
// locked function (buy/importCsv use buyUnlocked) or they'd deadlock the chain.
let _lock = Promise.resolve();
function withLock(fn) { const r = _lock.then(fn, fn); _lock = r.catch(() => {}); return r; }

// Evaluate every alert against the live price. Sets triggeredAt on first cross.
// When doNotify is true (the background timer), also fires a desktop notification
// once per alert (tracked via notifiedAt) so you're alerted even with the app closed.
async function evaluateAlerts(doNotify) {
  return withLock(async () => {
    const p = loadPortfolio();
    const syms = [...new Set(p.alerts.map((a) => a.symbol))];
    const quotes = syms.length ? await getQuotes(syms) : [];
    const qmap = Object.fromEntries(quotes.map((q) => [q.symbol, q]));
    let changed = false;
    const out = p.alerts.map((a) => {
      const q = qmap[a.symbol] || {};
      const price = q.price ?? null;
      const met = price != null && (a.op === '>' ? price >= a.price : price <= a.price);
      if (met && !a.triggeredAt) { a.triggeredAt = Date.now(); changed = true; }
      if (doNotify && met && a.triggeredAt && !a.notifiedAt) {
        desktopNotify('FINSIGHT · price alert', `${a.symbol} ${a.op === '>' ? '≥' : '≤'} ${a.price} — now ${price}`);
        a.notifiedAt = Date.now(); changed = true;
      }
      return { ...a, currentPrice: price, currency: q.currency, name: q.name, met };
    });
    if (changed) savePortfolio(p);
    return out;
  });
}
const alertsWithStatus = () => evaluateAlerts(false);

// --------------------------------------------------------------------------
// News (free, no key, via Yahoo search)
// --------------------------------------------------------------------------
async function getNews(symbol) {
  const q = symbol ? symbol : 'stock market';
  const key = `news:${q.toLowerCase()}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  const data = await yahooFetch(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=0&newsCount=14`);
  const items = (data?.news || []).map((n) => ({
    title: n.title,
    publisher: n.publisher,
    link: n.link,
    time: n.providerPublishTime ? n.providerPublishTime * 1000 : null,
    tickers: n.relatedTickers || [],
  }));
  return cacheSet(key, items, 5 * 60000);
}

// --------------------------------------------------------------------------
// Category / sector (for the heatmap). Sector for equities (via search),
// otherwise bucketed by instrument type. Free, no key.
// --------------------------------------------------------------------------
const TYPE_BUCKET = {
  ETF: 'ETF / Fund', MUTUALFUND: 'ETF / Fund', CRYPTOCURRENCY: 'Crypto',
  FUTURE: 'Commodity', INDEX: 'Index', CURRENCY: 'FX', EQUITY: 'Other',
};
async function getCategory(symbol) {
  symbol = symbol.toUpperCase();
  const key = `cat:${symbol}`;
  const cached = cacheGet(key);
  if (cached) return cached;
  let sector = null, type = null;
  try {
    const data = await yahooFetch(`/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=8&newsCount=0`);
    const q = (data?.quotes || []).find((x) => x.symbol === symbol) || (data?.quotes || [])[0] || {};
    sector = q.sector || null;
    type = (q.quoteType || q.typeDisp || '').toUpperCase();
  } catch {}
  const category = sector || TYPE_BUCKET[type] || 'Other';
  return cacheSet(key, { symbol, sector: sector || null, type: type || null, category }, 24 * 60 * 60000);
}
async function getCategories(symbols) {
  const out = await Promise.allSettled(symbols.map(getCategory));
  const map = {};
  out.forEach((r, i) => { map[symbols[i].toUpperCase()] = r.status === 'fulfilled' ? r.value : { symbol: symbols[i], category: 'Other' }; });
  return map;
}

// Portfolio value over time = CURRENT holdings priced with historical prices,
// converted to base at today's FX. (A "what are my current holdings worth over
// time" view — it does not replay past buys/sells.)
async function portfolioPerformance(range, base, accountId) {
  base = (base || 'SGD').toUpperCase();
  range = range || '1y';
  const interval = ({ '1mo': '1d', '3mo': '1d', '6mo': '1d', '1y': '1d', '2y': '1wk', '5y': '1wk', max: '1mo' })[range] || '1d';
  const p = loadPortfolio();
  const srcPositions = viewPositions(p, accountId);
  if (!srcPositions.length) return { range, base, points: [], changePct: null };
  const fx = {};
  for (const pos of srcPositions) {
    const c = (pos.currency || 'USD').toUpperCase();
    if (fx[c] == null) { try { fx[c] = await getFxRate(c, base); } catch { fx[c] = 1; } }
  }
  const hist = await Promise.allSettled(srcPositions.map((pos) => getHistory(pos.symbol, range, interval)));
  // Bucket each symbol's closes by calendar day (markets close at different epoch
  // seconds, so align on the day, not the raw timestamp).
  const perSym = [];
  hist.forEach((r, i) => {
    if (r.status !== 'fulfilled') return;
    const pos = srcPositions[i];
    const mult = pos.quantity * (fx[(pos.currency || 'USD').toUpperCase()] ?? 1);
    const byDay = new Map();
    for (const pt of (r.value.points || [])) {
      if (pt.c == null) continue;
      byDay.set(new Date(pt.t).toISOString().slice(0, 10), pt.c); // last close of the day wins
    }
    if (byDay.size) perSym.push({ mult, byDay, firstDay: byDay.keys().next().value });
  });
  if (!perSym.length) return { range, base, points: [], changePct: null };
  // Start only once every position has data, so the total isn't undercounted early.
  const startDay = perSym.reduce((m, s) => (s.firstDay > m ? s.firstDay : m), perSym[0].firstDay);
  const daySet = new Set();
  perSym.forEach((s) => s.byDay.forEach((_, day) => { if (day >= startDay) daySet.add(day); }));
  const days = [...daySet].sort();
  const last = perSym.map(() => null), out = [];
  for (const day of days) {
    let sum = 0, ok = true;
    perSym.forEach((s, si) => {
      if (s.byDay.has(day)) last[si] = s.byDay.get(day);
      if (last[si] == null) ok = false; else sum += last[si] * s.mult;
    });
    if (ok) out.push({ t: Date.parse(day + 'T00:00:00Z'), value: sum });
  }
  const first = out[0]?.value, end = out[out.length - 1]?.value;
  return { range, base, points: out, start: first, end, changePct: (first && end) ? ((end - first) / first) * 100 : null };
}

// --------------------------------------------------------------------------
// CSV import / reset
// --------------------------------------------------------------------------
// Split one CSV line into fields, honoring double-quoted fields (which may
// contain commas) and escaped "" quotes.
function splitCsvLine(line) {
  const out = []; let cur = '', inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

// Map a broker's listing-exchange or market label to the Yahoo ticker suffix.
const EXCHANGE_SUFFIX = {
  // US (no suffix)
  US: '', USA: '', NASDAQ: '', NMS: '', NYSE: '', NYS: '', ARCA: '', BATS: '', AMEX: '', PINK: '', OTC: '',
  // Singapore / HK / Asia
  SG: '.SI', SGX: '.SI', SES: '.SI',
  HK: '.HK', SEHK: '.HK', HKEX: '.HK', HKG: '.HK',
  JP: '.T', TSE: '.T', TYO: '.T', JPX: '.T',
  KR: '.KS', KRX: '.KS', KSC: '.KS',
  CN: '.SS', SSE: '.SS', SHH: '.SS', SHA: '.SS', SZSE: '.SZ', SHE: '.SZ', SZ: '.SZ',
  IN: '.NS', NSE: '.NS', BSE: '.BO',
  TW: '.TW', TWSE: '.TW',
  // Europe
  UK: '.L', LSE: '.L', LON: '.L',
  DE: '.DE', IBIS: '.DE', FWB: '.DE', XETRA: '.DE', GETTEX: '.DE',
  FR: '.PA', SBF: '.PA', ENEXT: '.PA', PAR: '.PA',
  NL: '.AS', AEB: '.AS',
  IT: '.MI', BVME: '.MI', MIL: '.MI',
  ES: '.MC', BM: '.MC', MCE: '.MC',
  CH: '.SW', SWX: '.SW', EBS: '.SW',
  // Oceania / Canada
  AU: '.AX', ASX: '.AX',
  CA: '.TO', TSX: '.TO', VENTURE: '.V',
};
function applyExchangeSuffix(symbol, exch) {
  symbol = symbol.toUpperCase();
  if (/[.\-=^]/.test(symbol)) return symbol;            // already has a suffix/format
  const suf = EXCHANGE_SUFFIX[(exch || '').toUpperCase().trim()];
  return suf ? symbol + suf : symbol;                   // unknown/US exchange -> leave as-is
}

// Interactive Brokers "Activity Statement": multi-section CSV. Holdings live in the
// "Open Positions" section; listing exchanges in "Financial Instrument Information"
// (used to add the right Yahoo suffix for SG/HK/etc. tickers).
function parseIbkrPositions(rows) {
  const exch = {};
  for (const r of rows) {
    if (r[0] === 'Financial Instrument Information' && r[1] === 'Data') {
      const sym = (r[3] || '').toUpperCase();
      if (sym) exch[sym] = r[8] || ''; // Listing Exch column
    }
  }
  const out = [];
  for (const r of rows) {
    if (r[0] === 'Open Positions' && r[1] === 'Data' && r[2] === 'Summary') {
      const cat = (r[3] || '').toLowerCase();
      if (!/stock|etf|equity|fund|adr/.test(cat)) continue; // skip forex/cash rows
      let symbol = (r[5] || '').toUpperCase().replace(/[^A-Z0-9.\-=^]/g, '');
      const quantity = parseFloat(r[6]);
      const price = parseFloat(r[8]); // Cost Price = average cost per share
      if (symbol && quantity > 0 && price >= 0) {
        out.push({ symbol: applyExchangeSuffix(symbol, exch[symbol]), quantity, price, dateMs: null });
      }
    }
  }
  return out;
}

// IBKR "Dividends" section: `Dividends,Data,<ccy>,<YYYY-MM-DD>,<DESC with SYMBOL(...)>,<amount>`.
// Returns dividend cash received per line (gross), symbol parsed from the description.
function parseIbkrDividends(text) {
  const rows = String(text || '').split(/\r?\n/).filter((l) => l.trim()).map(splitCsvLine);
  const out = [];
  for (const r of rows) {
    if (r[0] !== 'Dividends' || r[1] !== 'Data') continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(r[3] || '')) continue; // skip Total / header rows
    const symbol = (r[4] || '').split('(')[0].trim().toUpperCase().replace(/[^A-Z0-9.\-=^]/g, '');
    const amount = parseFloat(r[5]);
    if (symbol && Number.isFinite(amount) && amount !== 0) {
      out.push({ symbol, date: r[3], amount, currency: (r[2] || 'USD').toUpperCase() });
    }
  }
  return out;
}

// Generic broker/flat CSV: find a header row anywhere, match columns loosely
// (works for moomoo, Tiger, and most "positions" exports, plus the simple format).
function parseCsv(text) {
  const rawLines = String(text || '').split(/\r?\n/).filter((l) => l.trim());
  if (!rawLines.length) return [];
  if (rawLines.some((l) => l.startsWith('Open Positions,') || l.startsWith('"Open Positions",'))) {
    const ibkr = parseIbkrPositions(rawLines.map(splitCsvLine));
    if (ibkr.length) return ibkr;
  }
  const grid = rawLines.map(splitCsvLine);
  const M = {
    sym: (h) => /(symbol|ticker|^sym$|\bsym\b|^code$|stock\s*code|instrument)/.test(h) && !/name|desc/.test(h),
    qty: (h) => /(quantity|qty|shares|units|position|holding|volume)/.test(h) && !/value/.test(h),
    priceStrong: (h) => /(avg.*cost|average.*cost|cost.*price|unit.*cost|avg.*price|average.*price)/.test(h),
    priceWeak: (h) => /(avg|average|cost|price)/.test(h) && !/(basis|value|market|total|proceeds|current|last|close|change|p\/?l|pnl|gain|fee)/.test(h),
    date: (h) => /(date|bought|purchase|acquired|trade|open)/.test(h),
    exch: (h) => /(exchange|market|listing|venue)/.test(h) && !/value/.test(h),
  };
  const headerCols = (cells) => {
    const low = cells.map((c) => c.toLowerCase());
    const f = (fn) => low.findIndex(fn);
    const iSym = f(M.sym), iQty = f(M.qty);
    let iPrice = f(M.priceStrong); if (iPrice < 0) iPrice = f(M.priceWeak);
    if (iSym < 0 || iQty < 0 || iPrice < 0) return null;
    return { iSym, iQty, iPrice, iDate: f(M.date), iExch: f(M.exch) };
  };
  let cols = null, start = 0;
  for (let i = 0; i < grid.length; i++) { const c = headerCols(grid[i]); if (c) { cols = c; start = i + 1; break; } }
  const { iSym = 0, iQty = 1, iPrice = 2, iDate = 3, iExch = -1 } = cols || {}; // no header -> bare positional
  const rows = [];
  for (let i = start; i < grid.length; i++) {
    const c = grid[i];
    let symbol = (c[iSym] || '').toUpperCase().replace(/[^A-Z0-9.\-=^]/g, '');
    const quantity = parseFloat((c[iQty] || '').replace(/[^0-9.\-]/g, ''));
    const price = parseFloat((c[iPrice] || '').replace(/[^0-9.\-]/g, ''));
    const dm = iDate >= 0 && c[iDate] ? Date.parse(c[iDate]) : NaN;
    if (iExch >= 0) symbol = applyExchangeSuffix(symbol, c[iExch]);
    if (symbol && quantity > 0 && price >= 0) rows.push({ symbol, quantity, price, dateMs: Number.isFinite(dm) ? dm : null });
  }
  return rows;
}
async function importCsv(text, replace, accountId, base) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('No valid rows found. Expected columns: symbol, quantity, avg price (optional: date).');
  const divs = parseIbkrDividends(text); // dividend history from IBKR statements (empty otherwise)
  // One lock for the whole import; uses buyUnlocked to avoid a self-deadlock.
  return withLock(async () => {
    // Resolve the account up front so importing into "ALL"/unknown fails with a clear
    // error instead of every row silently failing inside the per-row catch below.
    const p = loadPortfolio(); const acc = resolveAccount(p, accountId);
    if (replace) { acc.positions = []; acc.transactions = []; acc.dividends = []; savePortfolio(p); }
    let added = 0; const failed = [];
    for (const r of rows) {
      try { await buyUnlocked(r.symbol, r.quantity, r.price, r.dateMs, accountId, base); added++; }
      catch (e) { failed.push(r.symbol); }
    }
    // Store dividends (reload since buyUnlocked re-saved the file each row).
    if (divs.length) {
      const p2 = loadPortfolio(); const acc2 = resolveAccount(p2, accountId);
      acc2.dividends = (acc2.dividends || []).concat(divs); savePortfolio(p2);
    }
    return { added, total: rows.length, failed, dividends: divs.length };
  });
}
function resetPortfolio(accountId) {
  return withLock(() => {
    const p = loadPortfolio();
    const acc = resolveAccount(p, accountId);
    acc.positions = []; acc.transactions = [];
    savePortfolio(p);
    return p;
  });
}

// --------------------------------------------------------------------------
// PIN lock — gates the API (UI shell stays public). The PIN is scrypt-hashed
// in data/auth.json; sessions live in memory so they clear on server restart.
// --------------------------------------------------------------------------
const AUTH_FILE = path.join(DATA_DIR, 'auth.json');
const SESSION_TTL = (Number(process.env.LOCK_IDLE_MIN) || 480) * 60 * 1000; // idle timeout
const sessions = new Map();
let failCount = 0, lockUntil = 0;
function loadAuth() { try { return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8')); } catch { return null; } }
function hashPin(pin, salt) { return crypto.scryptSync(String(pin), salt, 32).toString('hex'); }
function setPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(AUTH_FILE, JSON.stringify({ salt, hash: hashPin(pin, salt), createdAt: Date.now() }, null, 2));
}
function verifyPin(pin) {
  const a = loadAuth(); if (!a) return false;
  try { return crypto.timingSafeEqual(Buffer.from(hashPin(pin, a.salt), 'hex'), Buffer.from(a.hash, 'hex')); }
  catch { return false; }
}
function newSession() { const t = crypto.randomBytes(24).toString('hex'); sessions.set(t, { at: Date.now() }); return t; }
function sessionValid(t) {
  const s = t && sessions.get(t); if (!s) return false;
  if (Date.now() - s.at > SESSION_TTL) { sessions.delete(t); return false; }
  s.at = Date.now(); return true;
}
function getCookie(req, name) {
  const m = (req.headers.cookie || '').match(new RegExp('(?:^|;\\s*)' + name + '=([^;]+)'));
  return m ? m[1] : null;
}
function setSessionCookie(res, token) { res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Strict; Path=/`); }
const PIN_RE = /^\d{4,12}$/;

// --------------------------------------------------------------------------
// HTTP server
// --------------------------------------------------------------------------
function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve) => {
    let data = '', done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } }; // always settle, even on teardown
    const MAX = 25e6; // big enough for full broker statements
    req.on('data', (c) => { data += c; if (data.length > MAX) { req.destroy(); finish({}); } });
    req.on('end', () => { try { finish(data ? JSON.parse(data) : {}); } catch { finish({}); } });
    req.on('aborted', () => finish({}));
    req.on('error', () => finish({}));
    req.on('close', () => finish({}));
  });
}

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.png': 'image/png',
};
function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, `http://${req.headers.host}`);
  const p = u.pathname;
  try {
    if (p === '/api/health') return sendJson(res, 200, { ok: true, time: Date.now() });

    // ---- auth (always reachable) ----
    if (p === '/api/auth/status') {
      return sendJson(res, 200, { pinSet: !!loadAuth(), authed: sessionValid(getCookie(req, 'sid')) });
    }
    if (p === '/api/auth/setup' && req.method === 'POST') {
      if (loadAuth()) return sendJson(res, 400, { error: 'A PIN is already set' });
      const b = await readBody(req); const pin = String(b.pin || '');
      if (!PIN_RE.test(pin)) return sendJson(res, 400, { error: 'PIN must be 4–12 digits' });
      setPin(pin); setSessionCookie(res, newSession());
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/auth/login' && req.method === 'POST') {
      if (Date.now() < lockUntil) return sendJson(res, 429, { error: `Too many tries — wait ${Math.ceil((lockUntil - Date.now()) / 1000)}s` });
      const b = await readBody(req);
      if (verifyPin(String(b.pin || ''))) { failCount = 0; setSessionCookie(res, newSession()); return sendJson(res, 200, { ok: true }); }
      failCount++;
      if (failCount >= 5) lockUntil = Date.now() + Math.min(300, 15 * (failCount - 4)) * 1000;
      return sendJson(res, 401, { error: 'Wrong PIN' });
    }
    if (p === '/api/auth/logout' && req.method === 'POST') {
      const t = getCookie(req, 'sid'); if (t) sessions.delete(t);
      res.setHeader('Set-Cookie', 'sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
      return sendJson(res, 200, { ok: true });
    }
    if (p === '/api/auth/change' && req.method === 'POST') {
      const b = await readBody(req);
      if (!sessionValid(getCookie(req, 'sid'))) return sendJson(res, 401, { error: 'Locked' });
      if (!verifyPin(String(b.current || ''))) return sendJson(res, 401, { error: 'Current PIN is wrong' });
      if (!PIN_RE.test(String(b.pin || ''))) return sendJson(res, 400, { error: 'New PIN must be 4–12 digits' });
      setPin(String(b.pin)); return sendJson(res, 200, { ok: true });
    }
    // ---- gate everything else under /api/ behind a valid session ----
    if (p.startsWith('/api/') && loadAuth() && !sessionValid(getCookie(req, 'sid'))) {
      return sendJson(res, 401, { error: 'Locked. Enter your PIN.' });
    }

    if (p === '/api/quote') {
      const symbols = (u.searchParams.get('symbols') || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!symbols.length) return sendJson(res, 400, { error: 'symbols required' });
      return sendJson(res, 200, { quotes: await getQuotes(symbols) });
    }
    if (p === '/api/history') {
      const symbol = u.searchParams.get('symbol');
      if (!symbol) return sendJson(res, 400, { error: 'symbol required' });
      return sendJson(res, 200, await getHistory(symbol, u.searchParams.get('range') || '1mo', u.searchParams.get('interval') || '1d'));
    }
    if (p === '/api/search') {
      const q = u.searchParams.get('q') || '';
      if (q.length < 1) return sendJson(res, 200, []);
      return sendJson(res, 200, await search(q));
    }
    if (p === '/api/markets') return sendJson(res, 200, await getMarkets());
    if (p === '/api/worldbank') {
      const country = u.searchParams.get('country') || 'WLD';
      const indicator = u.searchParams.get('indicator') || 'NY.GDP.MKTP.CD';
      return sendJson(res, 200, await worldBank(country, indicator));
    }
    if (p === '/api/fred') {
      return sendJson(res, 200, await getFred(
        u.searchParams.get('series') || 'DGS10',
        u.searchParams.get('transform') || 'lin',
        u.searchParams.get('start') || '2015-01-01'));
    }

    const base = u.searchParams.get('base') || 'SGD';
    const acct = u.searchParams.get('account') || undefined; // undefined -> active account

    // accounts
    if (p === '/api/accounts' && req.method === 'GET') return sendJson(res, 200, listAccounts());
    if (p === '/api/accounts/add' && req.method === 'POST') {
      const b = await readBody(req); const id = await accountAdd(b.name, b.type);
      return sendJson(res, 200, { ...listAccounts(), newId: id });
    }
    if (p === '/api/accounts/rename' && req.method === 'POST') {
      const b = await readBody(req); await accountRename(b.id, b.name, b.type);
      return sendJson(res, 200, listAccounts());
    }
    if (p === '/api/accounts/remove' && req.method === 'POST') {
      const b = await readBody(req); await accountRemove(b.id);
      return sendJson(res, 200, listAccounts());
    }

    if (p === '/api/portfolio' && req.method === 'GET') return sendJson(res, 200, await portfolioWithQuotes(base, acct));
    if (p === '/api/portfolio/buy' && req.method === 'POST') {
      const b = await readBody(req); await buy(b.symbol, b.quantity, b.price, b.date ? Date.parse(b.date) : null, acct, base);
      return sendJson(res, 200, await portfolioWithQuotes(base, acct));
    }
    if (p === '/api/portfolio/sell' && req.method === 'POST') {
      const b = await readBody(req); const r = await sell(b.symbol, b.quantity, b.price, acct, base);
      const pf = await portfolioWithQuotes(base, acct); pf.lastRealized = r.realized;
      return sendJson(res, 200, pf);
    }
    if (p === '/api/portfolio/delete' && req.method === 'POST') {
      const b = await readBody(req); await del(b.symbol, acct);
      return sendJson(res, 200, await portfolioWithQuotes(base, acct));
    }
    if (p === '/api/portfolio/import' && req.method === 'POST') {
      const b = await readBody(req); const r = await importCsv(b.csv, !!b.replace, acct, base);
      const pf = await portfolioWithQuotes(base, acct); pf.imported = r;
      return sendJson(res, 200, pf);
    }
    if (p === '/api/portfolio/reset' && req.method === 'POST') {
      await resetPortfolio(acct); return sendJson(res, 200, await portfolioWithQuotes(base, acct));
    }

    // watchlist
    if (p === '/api/watchlist' && req.method === 'GET') return sendJson(res, 200, { watchlist: await watchlistWithQuotes() });
    if (p === '/api/watchlist/add' && req.method === 'POST') {
      const b = await readBody(req); await watchAdd(b.symbol);
      return sendJson(res, 200, { watchlist: await watchlistWithQuotes() });
    }
    if (p === '/api/watchlist/remove' && req.method === 'POST') {
      const b = await readBody(req); await watchRemove(b.symbol);
      return sendJson(res, 200, { watchlist: await watchlistWithQuotes() });
    }

    // alerts
    if (p === '/api/alerts' && req.method === 'GET') return sendJson(res, 200, { alerts: await alertsWithStatus() });
    if (p === '/api/alerts/add' && req.method === 'POST') {
      const b = await readBody(req); await alertAdd(b);
      return sendJson(res, 200, { alerts: await alertsWithStatus() });
    }
    if (p === '/api/alerts/remove' && req.method === 'POST') {
      const b = await readBody(req); await alertRemove(b.id);
      return sendJson(res, 200, { alerts: await alertsWithStatus() });
    }

    // news
    if (p === '/api/news') return sendJson(res, 200, { news: await getNews(u.searchParams.get('symbol') || '') });

    // categories (sector) + portfolio performance (charts/heatmap)
    if (p === '/api/categories') {
      const symbols = (u.searchParams.get('symbols') || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (!symbols.length) return sendJson(res, 200, {});
      return sendJson(res, 200, await getCategories(symbols));
    }
    if (p === '/api/dividends') {
      return sendJson(res, 200, await dividendsReport(base, acct));
    }
    if (p === '/api/portfolio/performance') {
      return sendJson(res, 200, await portfolioPerformance(u.searchParams.get('range') || '1y', base, acct));
    }
    if (p === '/api/fx-risk') {
      return sendJson(res, 200, await fxRisk(base, acct));
    }
    if (p === '/api/calendar') {
      return sendJson(res, 200, await getCalendar());
    }

    if (p.startsWith('/api/')) return sendJson(res, 404, { error: 'Unknown endpoint' });
    return serveStatic(req, res, p);
  } catch (err) {
    return sendJson(res, 500, { error: String(err && err.message || err) });
  }
});

// Background alert checker — evaluates alerts on a timer and fires desktop
// notifications even when no browser is open. Override cadence with ALERT_INTERVAL (seconds).
const ALERT_INTERVAL = Math.max(15, Number(process.env.ALERT_INTERVAL) || 60) * 1000;
setInterval(() => { evaluateAlerts(true).catch(() => {}); }, ALERT_INTERVAL);

server.listen(PORT, () => {
  console.log(`\n  FINSIGHT // PERSONAL TERMINAL`);
  console.log(`  running at  http://localhost:${PORT}`);
  console.log(`  portfolio   ${PORTFOLIO_FILE}`);
  console.log(`  data        free / no-key (Yahoo Finance, World Bank, FRED)`);
  console.log(`  alerts      background check every ${ALERT_INTERVAL / 1000}s` +
    (process.env.NOTIFY === '0' ? ' (desktop notifications off)' : ' → macOS notifications') + `\n`);
});
