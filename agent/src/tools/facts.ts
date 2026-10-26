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

function compactPosition(p: Position) {
  return {
    symbol: p.symbol, name: p.name, currency: p.currency, quantity: p.quantity, avgCost: r2(p.avgCost), last: r2(p.last),
    marketValue: r2(p.marketValue), weightPct: r2(p.weight), unrealized: r2(p.unrealized), unrealizedPct: r2(p.unrealizedPct),
    fxPnl: r2(p.fxPnl), dayChange: r2(p.dayChange), quoted: p.quoted,
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
  description: 'Current holdings with live prices from FinSight: summary (net worth, securities value, cash, cost, P/L) and every position (quantity, avg cost, last price, market value, weight %, unrealized P/L, FX P/L). Values in the base currency. Use this before answering anything about holdings.',
  input: z.object({ account: Account, base: Base }),
  async handler({ account, base = 'SGD' }, ctx) {
    const { d, asOf } = await fetchPortfolio(ctx, account, base);
    return { source: 'FinSight /api/portfolio', asOf, summary: summarise(d, base), positions: (d.positions || []).map(compactPosition), cash: d.cash };
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
    let rows = (d.positions || []).map(compactPosition);
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
    const sum = (f: 'marketValue' | 'weightPct' | 'unrealized') => r2(rows.reduce((s: number, r: CompactPosition) => s + (r[f] ?? 0), 0));
    return { source: 'FinSight /api/portfolio' + (q.sector ? ' + /api/categories' : ''), asOf, base, matched, returned: rows.length,
      totals: { marketValue: sum('marketValue'), weightPct: sum('weightPct'), unrealized: sum('unrealized') }, rows };
  },
};

const getExposures: ToolDef = {
  name: 'get_exposures',
  description: 'Portfolio exposure weights grouped by currency, sector or account (computed in code, cash included where relevant). ETF look-through is NOT available: sector exposure treats each ETF as one line, and the result says so.',
  input: z.object({ by: z.enum(['currency', 'sector', 'account']), base: Base }),
  async handler({ by, base = 'SGD' }, ctx) {
    const asOf = new Date().toISOString();
    const groups = new Map<string, number>();
    const add = (k: string, v: number) => groups.set(k, (groups.get(k) ?? 0) + (Number.isFinite(v) ? v : 0));
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
        for (const p of positions) add(p.currency, p.marketValue);
        for (const c of d.cash || []) add(`${c.ccy} (cash)`, c.base);
      } else {
        const cats = positions.length ? await ctx.finsight.get<Record<string, Category>>('/api/categories', { symbols: positions.map((p) => p.symbol).join(',') }, ctx.signal) : {};
        for (const p of positions) add(cats[String(p.symbol).toUpperCase()]?.category || 'Other', p.marketValue);
        const cash = (d.cash || []).reduce((s: number, c: CashPosition) => s + (c.base || 0), 0);
        if (cash) add('Cash', cash);
      }
    }
    const total = [...groups.values()].reduce((s, v) => s + v, 0);
    const rows = [...groups.entries()].map(([group, value]) => ({ group, value: r2(value), weightPct: total ? r2((value / total) * 100) : null }))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
    return { source: 'FinSight', asOf, base, by, total: r2(total), rows, lookThrough: false,
      note: by === 'sector' ? 'ETFs and funds are counted as single lines (no look-through).' : undefined };
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
    return { source: 'FinSight /api/quote (Yahoo)', asOf: new Date().toISOString(), quotes: d.quotes };
  },
};

const getHistory: ToolDef = {
  name: 'get_history',
  description: 'Price history summary for one symbol: first/last close, return %, high/low, max drawdown and the last 15 closes. Set includeBars for raw OHLCV (max 300 bars).',
  input: z.object({
    symbol: z.string().min(1).max(24),
    range: z.enum(['1mo', '3mo', '6mo', '1y', '2y', '5y', '10y']).default('1y'),
    interval: z.enum(['1d', '1wk', '1mo']).default('1d'),
    includeBars: z.boolean().default(false),
  }),
  async handler({ symbol, range, interval, includeBars }, ctx) {
    const d = await ctx.finsight.get<History & { bars?: HistoryPoint[] }>('/api/history', { symbol, range, interval }, ctx.signal);
    const pts: HistoryPoint[] = (d.points || d.bars || []).filter((p: HistoryPoint) => Number.isFinite(p.c));
    if (!pts.length) return { source: 'FinSight /api/history', symbol, error: 'no data' };
    let peak = -Infinity, mdd = 0;
    for (const p of pts) { peak = Math.max(peak, p.c); mdd = Math.min(mdd, p.c / peak - 1); }
    const first = pts[0]!, last = pts[pts.length - 1]!;
    return {
      source: 'FinSight /api/history (Yahoo)', symbol, range, interval, currency: d.meta?.currency ?? null, bars: pts.length,
      from: new Date(first.t).toISOString().slice(0, 10), to: new Date(last.t).toISOString().slice(0, 10),
      firstClose: r2(first.c), lastClose: r2(last.c), returnPct: r2((last.c / first.c - 1) * 100),
      high: r2(Math.max(...pts.map((p) => p.h ?? p.c))), low: r2(Math.min(...pts.map((p) => p.l ?? p.c))), maxDrawdownPct: r2(mdd * 100),
      lastCloses: pts.slice(-15).map((p) => ({ date: new Date(p.t).toISOString().slice(0, 10), c: r2(p.c) })),
      ohlcv: includeBars ? pts.slice(-300).map((p) => ({ t: p.t, o: p.o, h: p.h, l: p.l, c: p.c, v: p.v })) : undefined,
    };
  },
};

const simple = (name: string, description: string, pathname: string, input: z.ZodObject<any>, params: (i: any) => Record<string, any> = (i) => i): ToolDef => ({
  name, description, input,
  async handler(i, ctx) { return { source: `FinSight ${pathname}`, asOf: new Date().toISOString(), data: await ctx.finsight.get(pathname, params(i), ctx.signal) }; },
});

const acctBase = z.object({ account: Account, base: Base });
const withAll = (i: any) => ({ ...i, account: i.account || 'ALL' });

export const factsTools: ToolDef[] = [
  getPortfolio, queryPositions, getExposures, getCash, getAccounts, getQuote, getHistory,
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
  simple('get_macro_series', 'FRED macro time series via FinSight (e.g. DGS10 10-year Treasury, CPIAUCSL CPI, FEDFUNDS).', '/api/fred',
    z.object({ series: z.string().regex(/^[A-Z0-9_]{2,30}$/), start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).default('2020-01-01') })),
  simple('get_journal', 'Trade journal entries (setups, R results, notes).', '/api/journal', z.object({})),
];
