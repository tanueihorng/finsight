// Paper trading view helpers (FEAT-011): wire shapes of /api/paper/state and
// the pure text and form logic the panel uses, unit-tested without a DOM.
export type Approval = 'ask' | 'auto';
export interface Limits { maxOrderUsd: number | null; maxOrdersPerDay: number | null; maxPositionPct: number | null; symbols: string[] | null }
export interface Settings { approval: Approval; limits: Limits }
export interface OrderInput { symbol: string; side: 'buy' | 'sell'; type: 'market' | 'limit'; qty: number | null; notional: number | null; limitPrice: number | null; tif: 'day' | 'gtc' }
export interface PaperOrder {
  id: string; symbol: string; side: 'buy' | 'sell'; type: string; tif: string; qty: number | null; notional: number | null; limitPrice: number | null;
  filledQty: number | null; filledAvgPrice: number | null; status: string; createdAt: string; filledAt: string | null; origin: 'user' | 'kestrel' | 'alpaca'; threadId: string | null;
}
export interface Ticket { id: string; status: 'pending' | 'approved' | 'rejected' | 'failed'; order: OrderInput; note?: string; createdAt: number; error?: string; estimate?: { valueUsd: number | null; priceSource: string } }
export interface PaperState {
  connected: boolean; keySource: 'env' | 'file' | null; settings: Settings; tickets: Ticket[];
  stream: { state: 'off' | 'connecting' | 'live' | 'retrying' | 'auth_failed'; message?: string };
  sync: { syncedAt: number | null; error: string | null; skipped: { symbol: string; side: string; qty: number; reason: string }[]; drift: string[] };
  account: { number: string; status: string; cash: number; equity: number; buyingPower: number; lastEquity: number | null } | null;
  positions: { symbol: string; qty: number; side: string; marketValue: number; unrealizedPl: number }[];
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
