// Internal book transfer: one portfolio save and one undo for both accounts.
import { findPos, loadPortfolio, newTxId, recalcPosition, savePortfolio, withLock, withUndo } from './store.ts';
export function transfer(symbolIn: unknown, quantityIn: unknown, fromId: unknown, toId: unknown) {
  return withLock(() => withUndo(`Transfer ${quantityIn} ${String(symbolIn).toUpperCase()}`, () => {
    const symbol = String(symbolIn || '').trim().toUpperCase(), quantity = Number(quantityIn);
    const p = loadPortfolio();
    const source = p.accounts.find((a) => a.id === fromId), target = p.accounts.find((a) => a.id === toId);
    if (!source || !target || source === target) throw new Error('Choose two different, existing accounts');
    const pos = findPos(source, symbol);
    if (!pos || !Number.isFinite(quantity) || !(quantity > 0) || quantity > pos.quantity) throw new Error('Transfer quantity must be positive and no more than the holding');
    let dest = findPos(target, symbol);
    if (dest && dest.currency !== pos.currency) throw new Error('Source and destination currencies differ');
    if (!dest) { dest = { ...pos, quantity: 0, avgCost: 0, lots: [] }; target.positions.push(dest); }
    const fraction = quantity / pos.quantity;
    for (const lot of pos.lots) {
      const q = lot.q * fraction;
      dest.lots.push({ ...lot, q }); // preserve purchase time, cost, FX and lot provenance
      lot.q -= q;
      // Editing an original buy after splitting its lot would corrupt history.
      for (const a of p.accounts) for (const tx of a.transactions) {
        if (tx.type === 'BUY' && (tx.id === lot.tx || (!lot.tx && tx.symbol === symbol && tx.time === lot.t && tx.price === lot.px))) tx.transferred = true;
      }
    }
    recalcPosition(pos); recalcPosition(dest);
    if (fraction === 1) source.positions = source.positions.filter((x) => x !== pos);
    const transferId = newTxId(), time = Date.now();
    for (const [a, other, side] of [[source, target, 'out'], [target, source, 'in']] as const) {
      a.transactions.push({ id: newTxId(), type: 'TRANSFER', symbol, quantity, currency: pos.currency, time, transferId, transferSide: side, otherAccountId: other.id });
    }
    savePortfolio(p);
    return p;
  }));
}
