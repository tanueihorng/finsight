'use strict';
// Market data from Yahoo Finance (free, no key): quotes, history, FX, search,
// world markets, news and sector categories.
const { UA } = require('./config');
const { cacheGet, cacheSet, cached } = require('./cache');

// --------------------------------------------------------------------------
// HTTP fetch helpers (with timeout + Yahoo host fallback)
// --------------------------------------------------------------------------
async function fetchJson(url, { timeout = 12000, headers = {} } = {}) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*', ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) { const e = new Error(`HTTP ${res.status} for ${url}`); e.status = res.status; throw e; }
  return res.json();
}

// Yahoo rate-limits (HTTP 429) aggressively. After a 429 on both hosts, stop
// calling for a cooldown that doubles each time (1 min -> 10 min max) instead of
// hammering it; callers fall back to cached values meanwhile.
const yahooBackoff = { until: 0, delay: 0 };
async function yahooFetch(pathAndQuery) {
  if (Date.now() < yahooBackoff.until) {
    const e = new Error(`Yahoo rate-limited — retrying in ${Math.ceil((yahooBackoff.until - Date.now()) / 1000)}s`);
    e.status = 429; throw e;
  }
  // Try query1 then query2 for resilience.
  let lastErr, limited = 0;
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const out = await fetchJson(`https://${host}${pathAndQuery}`);
      yahooBackoff.delay = 0;
      return out;
    } catch (e) { lastErr = e; if (e.status === 429) limited++; }
  }
  if (limited === 2) {
    yahooBackoff.delay = Math.min(10 * 60000, (yahooBackoff.delay || 30000) * 2);
    yahooBackoff.until = Date.now() + yahooBackoff.delay;
    console.warn(`Yahoo returned 429 — backing off ${yahooBackoff.delay / 1000}s (serving cached data).`);
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

function getQuote(symbol) {
  return cached(`q:${symbol}`, 15000, async () => {
    const data = await yahooFetch(`/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`);
    const result = data?.chart?.result?.[0];
    if (!result?.meta) throw new Error(`No data for ${symbol}`);
    return normalizeQuote(symbol, result.meta);
  }, { stale: 0, persist: true }); // last price survives restarts / outages (served only if a fetch fails)
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
  const hit = cacheGet(key);
  if (hit != null) return hit;
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
  const hit = cacheGet(key);
  if (hit != null) return hit;
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
  const hit = cacheGet(key); if (hit != null) return hit;
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

function getHistory(symbol, range = '1mo', interval = '1d') {
  // Intraday bars move; daily/weekly history of a long range barely does, so it
  // can be served stale while it refreshes, and persisted across restarts.
  const intraday = /m$|h$/.test(interval);
  const ttl = intraday ? 60000 : (range === '1d' || range === '5d') ? 5 * 60000 : 15 * 60000;
  return cached(`h:${symbol}:${range}:${interval}`, ttl, () => fetchHistory(symbol, range, interval),
    { stale: intraday ? 0 : 7 * 24 * 60 * 60000, persist: !intraday });
}
async function fetchHistory(symbol, range, interval) {
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
  return { symbol, range, interval, meta: result.meta ? normalizeQuote(symbol, result.meta) : null, points };
}

function search(q) {
  return cached(`s:${q.toLowerCase()}`, 5 * 60000, () => fetchSearch(q));
}
async function fetchSearch(q) {
  const data = await yahooFetch(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`);
  const quotes = (data?.quotes || [])
    .filter((x) => x.symbol)
    .map((x) => ({
      symbol: x.symbol,
      name: x.longname || x.shortname || x.symbol,
      exchange: x.exchDisp || x.exchange || '',
      type: x.typeDisp || x.quoteType || '',
    }));
  return quotes;
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

function getMarkets() {
  return cached('markets', 30000, fetchMarkets, { stale: 5 * 60000 });
}
async function fetchMarkets() {
  // Groups fetch in parallel: five serialized Yahoo round-trips made first paint
  // of World Markets crawl and multiplied bot-detection exposure.
  const entries = Object.entries(MARKET_GROUPS);
  const lists = await Promise.all(entries.map(async ([, items]) => {
    const quotes = await getQuotes(items.map((i) => i[0]));
    return quotes.map((qd, idx) => ({ ...qd, label: items[idx][1] }));
  }));
  return Object.fromEntries(entries.map(([group], i) => [group, lists[i]])); // stable group order
}

// --------------------------------------------------------------------------
// News (free, no key, via Yahoo search)
// --------------------------------------------------------------------------
function getNews(symbol) {
  const q = symbol ? symbol : 'stock market';
  return cached(`news:${q.toLowerCase()}`, 5 * 60000, () => fetchNews(q), { stale: 60 * 60000 });
}
async function fetchNews(q) {
  const data = await yahooFetch(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=0&newsCount=14`);
  const items = (data?.news || []).map((n) => ({
    title: n.title,
    publisher: n.publisher,
    link: n.link,
    time: n.providerPublishTime ? n.providerPublishTime * 1000 : null,
    tickers: n.relatedTickers || [],
  }));
  return items;
}

// --------------------------------------------------------------------------
// Category / sector (for the heatmap). Sector for equities (via search),
// otherwise bucketed by instrument type. Free, no key.
// --------------------------------------------------------------------------
const TYPE_BUCKET = {
  ETF: 'ETF / Fund', MUTUALFUND: 'ETF / Fund', CRYPTOCURRENCY: 'Crypto',
  FUTURE: 'Commodity', INDEX: 'Index', CURRENCY: 'FX', EQUITY: 'Other',
};
function getCategory(symbol) {
  symbol = symbol.toUpperCase();
  return cached(`cat:${symbol}`, 24 * 60 * 60000, () => fetchCategory(symbol), { stale: 30 * 24 * 60 * 60000, persist: true });
}
async function fetchCategory(symbol) {
  let sector = null, type = null;
  try {
    const data = await yahooFetch(`/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=8&newsCount=0`);
    const q = (data?.quotes || []).find((x) => x.symbol === symbol) || (data?.quotes || [])[0] || {};
    sector = q.sector || null;
    type = (q.quoteType || q.typeDisp || '').toUpperCase();
  } catch {}
  const category = sector || TYPE_BUCKET[type] || 'Other';
  return { symbol, sector: sector || null, type: type || null, category };
}
async function getCategories(symbols) {
  const out = await Promise.allSettled(symbols.map(getCategory));
  const map = {};
  out.forEach((r, i) => { map[symbols[i].toUpperCase()] = r.status === 'fulfilled' ? r.value : { symbol: symbols[i], category: 'Other' }; });
  return map;
}

module.exports = {
  fetchJson, yahooFetch, getQuote, getQuotes, getFxRate, usdToBaseAt, fxRateAt, weeklyFxVol,
  getHistory, search, getMarkets, getNews, getCategories,
};
