// Facts tools: read-only views of FinSight data. All arithmetic (totals,
// weights, groupings) happens here in code, never in the model. Every result
// carries asOf + source so answers can cite a data time.
import { z } from 'zod';
import type { ToolCtx, ToolDef } from './registry.ts';
import type { Category, History, HistoryPoint, Portfolio, Position } from '../../../shared/types.ts';

const Account = z.string().max(64).optional().describe('FinSight account id. Omit for ALL accounts combined.');
const Base = z.enum(['SGD', 'USD', 'EUR', 'GBP', 'JPY', 'HKD', 'AUD', 'CNY', 'INR']).optional().describe('Reporting currency. Default SGD.');
const Symbols = z.array(z.string().min(1).max(24)).min(1).max(50);

// Older responses may omit summary fields or use realized instead of realizedPnl.
type PortfolioSnapshot = Omit<Partial<Portfolio>, 'summary'> & {
  summary?: Partial<Portfolio['summary']> & { realized?: number };
};
type CashPosition = Portfolio['cash'][number];
const r2 = (n: unknown): number | null => (typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null);

// weightPct keeps FinSight's displayed meaning (share of securities value).
// weightInclCashPct divides by securities plus cash. Each weight-bearing result
// names its basis and denominator so the two are never compared silently.
export const WEIGHT_BASIS = {
  securities: 'Share of securities market value; cash excluded.',
  securities_plus_cash: 'Share of securities plus cash (FinSight net worth). Liabilities are not tracked, so this is not net of debt.',
} as const;
export type WeightBasis = keyof typeof WEIGHT_BASIS;
// Named with every all-account figure so it is not read as the account on screen.
const SCOPE_ALL = 'All accounts combined';

function compactPosition(p: Position, inclCash: number | null) {
  return {
    symbol: p.symbol, name: p.name, currency: p.currency, quantity: p.quantity, avgCost: r2(p.avgCost), last: r2(p.last),
    marketValue: r2(p.marketValue), weightPct: r2(p.weight), weightInclCashPct: pct(p.marketValue, inclCash),
    unrealized: r2(p.unrealized), unrealizedPct: r2(p.unrealizedPct), fxPnl: r2(p.fxPnl), dayChange: r2(p.dayChange), quoted: p.quoted,
  };
}
const pct = (part: unknown, whole: number | null) => (typeof part === 'number' && Number.isFinite(part) && whole ? r2((part / whole) * 100) : null);
const finite = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : 0);

/** Both weight denominators from one snapshot. Unknown liabilities stay unknown, never zero. */
export function denominators(d: PortfolioSnapshot, base: string, asOf: string) {
  const positions = d.positions || [], cash = d.cash || [];
  const securities = d.summary?.totalValue ?? positions.reduce((s, p) => s + finite(p.marketValue), 0);
  const cashBase = d.summary?.cashBase ?? cash.reduce((s, c) => s + finite(c.base), 0);
  const inclCash = d.summary?.netWorth ?? securities + cashBase;
  const complete = !(d.fxMissing || []).length && positions.every((p) => p.quoted !== false);
  const one = (scope: WeightBasis, value: number, constituents: string[]) => ({ scope, value: r2(value), currency: base, asOf, constituents: constituents.length, meaning: WEIGHT_BASIS[scope], complete });
  return {
    securities: one('securities', securities, positions.map((p) => p.symbol)),
    securities_plus_cash: one('securities_plus_cash', inclCash, [...positions.map((p) => p.symbol), ...cash.map((c) => `${c.ccy} cash`)]),
    liabilities: 'not tracked' as const,
  };
}

type CompactPosition = ReturnType<typeof compactPosition>;

export async function fetchPortfolio(ctx: ToolCtx, account?: string, base = 'SGD') {
  const d = await ctx.finsight.get<Portfolio>('/api/portfolio', { base, account: account || 'ALL' }, ctx.signal);
  return { d, asOf: new Date().toISOString() };
}

export function summarise(d: PortfolioSnapshot, base: string) {
  const s = d.summary || {};
  return {
    base, account: d.account,
    netWorth: r2(s.netWorth), securitiesValue: r2(s.totalValue), cash: r2(s.cashBase), totalCost: r2(s.totalCost),
    unrealized: r2(s.totalUnrealized), realized: r2(s.realizedPnl ?? s.realized), positions: (d.positions || []).length,
    fxMissing: d.fxMissing || [],
  };
}

const getPortfolio: ToolDef = {
  name: 'get_portfolio',
  description: 'Current holdings with live prices from FinSight: summary (net worth, securities value, cash, cost, P/L) and every position (quantity, avg cost, last price, market value, weight %, unrealized P/L, FX P/L). weightPct is a share of securities only; weightInclCashPct is a share of securities plus cash. Never compare a weight with a total of the other basis. Values in the base currency. Use this before answering anything about holdings.',
  input: z.object({ account: Account, base: Base }),
  async handler({ account, base = 'SGD' }, ctx) {
    const { d, asOf } = await fetchPortfolio(ctx, account, base);
    const den = denominators(d, base, asOf);
    return { source: 'FinSight /api/portfolio', asOf, summary: summarise(d, base), weightBasis: 'securities', denominators: den,
      positions: (d.positions || []).map((p) => compactPosition(p, den.securities_plus_cash.value)), cash: d.cash };
  },
};

const queryPositions: ToolDef = {
  name: 'query_positions',
  description: 'Filter, sort and limit holdings (computed in code). Use for questions like "my 5 biggest USD positions", "positions down more than 10%", "tech holdings". Sector comes from FinSight categories.',
  input: z.object({
    account: Account, base: Base,
    currency: z.string().length(3).optional(),
    symbols: Symbols.optional(),
    sector: z.string().max(40).optional().describe('Case-insensitive match on FinSight category, e.g. "Technology".'),
    minWeightPct: z.number().optional(), maxUnrealizedPct: z.number().optional(), minUnrealizedPct: z.number().optional(),
    sortBy: z.enum(['marketValue', 'weightPct', 'unrealized', 'unrealizedPct', 'dayChange', 'symbol']).default('marketValue'),
    dir: z.enum(['asc', 'desc']).default('desc'),
    limit: z.number().int().min(1).max(100).default(20),
  }),
  async handler(q, ctx) {
    const base = q.base || 'SGD';
    const { d, asOf } = await fetchPortfolio(ctx, q.account, base);
    const den = denominators(d, base, asOf);
    let rows = (d.positions || []).map((p) => compactPosition(p, den.securities_plus_cash.value));
    let cats: Record<string, Category> = {};
    if (q.sector) {
      cats = await ctx.finsight.get<Record<string, Category>>('/api/categories', { symbols: rows.map((r: CompactPosition) => r.symbol).join(',') }, ctx.signal);
      rows = rows.filter((r: CompactPosition) => String(cats[String(r.symbol).toUpperCase()]?.category || '').toLowerCase().includes(q.sector!.toLowerCase()));
    }
    if (q.currency) rows = rows.filter((r: CompactPosition) => r.currency === q.currency!.toUpperCase());
    if (q.symbols) { const set = new Set(q.symbols.map((s: string) => s.toUpperCase())); rows = rows.filter((r: CompactPosition) => set.has(String(r.symbol).toUpperCase())); }
    if (q.minWeightPct != null) rows = rows.filter((r: CompactPosition) => (r.weightPct ?? 0) >= q.minWeightPct!);
    if (q.minUnrealizedPct != null) rows = rows.filter((r: CompactPosition) => (r.unrealizedPct ?? -Infinity) >= q.minUnrealizedPct!);
    if (q.maxUnrealizedPct != null) rows = rows.filter((r: CompactPosition) => (r.unrealizedPct ?? Infinity) <= q.maxUnrealizedPct!);
    const k: 'marketValue' | 'weightPct' | 'unrealized' | 'unrealizedPct' | 'dayChange' | 'symbol' = q.sortBy, sign = q.dir === 'asc' ? 1 : -1;
    rows.sort((a: CompactPosition, b: CompactPosition) => (k === 'symbol' ? String(a.symbol).localeCompare(String(b.symbol)) : ((a[k] ?? -Infinity) - (b[k] ?? -Infinity))) * sign);
    const matched = rows.length;
    rows = rows.slice(0, q.limit);
    const sum = (f: 'marketValue' | 'weightPct' | 'weightInclCashPct' | 'unrealized') => r2(rows.reduce((s: number, r: CompactPosition) => s + (r[f] ?? 0), 0));
    return { source: 'FinSight /api/portfolio' + (q.sector ? ' + /api/categories' : ''), asOf, base, matched, returned: rows.length, weightBasis: 'securities', denominators: den,
      totals: { marketValue: sum('marketValue'), weightPct: sum('weightPct'), weightInclCashPct: sum('weightInclCashPct'), unrealized: sum('unrealized') }, rows };
  },
};

// How a holding got its sector-view group. A sector is an economic label; an
// instrument type (ETF / Fund, Crypto, ...) is administrative and says nothing
// about what a fund holds. A failed lookup is unclassified, never silently Other.
export type Classification = 'sector' | 'instrument_type' | 'label' | 'unclassified';
const FUND_TYPES = new Set(['ETF', 'MUTUALFUND']);
export function classify(c: Partial<Category> | undefined): { group: string; classification: Classification; fund: boolean } {
  const type = String(c?.type || '').toUpperCase(), fund = FUND_TYPES.has(type);
  if (c?.sector) return { group: c.sector, classification: 'sector', fund };
  if (type && c?.category) return { group: c.category, classification: 'instrument_type', fund };
  if (c?.category && c.category !== 'Other') return { group: c.category, classification: 'label', fund };
  return { group: 'Unclassified', classification: 'unclassified', fund };
}

const getExposures: ToolDef = {
  name: 'get_exposures',
  description: 'Portfolio exposure weights grouped by currency, sector or account (computed in code, cash included). Currency and sector rows list their member holdings. Sector view reports how each holding was classified (sector, instrument type, or unclassified) and coverage. ETF look-through is NOT available: each fund is one line, and the result says so.',
  input: z.object({ by: z.enum(['currency', 'sector', 'account']), base: Base }),
  async handler({ by, base = 'SGD' }, ctx) {
    const asOf = new Date().toISOString();
    const groups = new Map<string, number>();
    const add = (k: string, v: number) => groups.set(k, (groups.get(k) ?? 0) + (Number.isFinite(v) ? v : 0));
    // Membership is reported, so a group's makeup is never inferred from names.
    const members = new Map<string, { symbol: string; value: number; classification?: Classification }[]>();
    const member = (k: string, symbol: string, v: number, classification?: Classification) => { add(k, v); members.set(k, [...(members.get(k) ?? []), { symbol, value: finite(v), classification }]); };
    let coverage: Record<string, unknown> | undefined;
    if (by === 'account') {
      const accts = await ctx.finsight.get('/api/accounts', {}, ctx.signal);
      for (const a of accts.accounts || []) {
        const { d } = await fetchPortfolio(ctx, a.id, base);
        add(`${a.name} (${a.id})`, d.summary?.netWorth ?? 0);
      }
    } else {
      const { d } = await fetchPortfolio(ctx, undefined, base);
      const positions: Position[] = d.positions || [];
      if (by === 'currency') {
        for (const p of positions) member(p.currency, p.symbol, p.marketValue);
        for (const c of d.cash || []) member(`${c.ccy} (cash)`, `${c.ccy} cash`, c.base);
      } else {
        const cats = positions.length ? await ctx.finsight.get<Record<string, Category>>('/api/categories', { symbols: positions.map((p) => p.symbol).join(',') }, ctx.signal) : {};
        const classed: Record<Classification, number> = { sector: 0, instrument_type: 0, label: 0, unclassified: 0 };
        const funds: string[] = [], unclassified: string[] = [];
        for (const p of positions) {
          const c = classify(cats[String(p.symbol).toUpperCase()]);
          member(c.group, p.symbol, p.marketValue, c.classification);
          classed[c.classification] += finite(p.marketValue);
          if (c.fund) funds.push(p.symbol);
          if (c.classification === 'unclassified') unclassified.push(p.symbol);
        }
        for (const c of d.cash || []) if (c.base) member('Cash', `${c.ccy} cash`, c.base);
        const sec = positions.reduce((s, p) => s + finite(p.marketValue), 0);
        coverage = {
          securitiesValue: r2(sec), bySectorPct: pct(classed.sector, sec), byInstrumentTypePct: pct(classed.instrument_type, sec), byUnsourcedLabelPct: pct(classed.label, sec), unclassifiedPct: pct(classed.unclassified, sec),
          funds, unclassified, fundLookThrough: 'unknown',
          meaning: 'Coverage is a share of securities value. Funds sit whole in one line; their holdings and sector mix are unknown here.',
        };
      }
    }
    const total = [...groups.values()].reduce((s, v) => s + v, 0);
    const rows = [...groups.entries()].map(([group, value]) => ({ group, value: r2(value), weightPct: total ? r2((value / total) * 100) : null,
      members: by === 'account' ? undefined : (members.get(group) ?? []).sort((a, b) => b.value - a.value).map((m) => ({ ...m, value: r2(m.value), weightInclCashPct: pct(m.value, total) })) }))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    // Every grouping here includes cash, so weights share the securities-plus-cash basis.
    return { source: 'FinSight', asOf, base, by, account: 'ALL', accountScope: SCOPE_ALL, total: r2(total), weightBasis: 'securities_plus_cash',
      denominator: { scope: 'securities_plus_cash', value: r2(total), currency: base, asOf, constituents: groups.size, meaning: WEIGHT_BASIS.securities_plus_cash }, liabilities: 'not tracked', rows, coverage, lookThrough: false,
      note: by === 'sector' ? 'ETFs and funds are counted as single lines (no look-through). Each row lists its member holdings; an instrument-type group such as ETF / Fund is an administrative label, not an economic sector. Do not infer membership from names.' : undefined };
  },
};

const getCash: ToolDef = {
  name: 'get_cash',
  description: 'Uninvested cash by currency (native amount and base-currency value).',
  input: z.object({ account: Account, base: Base }),
  async handler({ account, base = 'SGD' }, ctx) {
    const { d, asOf } = await fetchPortfolio(ctx, account, base);
    return { source: 'FinSight /api/portfolio', asOf, base, cash: d.cash, totalBase: r2((d.cash || []).reduce((s: number, c: CashPosition) => s + (c.base || 0), 0)) };
  },
};

const getAccounts: ToolDef = {
  name: 'get_accounts',
  description: 'List FinSight accounts (id, name, type, number of positions).',
  input: z.object({}),
  async handler(_i, ctx) { return { source: 'FinSight /api/accounts', asOf: new Date().toISOString(), ...(await ctx.finsight.get('/api/accounts', {}, ctx.signal)) }; },
};

const getQuote: ToolDef = {
  name: 'get_quote',
  description: 'Live quotes (price, change, currency) for up to 50 symbols, Yahoo-style tickers (e.g. NVDA, D05.SI, BTC-USD).',
  input: z.object({ symbols: Symbols }),
  async handler({ symbols }, ctx) {
    const d = await ctx.finsight.get('/api/quote', { symbols: symbols.join(',') }, ctx.signal);
    return { source: 'FinSight /api/quote (Yahoo)', asOf: new Date().toISOString(), asOfMeaning: 'Tool retrieval time; quote marketTime is the market observation time. Check each quote cache status and cachedAt for freshness.', quotes: d.quotes };
  },
};

const getEarningsDates: ToolDef = {
  name: 'get_earnings_dates',
  description: 'Next or most recent scheduled earnings date for any symbols (market-data aggregator, not the issuer), with whether the date is estimated and whether it is before or after now. Use it to tell whether a quarter has already been reported.',
  input: z.object({ symbols: z.array(z.string().min(1).max(24)).min(1).max(20) }),
  async handler({ symbols }, ctx) {
    const d = await ctx.finsight.get<{ details?: Record<string, { earningsStart?: number | null; earningsEnd?: number | null; earningsEstimated?: boolean | null }> }>('/api/quote-details', { symbols: symbols.join(',') }, ctx.signal);
    const now = Date.now(), iso = (ms: number | null | undefined) => (typeof ms === 'number' && Number.isFinite(ms) ? new Date(ms).toISOString() : null);
    const rows = symbols.map((s: string) => s.toUpperCase()).map((symbol: string) => {
      const x = d.details?.[symbol];
      const start = x?.earningsStart ?? null;
      return { symbol, earningsDate: iso(start), earningsWindowEnd: iso(x?.earningsEnd), estimated: x?.earningsEstimated ?? null, timing: start === null ? 'unknown' : start > now ? 'upcoming' : 'past' };
    });
    return { source: 'FinSight /api/quote-details (Yahoo)', sourceClass: 'aggregator', asOf: new Date(now).toISOString(), asOfMeaning: 'Tool retrieval time; timing compares each earnings date with it. Confirm dates against the issuer announcement.', rows };
  },
};

const getHistory: ToolDef = {
  name: 'get_history',
  description: 'Price history summary for one symbol: first/last close, return %, high/low, max drawdown and the last 15 closes. Set includeBars for raw OHLCV (max 300 bars). For a chat price chart use includeBars:true and chartOnly:true to return compact closing prices.',
  input: z.object({
    symbol: z.string().min(1).max(24),
    range: z.enum(['1mo', '3mo', '6mo', '1y', '2y', '5y', '10y']).default('1y'),
    interval: z.enum(['1d', '1wk', '1mo']).default('1d'),
    includeBars: z.boolean().default(false),
    chartOnly: z.boolean().default(false),
  }),
  async handler({ symbol, range, interval, includeBars, chartOnly }, ctx) {
    const d = await ctx.finsight.get<History & { bars?: HistoryPoint[] }>('/api/history', { symbol, range, interval }, ctx.signal);
    const pts: HistoryPoint[] = (d.points || d.bars || []).filter((p: HistoryPoint) => Number.isFinite(p.c));
    if (!pts.length) return { source: 'FinSight /api/history', symbol, error: 'no data' };
    let peak = -Infinity, mdd = 0;
    for (const p of pts) { peak = Math.max(peak, p.c); mdd = Math.min(mdd, p.c / peak - 1); }
    const first = pts[0]!, last = pts[pts.length - 1]!;
    const high = Math.max(...pts.map((p) => p.h ?? p.c)), low = Math.min(...pts.map((p) => p.l ?? p.c));
    return {
      source: 'FinSight /api/history (Yahoo)', asOf: new Date().toISOString(), asOfMeaning: 'Tool retrieval time; bar dates are observation times.', cache: d.cache ?? null, symbol, range, interval, currency: d.meta?.currency ?? null, bars: pts.length,
      from: new Date(first.t).toISOString().slice(0, 10), to: new Date(last.t).toISOString().slice(0, 10),
      firstClose: r2(first.c), lastClose: r2(last.c), returnPct: r2((last.c / first.c - 1) * 100),
      returnKind: 'price', returnMeaning: 'Price return between the first and last closes; excludes dividends (not total return). The last bar may be an incomplete intraday bar; check its date.',
      high: r2(high), low: r2(low), maxDrawdownPct: r2(mdd * 100),
      // Derived in code so a reader never computes distances from a range in prose.
      lastVsHighPct: r2((last.c / high - 1) * 100), lastVsLowPct: r2((last.c / low - 1) * 100),
      lastCloses: pts.slice(-15).map((p) => ({ date: new Date(p.t).toISOString().slice(0, 10), c: r2(p.c) })),
      ohlcv: includeBars ? (chartOnly && pts.length > 150 ? Array.from({ length: 150 }, (_, i) => pts[Math.floor(i * (pts.length - 1) / 149)]!) : chartOnly ? pts : pts.slice(-300)).map((p) => chartOnly ? { t: p.t, c: p.c } : { t: p.t, o: p.o, h: p.h, l: p.l, c: p.c, v: p.v }) : undefined,
    };
  },
};

const simple = (name: string, description: string, pathname: string, input: z.ZodObject<any>, params: (i: any) => Record<string, any> = (i) => i): ToolDef => ({
  name, description, input,
  async handler(i, ctx) { return { source: `FinSight ${pathname}`, asOf: new Date().toISOString(), data: await ctx.finsight.get(pathname, params(i), ctx.signal) }; },
});

// A daily series for a year is ~250 points; the summary and a month-end sample
// carry the same decisions at a fraction of the size (FR-3.10).
const getMacroSeries: ToolDef = {
  name: 'get_macro_series',
  description: 'FRED macro time series via FinSight (e.g. DGS10 10-year Treasury, CPIAUCSL CPI, FEDFUNDS): first, last, high and low observations with dates, change over the window, month-end values and the last 10 observations. Set full:true for every point.',
  input: z.object({ series: z.string().regex(/^[A-Z0-9_]{2,30}$/), start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default('2020-01-01'), full: z.boolean().default(false) }),
  async handler({ series, start, full }, ctx) {
    const d = await ctx.finsight.get<{ series?: string; transform?: string; points?: { date: string; value: number }[] }>('/api/fred', { series, start }, ctx.signal);
    const pts = (d.points || []).filter((p) => typeof p?.value === 'number' && Number.isFinite(p.value) && typeof p.date === 'string');
    const base = { source: 'FinSight /api/fred (FRED)', asOf: new Date().toISOString(), asOfMeaning: 'Tool retrieval time; observation dates are in the points.', series: d.series ?? series, transform: d.transform ?? null, observations: pts.length };
    if (!pts.length) return { ...base, error: 'no data' };
    if (full) return { ...base, points: pts };
    const first = pts[0]!, last = pts[pts.length - 1]!;
    const hi = pts.reduce((a, p) => (p.value > a.value ? p : a)), lo = pts.reduce((a, p) => (p.value < a.value ? p : a));
    const monthEnd = [...new Map(pts.map((p) => [p.date.slice(0, 7), p])).values()];
    return { ...base, first, last, high: hi, low: lo, changeFromFirst: r2(last.value - first.value), changeUnit: 'same units as the series (percentage points for yields)', monthEnd, recent: pts.slice(-10) };
  },
};

const portfolioWeights: ToolDef = {
  name: 'portfolio_weights',
  description: 'Weights of named holdings (alone and combined) on both bases from one snapshot, computed in code: securitiesPct (share of securities only) and weightInclCashPct (share of securities plus cash). Returns both denominators. Use this for any position-weight or concentration figure; quote the basis with the number.',
  input: z.object({ symbols: Symbols, account: Account, base: Base }),
  async handler({ symbols, account, base = 'SGD' }, ctx) {
    const { d, asOf } = await fetchPortfolio(ctx, account, base);
    const den = denominators(d, base, asOf);
    const want: string[] = [...new Set<string>(symbols.map((s: string) => s.toUpperCase()))];
    const held = new Map((d.positions || []).map((p) => [String(p.symbol).toUpperCase(), p]));
    const row = (symbol: string, value: number) => ({ symbol, marketValue: r2(value), securitiesPct: pct(value, den.securities.value), weightInclCashPct: pct(value, den.securities_plus_cash.value) });
    const rows = want.filter((s) => held.has(s)).map((s) => row(s, finite(held.get(s)!.marketValue)));
    const combinedValue = rows.reduce((s, r) => s + (r.marketValue ?? 0), 0);
    return { source: 'FinSight /api/portfolio', asOf, base, account: account || 'ALL', accountScope: account ? `Account ${account} only` : SCOPE_ALL, denominators: den, rows,
      combined: rows.length > 1 ? row(rows.map((r) => r.symbol).join('+'), combinedValue) : undefined,
      notHeld: want.filter((s) => !held.has(s)), lookThrough: false };
  },
};

const getFundProfile: ToolDef = {
  name: 'get_fund_profile',
  description: 'ETF or mutual fund profile from FinSight: family, category, expense ratio, asset mix, top holdings (with their combined share), sector weights and holdings-weighted equity P/E, P/B and P/S. Source is a market-data aggregator, not the issuer; holdings cover only the listed top positions.',
  input: z.object({ symbol: z.string().min(1).max(24) }),
  async handler({ symbol }, ctx) {
    const d = await ctx.finsight.get('/api/fund', { symbol }, ctx.signal);
    return { source: 'FinSight /api/fund (Yahoo quoteSummary)', sourceClass: 'aggregator', asOf: new Date().toISOString(),
      asOfMeaning: 'Tool retrieval time. The aggregator gives no holdings report date; treat holdings as undated and check the issuer factsheet for the as-of date.', ...d,
      lookThrough: { coveragePct: d.topHoldingsPct ?? null, note: 'Only the listed top holdings are known; the rest of the fund is unknown here.' } };
  },
};

const acctBase = z.object({ account: Account, base: Base });
const withAll = (i: any) => ({ ...i, account: i.account || 'ALL' });

export const factsTools: ToolDef[] = [
  getPortfolio, queryPositions, getExposures, portfolioWeights, getFundProfile, getCash, getAccounts, getQuote, getEarningsDates, getHistory,
  simple('search_instruments', 'Resolve a company name or ticker to market-data instruments. Use the explicit question before optional chart context; ask about materially ambiguous listings rather than silently substituting the chart.', '/api/search', z.object({ query: z.string().trim().min(1).max(120) }), (i) => ({ q: i.query })),
  simple('get_events', 'Upcoming earnings, dividends and ex-dates for holdings and watchlist.', '/api/events', z.object({ account: Account }), withAll),
  simple('get_dividends', 'Dividend income report (received, expected, withholding).', '/api/dividends', acctBase, withAll),
  simple('get_realized', 'Realized gains report from sells (stock vs FX split).', '/api/realized', acctBase, withAll),
  simple('get_performance', 'Portfolio performance over a range versus an optional benchmark (securities only, excludes cash flows).', '/api/portfolio/performance',
    z.object({ range: z.enum(['1mo', '3mo', '6mo', 'ytd', '1y', '2y', '5y']).default('1y'), benchmark: z.string().max(24).optional(), account: Account, base: Base }), withAll),
  simple('get_fx_risk', 'Currency risk of the portfolio: exposure by currency and FX volatility impact.', '/api/fx-risk', acctBase, withAll),
  simple('get_ledger', 'Transaction ledger (buys and sells with lots).', '/api/ledger', acctBase, withAll),
  simple('get_watchlist', 'Watchlist with quotes.', '/api/watchlist', z.object({})),
  simple('get_alerts', 'Price/indicator alerts and whether they are triggered.', '/api/alerts', z.object({})),
  simple('get_news', 'Recent news headlines for a symbol (Yahoo). Headlines are leads, not proof.', '/api/news', z.object({ symbol: z.string().min(1).max(24) })),
  getMacroSeries,
  simple('get_journal', 'Trade journal entries (setups, R results, notes).', '/api/journal', z.object({})),
];
