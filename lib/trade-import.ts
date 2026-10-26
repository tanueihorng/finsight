import { createHash } from 'node:crypto';
import { parseIbkrTrades } from './csv.ts';
import { findPos, loadPortfolio, newTxId, recalcPosition, resolveAccount, savePortfolio, withLock, withUndo } from './store.ts';
import { fxRateAt } from './market.ts';
import type { StoredAccount, StoredTransaction } from './model.ts';

const day = (t: number) => new Date(t).toISOString().slice(0, 10);
const key = (t: { symbol: string; type: string; quantity?: number; price?: number; currency?: string; time?: number }) =>
  JSON.stringify([t.symbol, t.type, t.time == null ? null : day(t.time), t.quantity, t.price, t.currency || 'USD']);
function plan(csv: unknown, acc: StoredAccount) {
  const trades = parseIbkrTrades(csv);
  if (trades === null) return { kind: 'positions' as const };
  const counts = new Map<string, number>();
  for (const t of acc.transactions) if (t.type === 'BUY' || t.type === 'SELL') counts.set(key(t), (counts.get(key(t)) || 0) + 1);
  const rows = trades.map((t) => {
    const k = key(t), n = counts.get(k) || 0;
    if (n) counts.set(k, n - 1);
    return { ...t, status: n ? 'recorded' as const : 'new' as const };
  });
  // Include all account state, including lots. A stale preview must never mutate it.
  const token = createHash('sha256').update(JSON.stringify([csv, acc])).digest('hex');
  return { kind: 'trades' as const, token, rows, added: rows.filter((r) => r.status === 'new').length, total: rows.length };
}
export function previewTradeImport(csv: unknown, accountId?: string) { return plan(csv, resolveAccount(loadPortfolio(), accountId)); }

export async function importTrades(csv: unknown, token: unknown, accountId?: string, base = 'SGD') {
  const initial = previewTradeImport(csv, accountId);
  if (initial.kind !== 'trades' || !token || initial.token !== token) throw new Error('Preview changed; review the import again');
  // Fetch FX before locking. Changes during fetch are detected again under lock.
  const prepared = await Promise.all(initial.rows.filter((r) => r.status === 'new').map(async (t) => {
    const fxUsd = await fxRateAt(t.currency, 'USD', t.time).catch(() => null);
    const usdBase = base === 'USD' ? 1 : await fxRateAt('USD', base, t.time).catch(() => null);
    return { t, fxUsd, usdBase };
  }));
  return withLock(() => withUndo(`Import ${initial.added} trades`, () => {
    const p = loadPortfolio(), acc = resolveAccount(p, accountId), current = plan(csv, acc);
    if (current.kind !== 'trades' || current.token !== token) throw new Error('Portfolio changed; preview the import again');
    // Apply chronologically in memory, save once. Failure leaves the whole book intact.
    for (const { t, fxUsd, usdBase } of prepared.sort((a, b) => a.t.time - b.t.time)) {
      if (acc.transactions.some((x) => x.symbol === t.symbol && x.time! > t.time && ['BUY', 'SELL', 'TRANSFER', 'DELETE'].includes(x.type))) throw new Error(`Cannot backfill ${t.symbol} before later activity; reconcile its ledger first`);
      let pos = findPos(acc, t.symbol);
      if (pos && pos.currency !== t.currency) throw new Error(`Currency mismatch for ${t.symbol}`);
      const id = newTxId();
      const tx: StoredTransaction = { id, symbol: t.symbol, type: t.type, time: t.time, price: t.price, quantity: t.quantity, currency: t.currency };
      if (t.type === 'BUY') {
        if (!pos) { pos = { symbol: t.symbol, name: t.symbol, currency: t.currency, quantity: 0, avgCost: 0, lots: [] }; acc.positions.push(pos); }
        pos.lots.push({ q: t.quantity, px: t.price, t: t.time, fxUsd, tx: id, ...(usdBase == null ? {} : { usdBase, usdBaseCcy: base }) });
        tx.fxUsd = fxUsd;
      } else {
        if (!pos || t.quantity > pos.quantity) throw new Error(`Insufficient ${t.symbol} for imported sale; import its earlier buys first`);
        if (pos.lots.some((l) => l.t != null && l.t > t.time)) throw new Error(`Imported sale predates a ${t.symbol} lot`);
        const f = t.quantity / pos.quantity;
        tx.realized = (t.price - pos.avgCost) * t.quantity;
        tx.fxUsdSell = fxUsd;
        if (usdBase != null) { tx.usdBaseSell = usdBase; tx.usdBaseSellCcy = base; }
        tx.lotsSold = pos.lots.map((l) => ({ q: l.q * f, px: l.px, t: l.t, fxUsd: l.fxUsd, usdBase: l.usdBase ?? null, usdBaseCcy: l.usdBaseCcy ?? null }));
        for (const l of pos.lots) l.q *= 1 - f;
      }
      recalcPosition(pos!);
      if (pos!.quantity <= 1e-9) acc.positions = acc.positions.filter((x) => x !== pos);
      acc.transactions.push(tx);
    }
    if (prepared.length) savePortfolio(p);
    return { added: prepared.length, total: initial.total, failed: [], skipped: initial.total - prepared.length };
  }));
}
