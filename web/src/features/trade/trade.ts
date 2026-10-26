import { createStore } from 'zustand/vanilla';
import type { Position } from '../../../../shared/types.ts';

// Trade sheet state and math. The math mirrors lib/portfolio.ts: a buy adds a
// lot (blended average), a sell trims every lot proportionally, so realized
// P&L is against the account's average cost.
export type Mode = 'buy' | 'sell';
export type Sheet = { symbol: string; mode: Mode; accountId?: string } | null;
export const tradeSheet = createStore<{ sheet: Sheet }>()(() => ({ sheet: null }));
export const openTrade = (symbol: string, mode: Mode, accountId?: string) => tradeSheet.setState({ sheet: { symbol, mode, accountId } });
export const closeTrade = () => tradeSheet.setState({ sheet: null });

export type Book = { accountId: string; account: string; quantity: number; avgCost: number };
// The books a trade can go to. A specific account view trades in that account;
// the All Accounts view offers each account that holds the symbol.
export function booksFor(p: Position | undefined, account: string, accountName: string): Book[] {
  if (!p) return [];
  if (account !== 'ALL') return [{ accountId: account, account: accountName, quantity: p.quantity, avgCost: p.avgCost }];
  return (p.holdings ?? []).map((h) => ({ accountId: h.accountId, account: h.account, quantity: h.quantity, avgCost: h.avgCost }));
}

export function previewBuy(held: number, avg: number, q: number, px: number) {
  const cost = q * px, after = held + q;
  return { cost, after, newAvg: after > 0 ? (held * avg + cost) / after : px };
}
export function previewSell(held: number, avg: number, q: number, px: number) {
  const realized = (px - avg) * q;
  return { proceeds: q * px, realized, realizedPct: avg > 0 ? (px - avg) / avg * 100 : 0, after: Math.max(0, held - q) };
}
// 100% is the exact holding; fractions of a whole-share holding round down to
// whole shares (at least 1), fractional holdings keep 4 decimals.
export function sellQty(held: number, frac: number): number {
  if (frac >= 1) return held;
  const raw = held * frac;
  return Number.isInteger(held) ? Math.max(1, Math.floor(raw)) : Math.floor(raw * 1e4) / 1e4;
}

export function tradeError(mode: Mode, q: number, px: number, held: number, date: string, today: string): string | null {
  if (!(q > 0)) return 'Enter a share count above 0.';
  if (!(px >= 0) || Number.isNaN(px)) return 'Enter a price of 0 or more.';
  if (mode === 'sell' && q > held + 1e-9) return `You only hold ${+held.toFixed(6)} in this account.`;
  if (date && date > today) return "The trade date can't be in the future.";
  return null;
}
// The label lib/portfolio.ts gives the undo entry, so the toast can check it.
export const undoLabel = (mode: Mode, q: number, symbol: string) => `${mode === 'buy' ? 'Buy' : 'Sell'} ${q} ${symbol}`;
export const localDate = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
