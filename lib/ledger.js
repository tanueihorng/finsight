'use strict';
// Transaction ledger: browse every trade, fix a buy's date / price / quantity
// (e.g. an import that had no purchase date), remove a mistaken buy, and the
// realized-gains report (closed trades by year, stock vs FX, CSV-ready).
// Every change goes through withUndo, so it can be rolled back.
const { getFxRate, usdToBaseAt, fxRateAt } = require('./market');
const {
  loadPortfolio, savePortfolio, recalcPosition, findPos, viewTransactions, viewDividends, withLock, withUndo,
} = require('./store');
const { realizedOfSell } = require('./portfolio');
const { dividendNet } = require('./dividends');

const DAY_MS = 24 * 60 * 60 * 1000;

// FX rates (native -> base, now) for every currency in a list of items.
async function ratesFor(items, base) {
  const fx = {};
  for (const c of new Set(items.map((t) => (t.currency || 'USD').toUpperCase()))) {
    try { fx[c] = await getFxRate(c, base); } catch { fx[c] = 1; }
  }
  return (c) => fx[(c || 'USD').toUpperCase()] ?? 1;
}

// The open lot a BUY created: linked by id for new buys; for older data, the
// lot with the same purchase time and price.
function lotForBuy(pos, tx) {
  if (!pos) return null;
  return pos.lots.find((l) => l.tx === tx.id)
    || pos.lots.find((l) => !l.tx && l.t === tx.time && l.px === tx.price)
    || null;
}
function findTx(p, id) {
  for (const a of p.accounts) {
    const tx = a.transactions.find((t) => t.id === id);
    if (tx) return { acc: a, tx };
  }
  throw new Error('Transaction not found');
}

async function ledger(base, accountId) {
  base = (base || 'SGD').toUpperCase();
  const p = loadPortfolio();
  const id = accountId || p.activeId;
  const accts = id === 'ALL' ? p.accounts : p.accounts.filter((a) => a.id === id);
  const all = accts.flatMap((a) => a.transactions.map((t) => ({ t, a })));
  const rate = await ratesFor(all.map((x) => x.t), base);
  const u2b = await usdToBaseAt(base);
  const rows = all.map(({ t, a }) => {
    const row = {
      id: t.id, type: t.type, symbol: t.symbol, quantity: t.quantity ?? null, price: t.price ?? null,
      currency: t.currency || null, time: t.time, account: a.name, accountId: a.id,
    };
    if (t.type === 'BUY') {
      row.editable = !!lotForBuy(findPos(a, t.symbol), t);
      row.valueBase = t.quantity * t.price * rate(t.currency);
    }
    if (t.type === 'SELL' && t.realized != null) {
      const r = realizedOfSell(t, base, u2b, rate(t.currency));
      Object.assign(row, { realized: r.total, realizedStock: r.stock, realizedFx: r.fx, legacy: r.legacy, valueBase: r.proceedsBase });
    }
    return row;
  }).sort((x, y) => (y.time || 0) - (x.time || 0));
  return { base, account: id, rows };
}

// Edit a still-open BUY. Changing the date re-fetches the purchase-time FX, so
// the stock/FX split and performance history follow the correction.
function editBuy(id, { date, price, quantity } = {}, base) {
  const usdBaseCcy = (base || '').toUpperCase();
  return withLock(() => withUndo('Edit buy', async () => {
    const p = loadPortfolio();
    const { acc, tx } = findTx(p, id);
    if (tx.type !== 'BUY') throw new Error('Only buys can be edited — use UNDO to reverse a sale');
    const pos = findPos(acc, tx.symbol);
    const lot = lotForBuy(pos, tx);
    if (!lot) throw new Error('This buy has been sold or its lot is not linked, so it can\'t be edited');

    if (price != null && price !== '') {
      const px = Number(price);
      if (!(px >= 0)) throw new Error('Price must be >= 0');
      lot.px = px; tx.price = px;
    }
    if (quantity != null && quantity !== '') {
      const q = Number(quantity);
      if (!(q > 0)) throw new Error('Quantity must be > 0');
      lot.q *= q / tx.quantity; // keeps any proportional reduction from earlier partial sells
      tx.quantity = q;
    }
    if (date != null && date !== '') {
      const t = Date.parse(date);
      if (!Number.isFinite(t) || t > Date.now() + DAY_MS) throw new Error('Invalid date');
      const ccy = (pos.currency || 'USD').toUpperCase();
      let fxUsd = null, usdBase = null;
      try { fxUsd = await fxRateAt(ccy, 'USD', t); } catch {}
      if (usdBaseCcy && usdBaseCcy !== 'USD') { try { usdBase = await fxRateAt('USD', usdBaseCcy, t); } catch {} }
      lot.t = t; tx.time = t;
      lot.fxUsd = fxUsd; tx.fxUsd = fxUsd;
      if (usdBase != null) { lot.usdBase = usdBase; lot.usdBaseCcy = usdBaseCcy; } else { delete lot.usdBase; delete lot.usdBaseCcy; }
    }
    lot.tx = tx.id;
    recalcPosition(pos);
    savePortfolio(p);
    return { id, symbol: tx.symbol };
  }));
}

// Remove a mistaken BUY: its transaction and its open lot.
function deleteBuy(id) {
  return withLock(() => withUndo('Delete buy', () => {
    const p = loadPortfolio();
    const { acc, tx } = findTx(p, id);
    if (tx.type !== 'BUY') throw new Error('Only buys can be deleted here — use UNDO to reverse a sale');
    const pos = findPos(acc, tx.symbol);
    const lot = lotForBuy(pos, tx);
    if (!lot) throw new Error('This buy has been sold or its lot is not linked, so it can\'t be deleted');
    pos.lots = pos.lots.filter((l) => l !== lot);
    recalcPosition(pos);
    if (pos.quantity <= 1e-9) acc.positions = acc.positions.filter((x) => x !== pos);
    acc.transactions = acc.transactions.filter((t) => t !== tx);
    savePortfolio(p);
    return { id, symbol: tx.symbol };
  }));
}

// Realized gains by year: every closed trade with proceeds, cost (at the FX you
// actually paid), stock vs FX split and holding period; plus dividends by year.
async function realizedReport(base, accountId) {
  base = (base || 'SGD').toUpperCase();
  const p = loadPortfolio();
  const sells = viewTransactions(p, accountId).filter((t) => t.type === 'SELL' && t.realized != null);
  const rate = await ratesFor(sells, base);
  const u2b = await usdToBaseAt(base);
  const rows = sells.map((t) => {
    const r = realizedOfSell(t, base, u2b, rate(t.currency));
    return {
      id: t.id, time: t.time, year: new Date(t.time).getFullYear(), symbol: t.symbol, quantity: t.quantity, price: t.price,
      currency: t.currency || 'USD', proceeds: r.proceedsBase, cost: r.costBase, stock: r.stock, fx: r.fx, total: r.total,
      legacy: r.legacy, heldDays: r.heldSince ? Math.round((t.time - r.heldSince) / DAY_MS) : null,
    };
  }).sort((a, b) => b.time - a.time);

  const years = {};
  const yr = (y) => (years[y] || (years[y] = { year: y, proceeds: 0, cost: 0, stock: 0, fx: 0, total: 0, trades: 0, divGross: 0, divTax: 0, divNet: 0 }));
  for (const r of rows) {
    const y = yr(r.year);
    y.proceeds += r.proceeds; y.cost += r.cost; y.total += r.total; y.trades++;
    y.stock += r.stock || 0; y.fx += r.fx || 0;
  }
  const divs = viewDividends(p, accountId);
  const drate = await ratesFor(divs, base);
  for (const d of divs) {
    const t = Date.parse(d.date); if (!Number.isFinite(t)) continue;
    const n = dividendNet(d, p.settings);
    const y = yr(new Date(t).getFullYear()), k = drate(d.currency);
    y.divGross += n.gross * k; y.divTax += n.tax * k; y.divNet += n.net * k;
  }
  return { base, account: accountId || p.activeId, rows, years: Object.values(years).sort((a, b) => b.year - a.year) };
}

module.exports = { ledger, editBuy, deleteBuy, realizedReport };
