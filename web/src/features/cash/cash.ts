// Undo + cash logic (D3), ported 1:1 from public/app.js S15/S16. No DOM here.
import { fmt } from '../../ui/format.ts';

export interface CashRow { ccy: string; amount: string }
/** One account's editable cash: orig is what the server has, rows what the user sees. */
export interface CashDraft { id: string; name: string; orig: Record<string, number>; rows: CashRow[] }
export interface CashCall { draft: CashDraft; ccy: string; amount: number }

// Work out which balances changed. Blank rows are skipped; a row being typed
// ("-", ".") waits; a currency still listed with a blank amount keeps its saved value.
export function planCashSave(drafts: CashDraft[]): { error: string } | { calls: CashCall[] } {
  const calls: CashCall[] = [];
  for (const a of drafts) {
    const next: Record<string, number> = {};
    for (const r of a.rows) {
      const ccy = String(r.ccy || '').trim().toUpperCase(), amt = String(r.amount || '').replace(/[, ]/g, '');
      if (!ccy && !amt) continue;
      if (!/^[A-Z]{3}$/.test(ccy)) return { error: `${a.name}: currency must be a 3-letter code (e.g. SGD)` };
      if (amt === '' || amt === '-' || amt === '.') continue; // still typing
      const v = Number(amt);
      if (!Number.isFinite(v)) return { error: `${a.name}: "${r.amount}" is not a number` };
      next[ccy] = (next[ccy] || 0) + v;
    }
    for (const ccy of new Set([...Object.keys(a.orig), ...Object.keys(next)])) {
      const v = next[ccy] || 0;
      const stillListed = a.rows.some((r) => String(r.ccy || '').trim().toUpperCase() === ccy);
      if (!(ccy in next) && stillListed) continue; // row being edited (blank): leave the saved value alone
      if (Math.abs(v - (a.orig[ccy] || 0)) > 1e-9) calls.push({ draft: a, ccy, amount: v });
    }
  }
  return { calls };
}
export const cashStatusText = (ccy: string, amt: string | number) =>
  Number(amt) === 0 ? `Cleared ${ccy.toUpperCase()} cash` : `Cash ${ccy.toUpperCase()} set to ${fmt(Number(amt))}`;
export const undoStatusText = (r: { undone: string; available?: number }) =>
  `UNDID: ${r.undone}${r.available ? ` · ${r.available} more step(s) available` : ''}`;
