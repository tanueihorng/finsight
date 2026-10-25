import { api } from '../../api/client.ts';
import { analyticsStale, setStatus } from '../../legacy/app.ts';
import { cashStatusText, undoStatusText } from './cash.ts';

// Undo and single-currency cash writes (D3). No panel of their own: the legacy
// ↶ UNDO buttons and the command bar (UNDO, CASH) call these through the
// doUndo / setCashBalance globals until F7 and D4.
const qs = () => {
  const { base, account } = window.FinSight.store.getState();
  return `?base=${encodeURIComponent(base)}&account=${encodeURIComponent(account || '')}`;
};
const message = (e: unknown) => (e as Error).message;

export async function undo(): Promise<void> {
  try {
    const r = await api<{ undone: string; available?: number }>('/api/undo', { method: 'POST' });
    setStatus(undoStatusText(r), 'ok');
    analyticsStale({ perf: true });
    await window.FinSight.bus.write('undo'); // accounts first, then portfolio, ledger, watchlist, alerts…
  } catch (e) { setStatus('UNDO: ' + message(e), 'err'); }
}
// Tooltip for the ↶ UNDO buttons; null when the server can't say.
export async function undoTitle(): Promise<string | null> {
  try {
    const u = await api<{ last?: { label: string } | null }>('/api/undo');
    return u.last ? `Undo: ${u.last.label}` : 'Nothing to undo';
  } catch { return null; }
}
export async function setCashBalance(ccy: string, amt: string): Promise<void> {
  try {
    await api('/api/cash' + qs(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ccy, amount: amt }) });
    setStatus(cashStatusText(ccy, amt), 'ok');
    analyticsStale({ wealth: true });
    await window.FinSight.bus.write('cash');
  } catch (e) { setStatus('CASH failed: ' + message(e), 'err'); }
}
export const actions = { undo, undoTitle, setCashBalance };
export type FinSightActions = typeof actions;
