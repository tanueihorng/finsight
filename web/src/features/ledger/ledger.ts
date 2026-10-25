// Ledger, realized gains and CSV export logic (D4), ported from public/app.js S17/S29.
import type { LedgerRow, Portfolio, Realized } from '../../../../shared/types.ts';
import { fmt } from '../../ui/format.ts';

export const shortDate = (ms: number) => new Date(ms).toLocaleDateString('en-US', { year: '2-digit', month: 'short', day: '2-digit' });
export const isoDate = (ms: number) => new Date(ms).toISOString().slice(0, 10);
// Filter by symbol, or by type when the text is part of BUY/SELL/DELETE.
export function filterLedger(rows: LedgerRow[], text: string): LedgerRow[] {
  const f = text.trim().toUpperCase();
  return rows.filter((r) => !f || (r.symbol || '').toUpperCase().includes(f) || r.type.includes(f));
}
export const typeClass = (t: string) => (t === 'BUY' ? 't-buy' : t === 'SELL' ? 't-sell' : 't-del');
export const heldLabel = (days: number | null) => (days == null ? '—' : days >= 365 ? fmt(days / 365.25, 1) + 'y' : days + 'd');

export function realizedCsvRows(d: Realized): unknown[][] {
  const b = d.base.toLowerCase();
  const head = ['date', 'symbol', 'quantity', 'price', 'currency', `proceeds_${b}`, `cost_${b}`, `stock_pnl_${b}`, `fx_pnl_${b}`, `realized_${b}`, 'held_days'];
  return [head, ...d.rows.map((r) => [isoDate(r.time), r.symbol, r.quantity, r.price, r.currency,
    r.proceeds.toFixed(2), r.cost.toFixed(2), r.stock != null ? r.stock.toFixed(2) : '', r.fx != null ? r.fx.toFixed(2) : '', r.total.toFixed(2), r.heldDays ?? ''])];
}
export function portfolioCsvRows(d: Portfolio, base: string): unknown[][] {
  const head = ['symbol', 'quantity', 'avg_price', 'currency', 'last', 'market_value_' + (d.base || base).toLowerCase(), 'unrealized_pnl'];
  return [head, ...d.positions.map((p) => [p.symbol, p.quantity, p.avgCost, p.currency, p.last, p.marketValue.toFixed(2), p.unrealized.toFixed(2)])];
}
export const importStatusText = (r: { added: number; total: number; failed: string[] }) =>
  `Imported ${r.added}/${r.total}${r.failed.length ? ' · failed: ' + r.failed.join(', ') : ''}`;
