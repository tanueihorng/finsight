// The on-disk portfolio model (DATA_DIR/portfolio.json, undo.json). These are
// stored records, not the API wire shapes in shared/types.ts: older files and
// hand edits can lack fields, so most are optional. Types only, no runtime.
import type { IbkrDividend } from './csv.ts';

/** One purchase lot. fxUsd/usdBase anchor the FX P&L at purchase time. */
export interface StoredLot {
  q: number; px: number; fxUsd: number | null; t: number | null; tx?: string;
  usdBase?: number; usdBaseCcy?: string;
}
/** A lot slice consumed by a sale (stored with the SELL). */
export interface SoldLot { q: number; px: number; fxUsd: number | null; t: number | null; usdBase: number | null; usdBaseCcy: string | null }
export interface StoredPosition { symbol: string; name?: string; currency?: string; quantity: number; avgCost: number; lots: StoredLot[] }
/** BUY / SELL / DELETE; legacy files may hold other types or omit fields. */
export interface StoredTransaction {
  id: string; type: string; symbol: string; quantity?: number; price?: number; currency?: string; fxUsd?: number | null; time?: number;
  realized?: number; fxUsdSell?: number | null; lotsSold?: SoldLot[]; usdBaseSell?: number; usdBaseSellCcy?: string;
}
export type StoredDividend = IbkrDividend;
export interface StoredAccount {
  id: string; name: string; type?: string; positions: StoredPosition[]; transactions: StoredTransaction[];
  dividends: StoredDividend[]; cash: Record<string, number>;
}
/** Alerts are stored as validated by portfolio.cleanAlert, plus bookkeeping. */
export interface StoredAlert {
  id: string; symbol: string; op: '<' | '>'; kind?: 'price' | 'line' | 'ind'; note?: string; drawingId?: string; // old price alerts lack kind/note
  price?: number; line?: { pts: { t: number; p: number }[]; interval: string; log: boolean };
  ind?: { type: string; length: number; interval: string };
  createdAt: number; triggeredAt: number | null; notifiedAt?: number;
}
export interface StoredPortfolio {
  accounts: StoredAccount[]; watchlist: string[]; alerts: StoredAlert[];
  settings: { withholding?: Record<string, number> }; activeId: string;
}
/** One undo step: the accounts before a change. */
export interface UndoEntry { at: number; label: string; snap: { accounts: StoredAccount[]; activeId: string } }
