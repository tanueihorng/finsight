// Market data from Yahoo Finance (free, no key): quotes, history, FX, search,
// world markets, news and sector categories.
import { UA } from './config.ts';
import { cacheGet, cacheSet, cached, cachedWithStatus } from './cache.ts';
import { install as installFakeMarket } from './fakemarket.ts';
import type { QuotedQuote, Quote, History, HistoryPoint, SearchResult, NewsItem, Category, Markets } from '../shared/types.ts';
// E2E only: answer every market fetch from local fixtures (see lib/fakemarket.ts).
// Runs before anything here can fetch; the import above only defines it.
if (process.env.FINSIGHT_FAKE_MARKET === '1') installFakeMarket();

/** An upstream HTTP failure, with the status when there was a response. */
export type HttpError = Error & { status?: number };
// Yahoo response shapes: only the fields read here, all optional upstream.
interface YahooMeta {
  symbol?: string; longName?: string; shortName?: string; currency?: string; fullExchangeName?: string; exchangeName?: string;
  instrumentType?: string; regularMarketPrice?: number | null; chartPreviousClose?: number | null; previousClose?: number | null;
  regularMarketDayHigh?: number | null; regularMarketDayLow?: number | null; fiftyTwoWeekHigh?: number | null; fiftyTwoWeekLow?: number | null;
  regularMarketVolume?: number | null; regularMarketTime?: number | null;
}
type Col = (number | null)[];
interface YahooChart {
  chart?: { result?: {
    meta?: YahooMeta; timestamp?: number[];
    indicators?: { quote?: { close?: Col; open?: Col; high?: Col; low?: Col; volume?: Col }[]; adjclose?: { adjclose?: Col }[] };
    events?: { dividends?: Record<string, { date: number; amount: number }> };
  }[] | null };
}
interface YahooSearch {
  quotes?: { symbol?: string; longname?: string; shortname?: string; exchDisp?: string; exchange?: string; typeDisp?: string; quoteType?: string; sector?: string }[];
  news?: { title?: string; publisher?: string; link?: string; providerPublishTime?: number; relatedTickers?: string[] }[];
}
type Raw = number | { raw?: number } | undefined;
interface YahooQuoteDetail {
  symbol: string; currency?: string; isEarningsDateEstimate?: boolean;
  [field: string]: Raw | string | boolean | undefined;
}
/** Earnings and dividend fields per symbol (v7 quote API). */
export interface QuoteDetails {
  dividendRate: number | null; trailingDividendRate: number | null; dividendYield: number | null;
  dividendDate: number | null; exDividendDate: number | null; earningsStart: number | null; earningsEnd: number | null;
  earningsEstimated: boolean | null; currency: string | null;
  marketCap: number | null; trailingPE: number | null; forwardPE: number | null;
}
export interface DividendPayment { t: number; amount: number }

// --------------------------------------------------------------------------
// HTTP fetch helpers (with timeout + Yahoo host fallback)
// --------------------------------------------------------------------------
export async function fetchJson<T = unknown>(url: string, { timeout = 12000, headers = {} }: { timeout?: number; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json,text/plain,*/*', ...headers },
    signal: AbortSignal.timeout(timeout),
  });
  if (!res.ok) { const e: HttpError = new Error(`HTTP ${res.status} for ${url}`); e.status = res.status; throw e; }
  return res.json() as Promise<T>;
}

// Yahoo rate-limits (HTTP 429) aggressively. After a 429 on both hosts, stop
// calling for a cooldown that doubles each time (1 min -> 10 min max) instead of
// hammering it; callers fall back to cached values meanwhile.
const yahooBackoff = { until: 0, delay: 0 };
export async function yahooFetch<T = unknown>(pathAndQuery: string): Promise<T> {
  if (Date.now() < yahooBackoff.until) {
    const e: HttpError = new Error(`Yahoo rate-limited — retrying in ${Math.ceil((yahooBackoff.until - Date.now()) / 1000)}s`);
    e.status = 429; throw e;
  }
  // Try query1 then query2 for resilience.
  let lastErr: unknown, limited = 0;
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    try {
      const out = await fetchJson<T>(`https://${host}${pathAndQuery}`);
      yahooBackoff.delay = 0;
      return out;
    } catch (e) { lastErr = e; if ((e as HttpError).status === 429) limited++; }
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
function normalizeQuote(symbol: string, meta: YahooMeta): QuotedQuote {
  const price = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose != null ? meta.chartPreviousClose : meta.previousClose;
  const change = price != null && prev != null ? price - prev : null;
  const changePct = change != null && prev ? (change / prev) * 100 : null;
  return {
    symbol: meta.symbol || symbol,
    name: meta.longName || meta.shortName || meta.symbol || symbol,
    currency: meta.currency || 'USD',
    currencyReported: Boolean(meta.currency),
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

export async function getQuote(symbol: string): Promise<QuotedQuote> {
  const result = await cachedWithStatus(`q:${symbol}`, 15000, async () => {
    const data = await yahooFetch<YahooChart>(`/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`);
    const result = data?.chart?.result?.[0];
    if (!result?.meta) throw new Error(`No data for ${symbol}`);
    return normalizeQuote(symbol, result.meta);
  }, { stale: 0, persist: true }); // last price survives restarts / outages (served only if a fetch fails)
  return { ...result.value, cache: result.cache };
}

export async function getQuotes(symbols: string[]): Promise<Quote[]> {
  const out = await Promise.allSettled(symbols.map((s) => getQuote(s)));
  return out.map((r, i) =>
    r.status === 'fulfilled' ? r.value : { symbol: symbols[i]!, error: String(r.reason && r.reason.message || r.reason) }
  );
}

// FX rate: how many units of `to` per 1 unit of `from` (e.g. USD->SGD ~ 1.29).
// Uses Yahoo FX pairs (FROMTO=X) with an inverse fallback. Free, no key.
export async function getFxRate(from: string | null | undefined, to: string | null | undefined): Promise<number> {
  from = (from || 'USD').toUpperCase();
  to = (to || 'USD').toUpperCase();
  if (from === to) return 1;
  const key = `fx:${from}:${to}`;
  const hit = cacheGet<number>(key);
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
export async function usdToBaseAt(base: string | null | undefined): Promise<(t: number | null | undefined) => number | null> {
  base = (base || 'USD').toUpperCase();
  if (base === 'USD') return () => 1;
  let curRate = 1;
  try { curRate = await getFxRate('USD', base); } catch {}
  const key = `usdbaseseries:${base}`;
  let series = cacheGet<{ t: number; c: number }[]>(key);
  if (!series) {
    try {
      const h = await getHistory(`USD${base}=X`, '10y', '1wk'); // match fxRateAt's window
      series = (h.points || []).filter((pt) => pt.c != null).map((pt) => ({ t: pt.t, c: pt.c }));
    } catch { series = []; }
    cacheSet(key, series, 6 * 60 * 60000);
  }
  const recentMs = 7 * 24 * 60 * 60000;
  const s = series;
  return (t) => {
    if (!t) return null;
    if (Date.now() - t < recentMs || !s.length) return curRate;
    let best = s[0]!.c;
    for (const pt of s) { if (pt.t <= t) best = pt.c; else break; }
    return best;
  };
}

// Historical FX rate: units of `to` per 1 `from`, on/just before timestamp t (ms).
// Used to record the true exchange rate for a back-dated / imported purchase.
export async function fxRateAt(from: string | null | undefined, to: string | null | undefined, t: number | null | undefined): Promise<number> {
  from = (from || 'USD').toUpperCase();
  to = (to || 'USD').toUpperCase();
  if (from === to) return 1;
  if (!t || Date.now() - t < 5 * 24 * 60 * 60000) return getFxRate(from, to); // recent -> spot
  const day = new Date(t).toISOString().slice(0, 10);
  const key = `fxat:${from}:${to}:${day}`;
  const hit = cacheGet<number>(key);
  if (hit != null) return hit;
  for (const [sym, inverse] of [[`${from}${to}=X`, false], [`${to}${from}=X`, true]] as const) {
    try {
      const h = await getHistory(sym, '10y', '1wk');
      const pts = (h.points || []).filter((p) => p.c != null);
      if (pts.length) {
        let best = pts[0]!.c;
        for (const p of pts) { if (p.t <= t) best = p.c; else break; }
        return cacheSet(key, inverse ? 1 / best : best, 24 * 60 * 60000);
      }
    } catch {}
  }
  return getFxRate(from, to); // fallback to spot
}

// Weekly FX volatility: stdev of weekly log-returns of `from`->`to` over 5y.
// Drives a simple 1-week parametric VaR. Free (Yahoo weekly history); cached 6h.
export async function weeklyFxVol(from: string | null | undefined, to: string | null | undefined): Promise<number> {
  from = (from || 'USD').toUpperCase(); to = (to || 'USD').toUpperCase();
  if (from === to) return 0;
  const key = `fxvol:${from}:${to}`;
  const hit = cacheGet<number>(key); if (hit != null) return hit;
  let closes: number[] = [];
  for (const [sym, inv] of [[`${from}${to}=X`, false], [`${to}${from}=X`, true]] as const) {
    try {
      const h = await getHistory(sym, '5y', '1wk');
      const pts = (h.points || []).filter((pt) => pt.c != null).map((pt) => (inv ? 1 / pt.c : pt.c));
      if (pts.length > 30) { closes = pts; break; }
    } catch {}
  }
  if (closes.length < 30) return cacheSet(key, 0, 6 * 60 * 60000);
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) if (closes[i - 1]! > 0 && closes[i]! > 0) rets.push(Math.log(closes[i]! / closes[i - 1]!));
  const n = rets.length;
  if (n < 2) return cacheSet(key, 0, 6 * 60 * 60000);
  const mean = rets.reduce((a, b) => a + b, 0) / n;
  const variance = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (n - 1);
  return cacheSet(key, Math.sqrt(variance), 6 * 60 * 60000);
}

export async function getHistory(symbol: string, range = '1mo', interval = '1d'): Promise<History> {
  // Intraday bars move; daily/weekly history of a long range barely does, so it
  // can be served stale while it refreshes, and persisted across restarts.
  const intraday = /m$|h$/.test(interval);
  const ttl = intraday ? 60000 : (range === '1d' || range === '5d') ? 5 * 60000 : 15 * 60000;
  // hv2: entries carry meta.currencyReported, so none saved before it was added are served.
  const result = await cachedWithStatus(`hv2:${symbol}:${range}:${interval}`, ttl, () => fetchHistory(symbol, range, interval),
    { stale: intraday ? 0 : 7 * 24 * 60 * 60000, persist: !intraday });
  return { ...result.value, cache: result.cache };
}
async function fetchHistory(symbol: string, range: string, interval: string): Promise<History> {
  const data = await yahooFetch<YahooChart>(
    `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`
  );
  const result = data?.chart?.result?.[0];
  if (!result) throw new Error(`No history for ${symbol}`);
  const ts = result.timestamp || [];
  const q: NonNullable<NonNullable<typeof result.indicators>['quote']>[number] = result.indicators?.quote?.[0] || {};
  const closes = q.close || [], opens = q.open || [], highs = q.high || [], lows = q.low || [], vols = q.volume || [];
  // Keep `c` (and the c-not-null filter) so every existing consumer that reads
  // point.c — performance/fx/wb/fred — is unaffected; OHLCV is purely additive
  // so the security-detail chart can render candlesticks + volume.
  // `adj` (dividend-adjusted close) is additive too; `c` is split-adjusted only.
  const adj = result.indicators?.adjclose?.[0]?.adjclose;
  const points = ts
    .map((t, i) => ({ t: t * 1000, o: opens[i], h: highs[i], l: lows[i], c: closes[i], v: vols[i], ...(adj ? { adj: adj[i] } : {}) }))
    .filter((p) => p.c != null) as HistoryPoint[]; // c is a number after the filter
  // normalizeQuote fills a missing currency with USD for display; currencyReported
  // tells callers that must not assume (portfolio backtests) whether Yahoo sent one.
  return { symbol, range, interval, meta: result.meta ? normalizeQuote(symbol, result.meta) : null, points };
}

export function search(q: string): Promise<SearchResult[]> {
  return cached(`s:${q.toLowerCase()}`, 5 * 60000, () => fetchSearch(q));
}
async function fetchSearch(q: string): Promise<SearchResult[]> {
  const data = await yahooFetch<YahooSearch>(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=10&newsCount=0`);
  const quotes = (data?.quotes || [])
    .filter((x) => x.symbol)
    .map((x) => ({
      symbol: x.symbol!,
      name: x.longname || x.shortname || x.symbol!,
      exchange: x.exchDisp || x.exchange || '',
      type: x.typeDisp || x.quoteType || '',
    }));
  return quotes;
}

// Yahoo's v7 quote API (earnings dates, dividend rate/dates) needs a session
// cookie + "crumb". Both are free and key-less: get the cookie from fc.yahoo.com,
// then the crumb. Cached for 12h and dropped on a 401 so it re-handshakes.
let crumbState: { cookie: string; crumb: string; at: number } | null = null;
async function yahooCrumb(force: boolean) {
  if (!force && crumbState && Date.now() - crumbState.at < 12 * 60 * 60000) return crumbState;
  const r = await fetch('https://fc.yahoo.com', { headers: { 'User-Agent': UA }, redirect: 'manual', signal: AbortSignal.timeout(10000) });
  const setCookies = typeof r.headers.getSetCookie === 'function' ? r.headers.getSetCookie() : [];
  const cookie = setCookies.map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('Yahoo session cookie unavailable');
  const c = await fetch('https://query2.finance.yahoo.com/v1/test/getcrumb',
    { headers: { 'User-Agent': UA, Cookie: cookie }, signal: AbortSignal.timeout(10000) });
  const crumb = c.ok ? (await c.text()).trim() : '';
  if (!crumb || crumb.length > 40 || /[<\s]/.test(crumb)) throw new Error('Yahoo crumb unavailable');
  crumbState = { cookie, crumb, at: Date.now() };
  return crumbState;
}
const pickRaw = (v: unknown): any => (v && typeof v === 'object' && 'raw' in v ? v.raw : v); // a number or an upstream oddity
// Earnings + dividend fields for many symbols in one request (cached 6h).
export function getQuoteDetails(symbols: string[]): Promise<Record<string, QuoteDetails>> {
  const list = [...new Set(symbols.map((s) => s.toUpperCase()))].sort();
  if (!list.length) return Promise.resolve({});
  return cached(`qd:${list.join(',')}`, 6 * 60 * 60000, async () => {
    let lastErr: unknown;
    for (const force of [false, true]) {
      try {
        const { cookie, crumb } = await yahooCrumb(force);
        const data = await fetchJson<{ quoteResponse?: { result?: YahooQuoteDetail[] } }>(`https://query2.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(list.join(','))}&crumb=${encodeURIComponent(crumb)}`,
          { headers: { Cookie: cookie } });
        const out: Record<string, QuoteDetails> = {};
        for (const q of data?.quoteResponse?.result || []) {
          const sec = (k: string) => { const v = pickRaw(q[k]); return Number.isFinite(v) ? v * 1000 : null; };
          out[q.symbol.toUpperCase()] = {
            dividendRate: pickRaw(q.dividendRate) ?? null,                  // forward annual, per share
            trailingDividendRate: pickRaw(q.trailingAnnualDividendRate) ?? null,
            dividendYield: pickRaw(q.dividendYield) ?? null,
            dividendDate: sec('dividendDate'),                             // next/last payment date
            exDividendDate: sec('exDividendDate'),
            earningsStart: sec('earningsTimestampStart') ?? sec('earningsTimestamp'),
            earningsEnd: sec('earningsTimestampEnd'),
            earningsEstimated: q.isEarningsDateEstimate ?? null,
            currency: q.currency || null,
            marketCap: pickRaw(q.marketCap) ?? null,
            trailingPE: pickRaw(q.trailingPE) ?? null,
            forwardPE: pickRaw(q.forwardPE) ?? null,
          };
        }
        return out;
      } catch (e) { lastErr = e; if ((e as HttpError).status !== 401 && (e as HttpError).status !== 403) break; }
    }
    throw lastErr;
  }, { stale: 3 * 24 * 60 * 60000, persist: true });
}
// Fund profile and top holdings (cached 24h). Yahoo aggregates these; it is not
// the issuer, so callers must label it and keep the issuer factsheet as a gap.
// Holdings cover only the listed top positions; their sum is reported, not 100%.
export interface FundProfile {
  symbol: string; family: string | null; category: string | null; legalType: string | null;
  expenseRatioPct: number | null; totalAssets: number | null; currency: string | null;
  assetMix: { stocksPct: number | null; bondsPct: number | null; cashPct: number | null; otherPct: number | null };
  topHoldings: { symbol: string | null; name: string; weightPct: number }[]; topHoldingsPct: number | null;
  // Aggregator's holdings-weighted equity multiples; undated.
  equityValuation: { priceToEarnings: number | null; priceToBook: number | null; priceToSales: number | null };
  sectorWeights: { sector: string; weightPct: number }[];
}
const num = (v: unknown) => { const n = pickRaw(v); return Number.isFinite(n) ? Math.round(n * 100) / 100 : null; };
const pct100 = (v: unknown) => { const n = pickRaw(v); return Number.isFinite(n) ? Math.round(n * 10000) / 100 : null; };
export function getFundProfile(symbol: string): Promise<FundProfile> {
  symbol = symbol.toUpperCase();
  return cached(`fund:${symbol}`, 24 * 60 * 60000, async () => {
    let lastErr: unknown;
    for (const force of [false, true]) {
      try {
        const { cookie, crumb } = await yahooCrumb(force);
        const data = await fetchJson<{ quoteSummary?: { result?: any[] } }>(`https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=topHoldings,fundProfile,summaryDetail&crumb=${encodeURIComponent(crumb)}`, { headers: { Cookie: cookie } });
        const r = data?.quoteSummary?.result?.[0];
        if (!r?.topHoldings && !r?.fundProfile) throw new Error(`No fund profile for ${symbol}`);
        const th = r.topHoldings || {}, fp = r.fundProfile || {}, sd = r.summaryDetail || {};
        const topHoldings = (th.holdings || []).map((h: any) => ({ symbol: h.symbol || null, name: String(h.holdingName || h.symbol || ''), weightPct: pct100(h.holdingPercent) })).filter((h: any) => h.name && h.weightPct !== null);
        const sectorWeights = (th.sectorWeightings || []).flatMap((o: any) => Object.entries(o).map(([sector, v]) => ({ sector, weightPct: pct100(v) }))).filter((x: any) => x.weightPct !== null);
        const sum = topHoldings.reduce((s: number, h: any) => s + h.weightPct, 0);
        return {
          symbol, family: fp.family || null, category: fp.categoryName || null, legalType: fp.legalType || null,
          expenseRatioPct: pct100(fp.feesExpensesInvestment?.annualReportExpenseRatio), totalAssets: pickRaw(sd.totalAssets) ?? null, currency: sd.currency || null,
          assetMix: { stocksPct: pct100(th.stockPosition), bondsPct: pct100(th.bondPosition), cashPct: pct100(th.cashPosition), otherPct: pct100(th.otherPosition) },
          topHoldings, topHoldingsPct: topHoldings.length ? Math.round(sum * 100) / 100 : null, sectorWeights,
          equityValuation: { priceToEarnings: num(th.equityHoldings?.priceToEarnings), priceToBook: num(th.equityHoldings?.priceToBook), priceToSales: num(th.equityHoldings?.priceToSales) },
        };
      } catch (e) { lastErr = e; if ((e as HttpError).status !== 401 && (e as HttpError).status !== 403) break; }
    }
    throw lastErr;
  }, { stale: 7 * 24 * 60 * 60000, persist: true });
}

// Dividend payments per share over ~5 years: [{ t (ex-date ms), amount }].
export function getDividendHistory(symbol: string): Promise<DividendPayment[]> {
  return cached(`dh:${symbol}`, 12 * 60 * 60000, async () => {
    const data = await yahooFetch<YahooChart>(`/v8/finance/chart/${encodeURIComponent(symbol)}?range=5y&interval=1mo&events=div`);
    const ev = data?.chart?.result?.[0]?.events?.dividends || {};
    return Object.values(ev).map((d) => ({ t: d.date * 1000, amount: d.amount }))
      .filter((d) => Number.isFinite(d.t) && d.amount > 0).sort((a, b) => a.t - b.t);
  }, { stale: 7 * 24 * 60 * 60000, persist: true });
}

// World market overview groups (all free, no key) -----------------------------
const MARKET_GROUPS: Record<string, [string, string][]> = {
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

// Yahoo's predefined screens (day_gainers, day_losers): key-less, US-listed
// equities only (the region parameter is ignored), filtered by Yahoo's own
// criteria. Cached 60 s; a failed refresh serves the last list for 15 min.
export interface ScreenerQuote {
  symbol?: string; shortName?: string; longName?: string; quoteType?: string; currency?: string; exchange?: string; fullExchangeName?: string;
  regularMarketPrice?: number; regularMarketChangePercent?: number; regularMarketChange?: number; regularMarketPreviousClose?: number;
  regularMarketTime?: number; marketCap?: number; regularMarketVolume?: number; averageDailyVolume3Month?: number; marketState?: string;
}
export interface Screen { id: string; title: string; description: string; total: number; quotes: ScreenerQuote[] }
export async function getScreen(id: 'day_gainers' | 'day_losers', count = 25) {
  return cachedWithStatus(`screen:${id}:${count}`, 60000, async (): Promise<Screen> => {
    const data = await yahooFetch<{ finance?: { result?: { title?: string; description?: string; total?: number; quotes?: ScreenerQuote[] }[] | null } }>(
      `/v1/finance/screener/predefined/saved?scrIds=${id}&count=${count}&formatted=false&lang=en-US&region=US`);
    const r = data?.finance?.result?.[0];
    if (!r || !Array.isArray(r.quotes)) throw new Error(`No screener data for ${id}`);
    return { id, title: r.title || id, description: r.description || '', total: Number(r.total) || r.quotes.length, quotes: r.quotes };
  }, { stale: 15 * 60000 });
}

export function getMarkets(): Promise<Markets> {
  return cached('markets', 30000, fetchMarkets, { stale: 5 * 60000 });
}
async function fetchMarkets() {
  // Groups fetch in parallel: five serialized Yahoo round-trips made first paint
  // of World Markets crawl and multiplied bot-detection exposure.
  const entries = Object.entries(MARKET_GROUPS);
  const lists = await Promise.all(entries.map(async ([, items]) => {
    const quotes = await getQuotes(items.map((i) => i[0]));
    return quotes.map((qd, idx) => ({ ...qd, label: items[idx]![1] }));
  }));
  return Object.fromEntries(entries.map(([group], i) => [group, lists[i]!])); // stable group order
}

// --------------------------------------------------------------------------
// News (free, no key, via Yahoo search)
// --------------------------------------------------------------------------
export function getNews(symbol: string): Promise<NewsItem[]> {
  const q = symbol ? symbol : 'stock market';
  return cached(`news:${q.toLowerCase()}`, 5 * 60000, () => fetchNews(q), { stale: 60 * 60000 });
}
async function fetchNews(q: string): Promise<NewsItem[]> {
  const data = await yahooFetch<YahooSearch>(`/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=0&newsCount=14`);
  // Links open in the browser: keep only http(s) URLs from the feed.
  const items = (data?.news || []).filter((n) => /^https?:\/\//i.test(n.link || '')).map((n) => ({
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
const TYPE_BUCKET: Record<string, string> = {
  ETF: 'ETF / Fund', MUTUALFUND: 'ETF / Fund', CRYPTOCURRENCY: 'Crypto',
  FUTURE: 'Commodity', INDEX: 'Index', CURRENCY: 'FX', EQUITY: 'Other',
};
function getCategory(symbol: string): Promise<Category> {
  symbol = symbol.toUpperCase();
  return cached(`cat2:${symbol}`, 24 * 60 * 60000, () => fetchCategory(symbol), { stale: 30 * 24 * 60 * 60000, persist: true });
}
async function fetchCategory(symbol: string): Promise<Category> {
  let sector: string | null = null, type: string | null = null;
  try {
    const data = await yahooFetch<YahooSearch>(`/v1/finance/search?q=${encodeURIComponent(symbol)}&quotesCount=8&newsCount=0`);
    const q: NonNullable<YahooSearch['quotes']>[number] = (data?.quotes || []).find((x) => x.symbol === symbol) || (data?.quotes || [])[0] || {};
    sector = q.sector || null;
    type = (q.quoteType || q.typeDisp || '').toUpperCase();
  } catch {}
  // Search can come back empty (rate limit, odd listing); the chart meta still knows the type.
  if (!type) { try { type = String((await getQuote(symbol)).type || '').toUpperCase(); } catch {} }
  // Nothing at all: fail so this miss isn't cached as a fact for 30 days (caller maps it to 'Other').
  if (!type && !sector) throw new Error(`No category for ${symbol}`);
  const category = sector || TYPE_BUCKET[type as string] || 'Other'; // type may be null: no bucket
  return { symbol, sector: sector || null, type: type || null, category };
}
export async function getCategories(symbols: string[]): Promise<Record<string, Category | { symbol: string; category: string }>> {
  const out = await Promise.allSettled(symbols.map((s) => getCategory(s)));
  const map: Record<string, Category | { symbol: string; category: string }> = {};
  out.forEach((r, i) => { map[symbols[i]!.toUpperCase()] = r.status === 'fulfilled' ? r.value : { symbol: symbols[i]!, category: 'Other' }; });
  return map;
}
