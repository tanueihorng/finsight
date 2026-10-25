// Wire types, not runtime validators. Millisecond timestamps unless noted.

/** server.js sendJson error paths, lib/agentlink.js offline response. */
export type ApiErrorBody = { error: string | { code: string; message: string } };

/** lib/market.js normalizeQuote: undefined upstream properties are omitted by JSON. */
export interface QuotedQuote {
  symbol: string; name: string; currency: string; exchange: string; type: string;
  price?: number | null; prevClose?: number | null;
  change: number | null; changePct: number | null;
  dayHigh?: number | null; dayLow?: number | null;
  weekHigh52?: number | null; weekLow52?: number | null; volume?: number | null;
  marketTime: number | null;
  error?: never;
}
/** lib/market.js getQuotes: per-symbol failures in otherwise successful batches. */
export type Quote = QuotedQuote | { symbol: string; error: string };
/** lib/market.js fetchMarkets, server.js GET /api/markets. */
export type Markets = Record<string, (Quote & { label: string })[]>;
/** lib/market.js getHistory: only c is filtered for null, other OHLCV may be absent. */
export interface HistoryPoint { t: number; c: number; o?: number | null; h?: number | null; l?: number | null; v?: number | null }
/** lib/market.js getHistory, server.js GET /api/history. */
export interface History { symbol: string; range: string; interval: string; meta: QuotedQuote | null; points: HistoryPoint[] }

/** lib/portfolio.js listAccounts (a summary, not the on-disk account). */
export interface Account { id: string; name: string; type: string; count: number }
/** server.js GET /api/accounts, POST add/rename/remove (newId on add). */
export interface Accounts { accounts: Account[]; activeId: string; newId?: string }
/** lib/portfolio.js watchlistWithQuotes, server.js GET /api/watchlist. */
export type WatchItem = Quote;

/** lib/store.js viewPositions (holdings exists only for the ALL view). */
/** lib/market.js fetchCategory (/api/categories maps symbol → this). */
export interface Category { symbol: string; sector: string | null; type: string | null; category: string }
export interface AccountHolding { accountId: string; account: string; quantity: number; avgCost: number }
/** lib/portfolio.js portfolioWithQuotes. quoted=false is a cost-valued manual asset. */
export interface Position {
  symbol: string; name?: string; currency: string; quantity: number; avgCost: number;
  holdings?: AccountHolding[];
  fxRate: number; last: number; change: number | null; changePct: number | null;
  marketValue: number; cost: number; costAtNow: number; unrealized: number; unrealizedPct: number;
  stockPnl: number; fxPnl: number; dayChange: number; quoted: boolean; weight: number;
}
/** lib/portfolio.js portfolioWithQuotes.summary, all amounts in base currency. */
export interface Summary {
  totalValue: number; totalCost: number; cashBase: number; netWorth: number;
  totalUnrealized: number; totalUnrealizedPct: number; totalStockPnl: number; totalFxPnl: number;
  dayPnl: number; dayPct: number; realizedPnl: number; realizedStockPnl: number; realizedFxPnl: number; realizedLegacy: number;
}
/** lib/store.js transactions; lib/portfolio.js buyUnlocked, sell, del; legacy fields optional. */
export interface Transaction {
  id?: string; type: 'BUY' | 'SELL' | 'DELETE'; symbol: string; time?: number | null;
  quantity?: number; price?: number; currency?: string; realized?: number;
  fxUsd?: number | null; fxUsdSell?: number | null; usdBaseSell?: number | null; usdBaseSellCcy?: string;
  lotsSold?: { q: number; px: number; fxUsd: number | null; t: number | null; usdBase: number | null; usdBaseCcy: string | null }[];
}
/** lib/portfolio.js portfolioWithQuotes, server.js /api/portfolio and portfolio write responses. */
export interface Portfolio {
  base: string; account: string; fx: Record<string, number>; fxMissing: string[];
  positions: Position[]; cash: { ccy: string; amount: number; base: number }[];
  summary: Summary; transactions: Transaction[];
  lastRealized?: number;
}

/** lib/portfolio.js cleanAlert/evaluateAlerts; old price alerts may omit kind/note. */
export type Alert = {
  id: string; symbol: string; op: '<' | '>'; note?: string; drawingId?: string;
  createdAt: number; triggeredAt: number | null; notifiedAt?: number;
  label: string; currentPrice: number | null; currentValue: number | null; level: number | null;
  currency?: string; name?: string; met: boolean;
} & (
  { kind: 'price'; price: number } |
  { kind: 'line'; line: { pts: { t: number; p: number }[]; interval: string; log: boolean } } |
  { kind: 'ind'; price?: number; ind: { type: string; length: number; interval: string } }
);
/** lib/dividends.js upcomingEvents; amount is only present on EX-DIV. */
export type EventItem = { symbol: string; t: number; estimated: boolean; held: boolean } & (
  { kind: 'EARNINGS' } | { kind: 'EX-DIV'; amount: number | null }
);
/** lib/dividends.js sum() used by dividendsReport. */
export interface DividendTotals { gross: number; tax: number; net: number }
/** lib/dividends.js dividendsReport.recent; store dividend import has optional metadata. */
export interface ReceivedDividend {
  symbol: string; date: string; amount: number; currency: string; tax?: number | null;
  id?: string; account?: string; quantity?: number;
  baseAmount: number; baseTax: number; baseNet: number; whtRate: number; whtActual: boolean;
}
/** lib/dividends.js dividendsReport.forward. */
export interface ForwardDividend {
  symbol: string; currency: string; perShare: number; source: 'forward' | 'trailing';
  annualGross: number; annualTax: number; annualNet: number; whtRate: number;
  yieldOnCost: number | null; currentYield: number | null; nextEx: number | null;
  nextExEstimated: boolean; nextPay: number | null;
}
/** lib/dividends.js dividendsReport, server.js GET /api/dividends. */
export interface DividendsReport {
  base: string; account: string; count: number; total: number; ttm: number;
  received: { total: DividendTotals; ttm: DividendTotals };
  bySymbol: (DividendTotals & { symbol: string })[]; recent: ReceivedDividend[];
  forward: ForwardDividend[]; forwardTotal: DividendTotals; withholding: Record<string, number>;
}
/** lib/ledger.js ledger: DELETE/legacy SELL rows have no valueBase; old ids/times may be absent. */
export interface LedgerRow {
  id?: string; type: 'BUY' | 'SELL' | 'DELETE'; symbol: string;
  quantity: number | null; price: number | null; currency: string | null; time?: number | null;
  account: string; accountId: string; editable?: boolean; valueBase?: number;
  realized?: number; realizedStock?: number; realizedFx?: number; legacy?: boolean;
}
/** lib/portfolio.js fxRisk (exposures), server.js GET /api/fx-risk. */
export interface FxExposure {
  ccy: string; base: string; cashBase: number; notionalNative: number; notionalBase: number; pct: number;
  blendedEntry: number; nowRate: number; breakeven: number; driftPct: number; fxPnl: number; fxPnlPct: number;
  sigmaWeeklyPct: number; oneSigmaBase: number; var95Base: number;
}
/** lib/portfolio.js fxRisk, server.js GET /api/fx-risk. `lots` is consumed only by the legacy FX panel (C2 types it). */
export interface FxRisk {
  base: string; totalValue: number; foreignBase: number; totalFxPnl: number; exposures: FxExposure[];
  vol: { sigmaWeeklyPct: number; oneSigmaBase: number; var95Base: number }; lots: unknown[];
}

/** lib/market.js fetchNews, server.js GET /api/news (Yahoo may omit text/URL fields). */
export interface NewsItem {
  title?: string; publisher?: string | null; link?: string; time: number | null; tickers: string[];
}
/** server.js GET /api/news. */
export interface NewsResponse { news: NewsItem[] }

/** lib/market.js fetchSearch, server.js GET /api/search. */
export interface SearchResult { symbol: string; name: string; exchange: string; type: string }

export interface Ledger { base: string; account: string; rows: LedgerRow[] }
/** lib/ledger.js realizedReport(). */
export interface RealizedRow {
  id: string; time: number; year: number; symbol: string; quantity: number; price: number; currency: string;
  proceeds: number; cost: number; stock: number | null; fx: number | null; total: number; legacy: boolean; heldDays: number | null;
}
export interface RealizedYear { year: number; proceeds: number; cost: number; stock: number; fx: number; total: number; trades: number; divGross: number; divTax: number; divNet: number }
export interface Realized { base: string; account: string; rows: RealizedRow[]; years: RealizedYear[] }
/** lib/portfolio.js importCsv result, returned as Portfolio.imported. */
export interface ImportResult { added: number; total: number; failed: string[] }

/** lib/performance.js portfolioPerformance, server.js GET /api/portfolio/performance. Early exits may omit points. */
export interface Performance {
  range: string; base: string; points?: { t: number; value: number; invested: number; bench: number | null }[];
  start: number; end: number; netInvested: number; gain: number; twr: number; twrAnnual: number;
  xirr: number | null; mwr: number | null; spanDays: number;
  benchmark: { symbol: string; name: string; twr: number; twrAnnual: number; shadowEnd: number | null } | null;
  approx?: string[]; missing?: string[]; transfers?: string[];
}
