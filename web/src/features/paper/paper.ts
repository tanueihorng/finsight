// Paper trading view helpers (FEAT-012): wire shapes of /api/paper/state and
// the pure text and form logic the panel uses, unit-tested without a DOM.
import { fmt, fmtBig } from '../../ui/format.ts';

export type Approval = 'ask' | 'auto';
export interface Limits { maxOrderUsd: number | null; maxOrdersPerDay: number | null; maxPositionPct: number | null; symbols: string[] | null }
export interface Settings { approval: Approval; limits: Limits }
export interface OrderInput { symbol: string; side: 'buy' | 'sell'; type: 'market' | 'limit'; qty: number | null; notional: number | null; limitPrice: number | null; tif: 'day' | 'gtc' }
export interface PaperOrder {
  id: string; symbol: string; side: 'buy' | 'sell'; type: string; tif: string; qty: number | null; notional: number | null; limitPrice: number | null;
  filledQty: number | null; filledAvgPrice: number | null; status: string; createdAt: string; filledAt: string | null; origin: 'user' | 'kestrel' | 'alpaca'; threadId: string | null;
}
export interface Ticket { id: string; status: 'pending' | 'approving' | 'unconfirmed' | 'approved' | 'rejected' | 'failed'; order: OrderInput; note?: string; createdAt: number; error?: string; estimate?: { valueUsd: number | null; priceSource: string } }
export interface PaperPosition { symbol: string; bookSymbol: string; qty: number; side: string; avgEntryPrice: number; currentPrice: number; marketValue: number; unrealizedPl: number }
export interface PaperState {
  connected: boolean; keySource: 'env' | 'file' | null; settings: Settings; tickets: Ticket[];
  stream: { state: 'off' | 'connecting' | 'live' | 'retrying' | 'auth_failed'; message?: string };
  sync: { syncedAt: number | null; error: string | null; skipped: { symbol: string; side: string; qty: number; reason: string }[]; drift: string[] };
  account: { number: string; status: string; cash: number; equity: number; buyingPower: number; lastEquity: number | null } | null;
  positions: PaperPosition[];
  openOrders: PaperOrder[]; recentOrders: PaperOrder[]; error?: string; retrievedAt?: string;
}

const n2 = (v: number) => v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const usd = (v: number | null | undefined) => (v == null || !Number.isFinite(v) ? '—' : `US$${n2(v)}`);
const qtyText = (q: number) => (q % 1 ? String(+q.toFixed(6)) : String(q));

/** "BUY 4 NVDA · market · day", "SELL US$500 AAPL · limit 230.00 · gtc". */
export function orderLabel(o: { side: string; symbol: string; type: string; qty: number | null; notional: number | null; limitPrice: number | null; tif: string }): string {
  const size = o.qty != null ? qtyText(o.qty) : usd(o.notional);
  const kind = o.type === 'limit' && o.limitPrice != null ? `limit ${n2(o.limitPrice)}` : 'market';
  return `${o.side.toUpperCase()} ${size} ${o.symbol} · ${kind} · ${o.tif}`;
}
export function fillText(o: PaperOrder): string {
  if (o.filledQty && o.filledAvgPrice) return `${qtyText(o.filledQty)} @ ${n2(o.filledAvgPrice)}`;
  return o.status.replace(/_/g, ' ');
}
export const originLabel = (o: PaperOrder['origin']) => (o === 'kestrel' ? 'KESTREL' : o === 'user' ? 'YOU' : 'ALPACA');
export const streamLabel: Record<PaperState['stream']['state'], string> = {
  off: 'offline', connecting: 'connecting', live: 'live', retrying: 'reconnecting', auth_failed: 'keys rejected',
};
/** Equity change since the previous close, when Alpaca gives last_equity. */
export function dayChange(a: PaperState['account']): { abs: number; pct: number } | null {
  if (!a || a.lastEquity == null || !a.lastEquity) return null;
  return { abs: a.equity - a.lastEquity, pct: ((a.equity - a.lastEquity) / a.lastEquity) * 100 };
}

/** The order ticket's fields as typed. */
export interface Form { symbol: string; side: 'buy' | 'sell'; sizeBy: 'qty' | 'usd'; amount: string; type: 'market' | 'limit'; limitPrice: string; tif: 'day' | 'gtc' }
export const emptyForm = (symbol = '', side: 'buy' | 'sell' = 'buy'): Form => ({ symbol, side, sizeBy: 'qty', amount: '', type: 'market', limitPrice: '', tif: 'day' });
/** Request body, or the first problem to show. The server checks again. */
export function formOrder(f: Form): { body: Record<string, unknown> } | { error: string } {
  const symbol = f.symbol.trim().toUpperCase();
  if (!symbol) return { error: 'Enter a US ticker' };
  const amount = Number(f.amount);
  if (!(amount > 0)) return { error: f.sizeBy === 'usd' ? 'Enter a USD amount' : 'Enter a quantity' };
  if (f.sizeBy === 'usd' && f.type === 'limit') return { error: 'A USD amount works with market orders only' };
  const limit = Number(f.limitPrice);
  if (f.type === 'limit' && !(limit > 0)) return { error: 'Enter a limit price' };
  const fractional = f.sizeBy === 'usd' || amount % 1 !== 0;
  if (fractional && f.tif === 'gtc') return { error: 'Fractional and USD-amount orders must be day orders' };
  return { body: { symbol, side: f.side, type: f.type, tif: f.tif, ...(f.sizeBy === 'qty' ? { qty: amount } : { notional: amount }), ...(f.type === 'limit' ? { limitPrice: limit } : {}) } };
}
/** Settings form strings -> the POST body ('' means no limit). */
export function limitsBody(v: { maxOrderUsd: string; maxOrdersPerDay: string; maxPositionPct: string; symbols: string }) {
  const opt = (s: string) => (s.trim() === '' ? null : Number(s));
  return { maxOrderUsd: opt(v.maxOrderUsd), maxOrdersPerDay: opt(v.maxOrdersPerDay), maxPositionPct: opt(v.maxPositionPct), symbols: v.symbols.trim() || null };
}
export const limitsText = (l: Limits) => {
  const parts = [l.maxOrderUsd != null && `≤ ${usd(l.maxOrderUsd)} per order`, l.maxOrdersPerDay != null && `≤ ${l.maxOrdersPerDay} orders a day`,
    l.maxPositionPct != null && `≤ ${l.maxPositionPct}% of equity per position`, l.symbols && `only ${l.symbols.join(', ')}`].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'no limits';
};

/** Alpaca writes class shares with a dot (BRK.B); the book and charts use Yahoo's dash. */
export const bookSymbol = (alpacaSymbol: string) => alpacaSymbol.replace('.', '-');

/** The ticket's summary: the price it is estimated at, the order's value and
 *  buying power after it. An estimate only: a market order fills at Alpaca's price. */
export function estimate(f: Form, last: number | null, buyingPower: number | null): { price: number | null; qty: number | null; value: number | null; after: number | null } {
  const limit = Number(f.limitPrice), amount = Number(f.amount);
  const price = f.type === 'limit' ? (limit > 0 ? limit : null) : last != null && last > 0 ? last : null;
  if (!(amount > 0) || price == null) return { price, qty: null, value: null, after: null };
  const qty = f.sizeBy === 'usd' ? amount / price : amount, value = f.sizeBy === 'usd' ? amount : amount * price;
  const after = buyingPower == null ? null : f.side === 'buy' ? buyingPower - value : buyingPower;
  return { price, qty, value, after };
}
/** Quick size buttons: a share of buying power (buy) or of the position (sell). */
export function quickAmount(f: Form, pct: number, last: number | null, buyingPower: number | null, held: number): string {
  if (f.side === 'sell') { const q = held * pct / 100; return q > 0 ? String(f.sizeBy === 'usd' && last ? +(q * last).toFixed(2) : +q.toFixed(6)) : ''; }
  if (buyingPower == null || buyingPower <= 0) return '';
  const usdAmt = buyingPower * pct / 100;
  if (f.sizeBy === 'usd') return String(Math.floor(usdAmt * 100) / 100);
  const price = f.type === 'limit' && Number(f.limitPrice) > 0 ? Number(f.limitPrice) : last;
  return price ? String(Math.floor(usdAmt / price)) : '';
}
/** Open limit orders for one symbol, as price lines on the desk chart. */
export function chartOrders(orders: PaperOrder[], symbol: string) {
  return orders.filter((o) => bookSymbol(o.symbol) === symbol && o.limitPrice != null)
    .map((o) => ({ side: o.side, price: o.limitPrice!, label: `${o.side.toUpperCase()} LMT ${o.qty != null ? qtyText(o.qty) : usd(o.notional)} @ ${n2(o.limitPrice!)}${o.origin === 'kestrel' ? ' · KESTREL' : ''}` }));
}

/** Quote fields the desk's key-stats strip reads (QuotedQuote subset). */
export interface DeskQuote { prevClose?: number | null; dayLow?: number | null; dayHigh?: number | null; weekLow52?: number | null; weekHigh52?: number | null; volume?: number | null }
/** /api/quote-details fields (earnings, dividends, valuation). */
export interface DeskDetails { marketCap?: number | null; trailingPE?: number | null; forwardPE?: number | null; dividendYield?: number | null; earningsStart?: number | null; earningsEstimated?: boolean | null }
const range = (lo?: number | null, hi?: number | null) => (lo != null && hi != null ? `${fmt(lo)} – ${fmt(hi)}` : '—');
const ratio = (v?: number | null) => (v != null && Number.isFinite(v) && v > 0 ? v.toFixed(1) : '—');
/** The key stats beside the chart, as [label, value]; a dash where the source has nothing. Paper is US-only: earnings dates are New York dates. */
export function keyStats(q: DeskQuote | null, d: DeskDetails | null, now = Date.now()): [string, string][] {
  const e = d?.earningsStart;
  const earnings = e && e > now - 86_400_000 ? `${new Date(e).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' })}${d?.earningsEstimated ? ' (est.)' : ''}` : '—';
  return [
    ['Prev close', fmt(q?.prevClose)], ['Day range', range(q?.dayLow, q?.dayHigh)], ['52W range', range(q?.weekLow52, q?.weekHigh52)],
    ['Volume', fmtBig(q?.volume)], ['Mkt cap', d?.marketCap ? fmtBig(d.marketCap) : '—'], ['P/E', ratio(d?.trailingPE)], ['Fwd P/E', ratio(d?.forwardPE)],
    ['Earnings', earnings], ['Div yield', d?.dividendYield ? `${d.dividendYield.toFixed(2)}%` : '—'],
  ];
}
