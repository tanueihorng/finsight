// Portfolio operations and valuation: buy/sell/delete, accounts, live P&L with
// the stock-vs-FX split, FX risk, dividends, watchlist, alerts, CSV import.
import { execFile } from 'node:child_process';
import { getQuote, getQuotes, getFxRate, usdToBaseAt, fxRateAt, weeklyFxVol, getHistory } from './market.ts';
import { lineValueNow, indicatorNow, isPriceVsAverage, IND_TYPES } from './alertmath.ts';
import {
  newAccountId, newTxId, withUndo, loadPortfolio, recalcPosition, savePortfolio, findPos, resolveAccount,
  viewPositions, viewTransactions, viewCash, withLock,
} from './store.ts';
import { parseCsv, parseIbkrDividends } from './csv.ts';
import type { QuotedQuote, Quote, HistoryPoint, FxExposure, FxLot } from '../shared/types.ts';
import type { StoredAccount, StoredAlert, StoredLot, StoredPortfolio, StoredPosition, StoredTransaction, SoldLot } from './model.ts';

/** Untrusted JSON from a request body. */
type Loose = Record<string, any>;
/** A quote's fields, or none when the quote failed. */
type QuoteFields = Partial<QuotedQuote>;
/** USD->base rate at a time (market.usdToBaseAt). */
type UsdToBase = (t: number | null | undefined) => number | null;
const fieldsOf = (q: Quote | undefined): QuoteFields => (q || {}) as QuoteFields; // an error quote has none of the fields
export interface SellResult {
  legacy: boolean; proceedsBase: number; costBase: number; stock: number | null; fx: number | null; total: number; sellRate: number; heldSince: number | null;
}

// Same symbol shape the alerts and journal accept. Anything else (a stray
// spreadsheet formula, a comma that would break CSV exports) is refused.
const SYMBOL_RE = /^[A-Z0-9.^=\-_:]{1,24}$/;

// Core buy without the lock — callers must hold the lock (buy / importCsv do).
export async function buyUnlocked(symbolIn: unknown, quantityIn: unknown, priceIn: unknown, dateMs?: number | null, accountId?: string, base?: string): Promise<StoredPortfolio> {
  const symbol = String(symbolIn || '').toUpperCase().trim();
  const quantity = Number(quantityIn);
  const price = Number(priceIn);
  if (!SYMBOL_RE.test(symbol)) throw new Error('Need a valid symbol (up to 24 of A–Z 0–9 . ^ = _ : -)');
  if (!(quantity > 0) || !(price >= 0)) throw new Error('Need symbol, quantity > 0, price >= 0');
  const p = loadPortfolio();
  const acc = resolveAccount(p, accountId);
  let info: { name?: string; currency?: string } = {};
  try { const q = await getQuote(symbol); info = { name: q.name, currency: q.currency }; } catch {}
  const currency = (info.currency || findPos(acc, symbol)?.currency || 'USD').toUpperCase();
  const now = Date.now();
  const t = (dateMs && Number.isFinite(dateMs) && dateMs < now) ? dateMs : now; // purchase date
  let fxUsd: number | null = null; // native -> USD rate at purchase time (anchor for FX P&L)
  try { fxUsd = (t === now) ? await getFxRate(currency, 'USD') : await fxRateAt(currency, 'USD', t); } catch {}
  // Persist USD->base at purchase time too, so historical FX P&L in this base is
  // reproducible and doesn't drift with the cached weekly series.
  let usdBase: number | null = null; const usdBaseCcy = (base || '').toUpperCase();
  if (usdBaseCcy && usdBaseCcy !== 'USD') {
    try { usdBase = (t === now) ? await getFxRate('USD', usdBaseCcy) : await fxRateAt('USD', usdBaseCcy, t); } catch {}
  }
  let pos = findPos(acc, symbol);
  if (!pos) { pos = { symbol, name: info.name || symbol, currency, quantity: 0, avgCost: 0, lots: [] }; acc.positions.push(pos); }
  const id = newTxId();
  const lot: StoredLot = { q: quantity, px: price, fxUsd, t, tx: id }; // tx links the lot to its BUY for ledger edits
  if (usdBase != null) { lot.usdBase = usdBase; lot.usdBaseCcy = usdBaseCcy; }
  pos.lots.push(lot);
  if (info.name) pos.name = info.name;
  pos.currency = currency;
  recalcPosition(pos);
  acc.transactions.push({ id, type: 'BUY', symbol, quantity, price, currency, fxUsd, time: t });
  savePortfolio(p);
  return p;
}
export const buy = (symbol: unknown, quantity: unknown, price: unknown, dateMs?: number | null, accountId?: string, base?: string) => withLock(() =>
  withUndo(`Buy ${quantity} ${String(symbol).toUpperCase()}`, () => buyUnlocked(symbol, quantity, price, dateMs, accountId, base)));

export function sell(symbolIn: unknown, quantityIn: unknown, priceIn: unknown, accountId?: string, base?: string, dateMs?: number | null) {
  // Fetch everything remote BEFORE taking the write lock: holding the global
  // portfolio lock across Yahoo/FX round-trips stalled every other mutation.
  const symbol = String(symbolIn).toUpperCase();
  let price: unknown = priceIn;
  const usdBaseCcy = (base || '').toUpperCase();
  // Sale date: a past date records that day's FX (like a dated buy); none, or a
  // future one, is now. Checked against the lots again under the lock.
  const now = Date.now();
  const t = (dateMs && Number.isFinite(dateMs) && dateMs < now) ? dateMs : now;
  // Peek at the local position only to learn its currency so the FX round-trips
  // can run outside the lock. Everything is re-validated under the lock.
  let peekCurrency: string | null = null;
  try {
    const pos = findPos(resolveAccount(loadPortfolio(), accountId), symbol);
    if (pos) peekCurrency = (pos.currency || 'USD').toUpperCase();
  } catch {}
  const needPrice = price == null || price === '' || Number.isNaN(Number(price));
  const pricePromise = needPrice
    ? getQuote(symbol).then((q) => q.price).catch(() => null)
    : Promise.resolve(null);
  const currencyPeek = peekCurrency;
  const fxPromise: Promise<{ fxUsdSell?: number; usdBaseSell?: number }> = !currencyPeek ? Promise.resolve({}) : (async () => {
    const out: { fxUsdSell?: number; usdBaseSell?: number } = {};
    try { out.fxUsdSell = t === now ? await getFxRate(currencyPeek, 'USD') : await fxRateAt(currencyPeek, 'USD', t); } catch {}
    if (usdBaseCcy && usdBaseCcy !== 'USD') {
      try { out.usdBaseSell = t === now ? await getFxRate('USD', usdBaseCcy) : await fxRateAt('USD', usdBaseCcy, t); } catch {}
    }
    return out;
  })();

  return withLock(() => withUndo(`Sell ${quantityIn} ${symbol}`, async () => {
    const quantity = Number(quantityIn);
    const p = loadPortfolio();
    const acc = resolveAccount(p, accountId);
    const pos = findPos(acc, symbol);
    if (!pos) throw new Error(`No position in ${symbol}`);
    if (!(quantity > 0)) throw new Error('Quantity must be > 0');
    if (quantity > pos.quantity + 1e-9) throw new Error(`You only hold ${pos.quantity} ${symbol}`);
    // A sale can't predate the first purchase: there were no shares to sell yet.
    const first = Math.min(...(pos.lots || []).map((l) => l.t ?? Infinity));
    if (t !== now && Number.isFinite(first) && t < first - 864e5) throw new Error(`You first bought ${symbol} on ${new Date(first).toISOString().slice(0, 10)}; the sale date can't be earlier`);
    // If price not supplied, use the market price fetched before locking.
    if (needPrice) {
      price = await pricePromise;
      if (price == null) throw new Error('Could not fetch price; supply a sell price');
    }
    const sellPrice = Number(price);
    const realized = (sellPrice - pos.avgCost) * quantity;
    // Selling (effectively) the whole position -> factor 0 so no float dust survives.
    const full = quantity >= pos.quantity - 1e-9;
    const factor = full ? 0 : (pos.quantity - quantity) / pos.quantity; // proportional lot reduction
    // Snapshot the consumed slice of each lot (with its purchase-time FX) BEFORE
    // scaling them down, so realized P&L can later be split into stock vs FX.
    const currency = (pos.currency || 'USD').toUpperCase();
    const consumed = 1 - factor;
    const lotsSold: SoldLot[] = (pos.lots || [])
      .map((l) => ({ q: l.q * consumed, px: l.px, fxUsd: l.fxUsd ?? null, t: l.t ?? null,
        usdBase: l.usdBase ?? null, usdBaseCcy: l.usdBaseCcy ?? null }))
      .filter((l) => l.q > 1e-12);
    const { fxUsdSell = null, usdBaseSell = null } = await fxPromise;
    pos.lots.forEach((l) => { l.q *= factor; });
    recalcPosition(pos);
    const tx: StoredTransaction = { id: newTxId(), type: 'SELL', symbol, quantity, price: sellPrice, realized, currency, fxUsdSell, lotsSold, time: t };
    if (usdBaseSell != null) { tx.usdBaseSell = usdBaseSell; tx.usdBaseSellCcy = usdBaseCcy; }
    acc.transactions.push(tx);
    if (pos.quantity <= 1e-9) acc.positions = acc.positions.filter((x) => x !== pos);
    savePortfolio(p);
    return { portfolio: p, realized };
  }));
}

export function del(symbolIn: unknown, accountId?: string) {
  const symbol = symbolIn as string; // a non-string fails at toUpperCase, as before
  return withLock(() => withUndo(`Remove ${String(symbol).toUpperCase()}`, () => {
    const p = loadPortfolio();
    const acc = resolveAccount(p, accountId);
    const before = acc.positions.length;
    acc.positions = acc.positions.filter((x) => x.symbol.toUpperCase() !== symbol.toUpperCase());
    if (acc.positions.length === before) throw new Error(`No position in ${symbol}`);
    acc.transactions.push({ id: newTxId(), type: 'DELETE', symbol: symbol.toUpperCase(), time: Date.now() });
    savePortfolio(p);
    return p;
  }));
}

// Set an account's uninvested cash in one currency (0 removes it).
export function setCash(ccyIn: unknown, amount: unknown, accountId?: string) {
  const ccy = String(ccyIn || '').toUpperCase().trim();
  if (!/^[A-Z]{3}$/.test(ccy)) throw new Error('Currency must be a 3-letter code, e.g. USD');
  const v = Number(amount);
  if (!Number.isFinite(v)) throw new Error('Amount must be a number');
  return withLock(() => withUndo(`Cash ${ccy} ${v}`, () => {
    const p = loadPortfolio();
    const acc = resolveAccount(p, accountId);
    if (v === 0) delete acc.cash[ccy]; else acc.cash[ccy] = v;
    savePortfolio(p);
    return acc.cash;
  }));
}

// Account management
export function listAccounts() {
  const p = loadPortfolio();
  return { accounts: p.accounts.map((a) => ({ id: a.id, name: a.name, type: a.type || '', count: a.positions.length })), activeId: p.activeId };
}
export function accountAdd(name: unknown, type: unknown): Promise<string> {
  return withLock(() => withUndo(`Add account ${name || ''}`, () => {
    const p = loadPortfolio();
    const id = newAccountId();
    // Stored without dividends/cash; loadPortfolio adds them on the next read.
    p.accounts.push({ id, name: String(name || 'Account').slice(0, 40), type: String(type || '').slice(0, 30), positions: [], transactions: [] } as unknown as StoredAccount);
    p.activeId = id;
    savePortfolio(p);
    return id;
  }));
}
export function accountRename(id: unknown, name: unknown, type: unknown) {
  return withLock(() => withUndo('Rename account', () => {
    const p = loadPortfolio();
    const a = p.accounts.find((x) => x.id === id);
    if (!a) throw new Error('Unknown account');
    if (name != null) a.name = String(name).slice(0, 40);
    if (type != null) a.type = String(type).slice(0, 30);
    savePortfolio(p);
  }));
}
export function accountRemove(id: unknown) {
  return withLock(() => withUndo('Delete account', () => {
    const p = loadPortfolio();
    if (p.accounts.length <= 1) throw new Error('Cannot remove your only account');
    p.accounts = p.accounts.filter((x) => x.id !== id);
    if (p.activeId === id) p.activeId = p.accounts[0]!.id;
    savePortfolio(p);
  }));
}

// native->base FX rate for a purchase lot. Prefers the USD->base rate persisted
// at buy time (reproducible, drift-free) when it was captured for THIS base;
// otherwise reconstructs from the USD anchor + weekly USD->base history (u2b);
// else falls back to today's rate.
export function lotBuyRate(l: Pick<StoredLot, 'fxUsd' | 't'> & { usdBase?: number | null; usdBaseCcy?: string | null }, base: string, u2b: UsdToBase, rateNow: number): number {
  if (l.fxUsd != null && l.usdBase != null && l.usdBaseCcy === base) return l.fxUsd * l.usdBase;
  // u2b returns a rate for any dated lot (null only for a missing time).
  if (l.fxUsd != null && l.t) return l.fxUsd * u2b(l.t)!;
  return rateNow;
}

// Realized P&L of one SELL, in base. Sells that captured FX at sell time
// (lotsSold + fxUsdSell) split into stock vs FX, valued at the sell-moment FX;
// legacy sells (no snapshot) convert native realized at today's rate, no split.
export function realizedOfSell(t: StoredTransaction, base: string, u2b: UsdToBase, rateNow: number): SellResult {
  // A SELL always stores price, quantity and realized (legacy ones too).
  const price = t.price!, quantity = t.quantity!;
  if (Array.isArray(t.lotsSold) && t.fxUsdSell != null) {
    // native -> base at sell: prefer the rate persisted at sell time for THIS base
    // (drift-free), else reconstruct from the USD anchor + weekly history.
    const usdBaseSell = (t.usdBaseSell != null && t.usdBaseSellCcy === base) ? t.usdBaseSell : u2b(t.time)!;
    const sellRate = t.fxUsdSell * usdBaseSell;
    let costNative = 0, costBase = 0, qt = 0;
    for (const l of t.lotsSold) {
      costNative += l.q * l.px; costBase += l.q * l.px * lotBuyRate(l, base, u2b, sellRate);
      if (l.t) qt += l.q * l.t;
    }
    const proceedsBase = price * quantity * sellRate;
    const stock = proceedsBase - costNative * sellRate;          // price move @ sell FX
    const fx = costNative * sellRate - costBase;                 // currency move buy->sell
    const dated = t.lotsSold.filter((l) => l.t).reduce((s, l) => s + l.q, 0);
    const heldSince = dated ? qt / dated : null;                 // quantity-weighted purchase time
    return { legacy: false, proceedsBase, costBase, stock, fx, total: stock + fx, sellRate, heldSince };
  }
  const total = t.realized! * rateNow;
  return { legacy: true, proceedsBase: price * quantity * rateNow, costBase: price * quantity * rateNow - total,
    stock: null, fx: null, total, sellRate: rateNow, heldSince: null };
}

// Portfolio enriched with live quotes + P&L, all rolled up into `base` currency.
// Per-share avg/last stay in each security's NATIVE currency; market values,
// cost, P&L and totals are converted to `base` at current FX (best effort).
export async function portfolioWithQuotes(baseIn: string | null | undefined = 'SGD', accountId?: string) {
  const base = (baseIn || 'SGD').toUpperCase();
  const p = loadPortfolio();
  const srcPositions = viewPositions(p, accountId);
  const srcTx = viewTransactions(p, accountId);
  const symbols = srcPositions.map((x) => x.symbol);
  const quotes = symbols.length ? await getQuotes(symbols) : [];
  const qmap = Object.fromEntries(quotes.map((q) => [q.symbol, q]));

  // Resolve FX rates for every currency present (positions + sell history).
  const currencies = new Set<string>();
  srcPositions.forEach((pos) => currencies.add((fieldsOf(qmap[pos.symbol]).currency || pos.currency || 'USD').toUpperCase()));
  srcTx.forEach((t) => { if (t.type === 'SELL') currencies.add((t.currency || 'USD').toUpperCase()); });
  const cashNative = viewCash(p, accountId);
  Object.keys(cashNative).forEach((c) => currencies.add(c));
  const fx: Record<string, number> = {}; const fxMissing: string[] = [];
  for (const c of currencies) {
    try { fx[c] = await getFxRate(c, base); }
    catch { fx[c] = 1; if (c !== base) fxMissing.push(c); }
  }
  const rate = (c: string | null | undefined) => fx[(c || 'USD').toUpperCase()] ?? 1;
  const u2b = await usdToBaseAt(base); // t(ms) -> USD->base rate at that time

  let totalValue = 0, totalCost = 0, dayPnl = 0, totalStockPnl = 0, totalFxPnl = 0, prevValue = 0;
  const positions = srcPositions.map((pos) => {
    const { lots, ...rest } = pos;
    const q = fieldsOf(qmap[pos.symbol]);
    const currency = (q.currency || pos.currency || 'USD').toUpperCase();
    const fxRate = rate(currency);                              // native -> base NOW
    const last = q.price != null ? q.price : pos.avgCost;       // native per-share
    const prevClose = q.prevClose != null ? q.prevClose : last; // native prior close
    const marketValue = last * pos.quantity * fxRate;           // base
    const costAtNow = pos.avgCost * pos.quantity * fxRate;      // original cost re-priced at today's FX
    // actual amount paid, in base, using each lot's purchase-time FX
    let costAtBuy = 0;
    for (const l of (lots || [])) {
      costAtBuy += l.q * l.px * lotBuyRate(l, base, u2b, fxRate); // native->base at buy
    }
    const stockPnl = marketValue - costAtNow;                   // pure price move @ today's FX
    // Base-currency holdings carry no FX risk; force fxPnl to exactly 0 (avoids a
    // sub-0.1% round-trip residual from the two non-reciprocal FX quotes), matching
    // fxRisk()'s `currency === base` skip so the two totals reconcile.
    const cost = (currency === base) ? costAtNow : costAtBuy;   // true cost basis = what you actually paid
    const fxPnl = costAtNow - cost;                            // pure FX move on your cost (0 when native==base)
    const unrealized = marketValue - cost;                     // = stockPnl + fxPnl
    const unrealizedPct = cost ? (unrealized / cost) * 100 : 0;
    const dayChange = (q.change != null ? q.change : 0) * pos.quantity * fxRate; // base
    totalValue += marketValue; totalCost += cost; dayPnl += dayChange;
    totalStockPnl += stockPnl; totalFxPnl += fxPnl; prevValue += prevClose * pos.quantity * fxRate;
    return {
      ...rest, currency, fxRate, last: last!, change: q.change ?? null, changePct: q.changePct ?? null,
      marketValue, cost, costAtNow, unrealized, unrealizedPct, stockPnl, fxPnl, dayChange, name: q.name || pos.name,
      quoted: q.price != null, // false = manual holding with no market data (valued at its own cost)
    } as typeof rest & { currency: string; fxRate: number; last: number; change: number | null; changePct: number | null; marketValue: number; cost: number;
      costAtNow: number; unrealized: number; unrealizedPct: number; stockPnl: number; fxPnl: number; dayChange: number; name: string | undefined; quoted: boolean; weight: number };
  });
  // weight is filled in here, after the totals.
  positions.forEach((pos) => { pos.weight = totalValue ? (pos.marketValue / totalValue) * 100 : 0; });
  positions.sort((a, b) => b.marketValue - a.marketValue);

  // Realized P&L across all sells in view. Sells that captured FX at sell time
  // (new sells: lotsSold + fxUsdSell) are split into stock vs FX, valued at the
  // sell-moment FX. Legacy sells (no snapshot) fall back to native realized at
  // today's FX, contributing only to the total (no stock/FX split).
  let realizedPnl = 0, realizedStockPnl = 0, realizedFxPnl = 0, realizedLegacy = 0;
  for (const t of srcTx) {
    if (t.type !== 'SELL' || t.realized == null) continue;
    const r = realizedOfSell(t, base, u2b, rate(t.currency));
    realizedPnl += r.total;
    if (r.legacy) realizedLegacy++; else { realizedStockPnl += r.stock!; realizedFxPnl += r.fx!; }
  }

  const cash = Object.entries(cashNative).map(([ccy, amount]) => ({ ccy, amount, base: amount * rate(ccy) }))
    .sort((a, b) => b.base - a.base);
  const cashBase = cash.reduce((s, c) => s + c.base, 0);

  return {
    base, fx, fxMissing,
    account: accountId || p.activeId,
    positions, cash,
    summary: {
      totalValue, totalCost, cashBase, netWorth: totalValue + cashBase,
      totalUnrealized: totalValue - totalCost,
      totalUnrealizedPct: totalCost ? ((totalValue - totalCost) / totalCost) * 100 : 0,
      totalStockPnl, totalFxPnl,
      dayPnl, dayPct: prevValue ? (dayPnl / prevValue) * 100 : 0,
      realizedPnl, realizedStockPnl, realizedFxPnl, realizedLegacy,
    },
    transactions: [...srcTx].sort((a, b) => (a.time || 0) - (b.time || 0)).slice(-50).reverse(), // newest first across accounts
  };
}

// --------------------------------------------------------------------------
// FX risk view — currency exposure + per-buy FX P&L for foreign holdings.
// You fund in `base` (e.g. SGD) but hold foreign-currency stocks (USD), so part
// of your value rides on the exchange rate. This decomposes, per currency:
//   exposure   = current market value of those holdings, in base
//   blended    = your weighted-average native->base cost rate ("entry FX")
//   fxPnl      = base gained/lost from the rate moving, on your cost
// plus a per-lot list so you can see the FX gain/loss of each historical buy.
// Reuses the same per-lot anchoring (lot.fxUsd + usdToBaseAt) as the portfolio
// view, so totalFxPnl here matches summary.totalFxPnl for foreign holdings.
// --------------------------------------------------------------------------
export async function fxRisk(baseIn: string | null | undefined = 'SGD', accountId?: string) {
  const base = (baseIn || 'SGD').toUpperCase();
  const p = loadPortfolio();
  const srcPositions = viewPositions(p, accountId);
  const symbols = srcPositions.map((x) => x.symbol);
  const quotes = symbols.length ? await getQuotes(symbols) : [];
  const qmap = Object.fromEntries(quotes.map((q) => [q.symbol, q]));

  // Current native->base spot for every currency held.
  const currencies = new Set<string>();
  srcPositions.forEach((pos) => currencies.add((fieldsOf(qmap[pos.symbol]).currency || pos.currency || 'USD').toUpperCase()));
  const spot: Record<string, number> = {};
  for (const c of currencies) { try { spot[c] = await getFxRate(c, base); } catch { spot[c] = 1; } }
  const u2b = await usdToBaseAt(base); // t(ms) -> USD->base rate at that time

  const cashNative = viewCash(p, accountId);
  for (const c of Object.keys(cashNative)) if (spot[c] == null) { try { spot[c] = await getFxRate(c, base); } catch { spot[c] = 1; } }
  const byCcy: Record<string, { mvNative: number; mvBase: number; costNative: number; costBase: number; fxPnl: number }> = {};     // ccy -> { mvNative, mvBase, costNative, costBase, fxPnl }
  const lots: FxLot[] = [];
  let totalValue = 0, totalFxPnl = 0;
  for (const pos of srcPositions) {
    const q = fieldsOf(qmap[pos.symbol]);
    const currency = (q.currency || pos.currency || 'USD').toUpperCase();
    const last = q.price != null ? q.price : pos.avgCost;
    const rateNow = spot[currency] ?? 1;             // native -> base, now
    const mvBase = last * pos.quantity * rateNow;
    totalValue += mvBase;
    if (currency === base) continue;                 // base-currency holdings carry no FX risk
    const e = byCcy[currency] || (byCcy[currency] = { mvNative: 0, mvBase: 0, costNative: 0, costBase: 0, fxPnl: 0 });
    e.mvNative += last * pos.quantity;
    e.mvBase += mvBase;
    for (const l of (pos.lots || [])) {
      const rBuy = lotBuyRate(l, base, u2b, rateNow); // native->base at buy
      const costNotional = l.q * l.px;               // native cost of this lot
      const fxPnl = costNotional * (rateNow - rBuy); // currency-only gain on this lot, in base
      e.costNative += costNotional;
      e.costBase += costNotional * rBuy;
      e.fxPnl += fxPnl;
      totalFxPnl += fxPnl;
      lots.push({
        symbol: pos.symbol, currency, t: l.t || null, q: l.q, px: l.px,
        entryRate: rBuy, nowRate: rateNow, fxPnl,
        dated: !!l.t, recent: l.t ? (Date.now() - l.t < 7 * 24 * 60 * 60000) : false,
      });
    }
  }
  // Uninvested foreign cash is currency exposure too (no cost basis to track).
  const cashByCcy: Record<string, number> = {};
  for (const [c, amt] of Object.entries(cashNative)) {
    const b = amt * (spot[c] ?? 1);
    totalValue += b;
    if (c === base) continue;
    const e = byCcy[c] || (byCcy[c] = { mvNative: 0, mvBase: 0, costNative: 0, costBase: 0, fxPnl: 0 });
    e.mvNative += amt; e.mvBase += b; cashByCcy[c] = b;
  }
  lots.sort((a, b) => (b.t || 0) - (a.t || 0));       // newest buys first

  // Weekly FX volatility per exposure currency, for a 1-week parametric VaR.
  const vols: Record<string, number> = {};
  for (const ccy of Object.keys(byCcy)) vols[ccy] = await weeklyFxVol(ccy, base);

  const exposures: FxExposure[] = Object.entries(byCcy).map(([ccy, e]) => {
    // Every exposure currency has a spot rate (filled above).
    const blendedEntry = e.costNative ? e.costBase / e.costNative : spot[ccy]!; // weighted-avg native->base cost
    const nowRate = spot[ccy]!;
    const sigma = vols[ccy] || 0;                          // weekly log-return stdev
    return {
      ccy, base, cashBase: cashByCcy[ccy] || 0,
      notionalNative: e.mvNative,
      notionalBase: e.mvBase,
      pct: totalValue ? (e.mvBase / totalValue) * 100 : 0,
      blendedEntry: blendedEntry ?? nowRate, nowRate, breakeven: blendedEntry ?? nowRate,
      driftPct: blendedEntry ? ((nowRate - blendedEntry) / blendedEntry) * 100 : 0,
      fxPnl: e.fxPnl,
      fxPnlPct: e.costBase ? (e.fxPnl / e.costBase) * 100 : 0,
      sigmaWeeklyPct: sigma * 100,
      oneSigmaBase: e.mvBase * sigma,                       // ~68% of weeks stay within ±this
      var95Base: e.mvBase * 1.645 * sigma,                 // 95% 1-week VaR
    };
  }).sort((a, b) => b.notionalBase - a.notionalBase);

  const foreignBase = exposures.reduce((s, e) => s + e.notionalBase, 0);
  // Portfolio-level VaR: sum per-currency (conservative; exact for a single ccy).
  const vol = {
    sigmaWeeklyPct: foreignBase ? (exposures.reduce((s, e) => s + e.oneSigmaBase, 0) / foreignBase) * 100 : 0,
    oneSigmaBase: exposures.reduce((s, e) => s + e.oneSigmaBase, 0),
    var95Base: exposures.reduce((s, e) => s + e.var95Base, 0),
  };
  return { base, totalValue, foreignBase, totalFxPnl, exposures, vol, lots: lots.slice(0, 100) };
}

// --------------------------------------------------------------------------
// Watchlist (symbols you track but don't own)
// --------------------------------------------------------------------------
export async function watchlistWithQuotes() {
  const p = loadPortfolio();
  const syms = p.watchlist || [];
  return syms.length ? await getQuotes(syms) : [];
}
export async function watchAdd(symbolIn: unknown) {
  const symbol = ((symbolIn || '') as string).toUpperCase().trim(); // a non-string throws, as before
  if (!symbol) throw new Error('Symbol required');
  try { await getQuote(symbol); } catch { throw new Error(`Unknown symbol ${symbol}`); }
  return withLock(() => {
    const p = loadPortfolio();
    if (!p.watchlist.includes(symbol)) { p.watchlist.push(symbol); savePortfolio(p); }
    return p;
  });
}
export function watchRemove(symbolIn: unknown) {
  const symbol = ((symbolIn || '') as string).toUpperCase().trim();
  return withLock(() => {
    const p = loadPortfolio();
    p.watchlist = p.watchlist.filter((s) => s !== symbol);
    savePortfolio(p);
    return p;
  });
}

// --------------------------------------------------------------------------
// Price alerts
// --------------------------------------------------------------------------
// Alert kinds: 'price' (price vs level), 'line' (price crosses a drawn sloped
// line, valued at the latest bar), 'ind' (an oscillator vs a level, or price vs
// a moving average). All are local notifications only — nothing places orders.
const ALERT_IVS: Record<string, string> = { '1m': '5d', '5m': '1mo', '15m': '1mo', '60m': '6mo', '1d': '2y', '1wk': '5y' };
const finiteNum = (v: unknown) => typeof v === 'number' && Number.isFinite(v);
function cleanAlert(raw: Loose): Omit<StoredAlert, 'id' | 'createdAt' | 'triggeredAt'> {
  const symbol = String(raw.symbol || '').toUpperCase().trim();
  if (!/^[A-Z0-9.^=\-_:]{1,24}$/.test(symbol)) throw new Error('Need a valid symbol');
  const op = (raw.op === '<' || raw.op === 'below' || raw.op === 'under') ? '<' : '>';
  const kind = raw.kind === 'line' || raw.kind === 'ind' ? raw.kind : 'price';
  const out: Omit<StoredAlert, 'id' | 'createdAt' | 'triggeredAt'> = { symbol, op, kind, note: String(raw.note || '').slice(0, 200) };
  if (typeof raw.drawingId === 'string' && /^[\w-]{1,40}$/.test(raw.drawingId)) out.drawingId = raw.drawingId;
  if (kind === 'price') {
    const price = Number(raw.price);
    if (!(price > 0)) throw new Error('Need a symbol and a price > 0');
    out.price = price;
  } else if (kind === 'line') {
    const l = raw.line || {};
    const pts: { t: number; p: number }[] = Array.isArray(l.pts) ? l.pts.slice(0, 2).map((q: Loose | null) => ({ t: Number(q && q.t), p: Number(q && q.p) })) : [];
    if (pts.length !== 2 || !pts.every((q) => finiteNum(q.t) && q.p > 0) || pts[0]!.t === pts[1]!.t) throw new Error('Line alert needs two points at different times');
    const interval = ALERT_IVS[l.interval] ? l.interval : '1d';
    out.line = { pts, interval, log: !!l.log };
  } else {
    const i = raw.ind || {};
    if (!IND_TYPES[i.type]) throw new Error('Unknown indicator');
    const length = Math.round(Number(i.length));
    if (!(length >= 1 && length <= 500)) throw new Error('Indicator length 1–500');
    const interval = ALERT_IVS[i.interval] ? i.interval : '1d';
    out.ind = { type: i.type, length, interval };
    if (!isPriceVsAverage(i.type)) {
      const level = Number(raw.price);
      if (!Number.isFinite(level)) throw new Error('Indicator alert needs a level');
      out.price = level;
    }
  }
  return out;
}
// line/ind are present for their kinds (cleanAlert guarantees it).
function alertLabel(a: StoredAlert): string {
  const ge = a.op === '>' ? '≥' : '≤', f = (v: number | null | undefined) => (v == null ? '—' : +Number(v).toPrecision(6));
  if (a.kind === 'line') return `${a.symbol} ${a.op === '>' ? 'crosses above' : 'crosses below'} trend line (${a.line!.interval})`;
  if (a.kind === 'ind') {
    const ind = a.ind!;
    const nm = `${IND_TYPES[ind.type]}(${ind.length}, ${ind.interval})`;
    return isPriceVsAverage(ind.type) ? `${a.symbol} price ${ge} ${nm}` : `${a.symbol} ${nm} ${ge} ${f(a.price)}`;
  }
  return `${a.symbol} ${ge} ${f(a.price)}`;
}

export async function alertAdd(raw: Loose | null | undefined) {
  const a = cleanAlert(raw || {});
  try { await getQuote(a.symbol); } catch { throw new Error(`Unknown symbol ${a.symbol}`); }
  return withLock(() => {
    const p = loadPortfolio();
    const id = 'a' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    p.alerts.push({ id, ...a, createdAt: Date.now(), triggeredAt: null });
    savePortfolio(p);
    return p;
  });
}
// Replace an alert's condition (e.g. its trend line was moved); re-arms it.
export async function alertUpdate(raw: Loose | null | undefined) {
  const id = String((raw && raw.id) || '');
  return withLock(() => {
    const p = loadPortfolio();
    const k = p.alerts.findIndex((a) => a.id === id);
    if (k < 0) throw new Error('No such alert');
    const prev = p.alerts[k]!;
    const a = cleanAlert({ ...prev, ...raw, symbol: prev.symbol });
    p.alerts[k] = { id, ...a, createdAt: prev.createdAt, triggeredAt: null };
    savePortfolio(p);
    return p;
  });
}
export function alertRemove(id: unknown) {
  return withLock(() => {
    const p = loadPortfolio();
    p.alerts = p.alerts.filter((a) => a.id !== id);
    savePortfolio(p);
    return p;
  });
}
// Native macOS desktop notification (works even when the browser is closed).
// Disable with NOTIFY=0.
function desktopNotify(title: string, message: string) {
  if (process.env.NOTIFY === '0' || process.platform !== 'darwin') return;
  try {
    execFile('osascript',
      ['-e', 'on run {t, m}', '-e', 'display notification m with title t sound name "Ping"', '-e', 'end run', title, message],
      () => {});
  } catch {}
}

// The level an alert compares the live price (or oscillator) with right now.
type Reading = { value: number | null; level: number | null | undefined };
async function alertReading(a: StoredAlert, price: number): Promise<Reading> {
  if (a.kind === 'price' || !a.kind) return { value: price, level: a.price };
  const line = a.line!, ind = a.ind!; // the one for this kind is present
  const iv = a.kind === 'line' ? line.interval : ind.interval;
  let bars: HistoryPoint[];
  try { bars = (await getHistory(a.symbol, ALERT_IVS[iv] || '2y', iv)).points || []; } catch { return { value: null, level: null }; }
  if (a.kind === 'line') return { value: price, level: lineValueNow(bars, line.pts, line.log) };
  const v = indicatorNow(bars, ind.type, ind.length);
  return isPriceVsAverage(ind.type) ? { value: price, level: v } : { value: v, level: a.price };
}

// Evaluate every alert against the live price. Sets triggeredAt on first cross.
// When doNotify is true (the background timer), also fires a desktop notification
// once per alert (tracked via notifiedAt) so you're alerted even with the app closed.
export async function evaluateAlerts(doNotify: boolean) {
  // Quote/history fetches are slow network round-trips — do them BEFORE taking
  // the global write lock, otherwise every buy/sell/import queues behind Yahoo.
  const before = loadPortfolio().alerts;
  const syms = [...new Set(before.map((a) => a.symbol))];
  const quotes = syms.length ? await getQuotes(syms) : [];
  const qmap = Object.fromEntries(quotes.map((q) => [q.symbol, q]));
  const readings = new Map<string, Reading>();
  await Promise.all(before.map(async (a) => {
    const price = fieldsOf(qmap[a.symbol]).price ?? null;
    readings.set(a.id, price == null ? { value: null, level: null } : await alertReading(a, price));
  }));
  return withLock(async () => {
    const p = loadPortfolio();
    let changed = false;
    const out = p.alerts.map((a) => {
      const q = fieldsOf(qmap[a.symbol]);
      const price = q.price ?? null;
      const r = readings.get(a.id) || { value: null, level: null };
      const met = r.value != null && r.level != null && (a.op === '>' ? r.value >= r.level : r.value <= r.level);
      if (met && !a.triggeredAt) { a.triggeredAt = Date.now(); changed = true; }
      const label = alertLabel(a);
      if (doNotify && met && a.triggeredAt && !a.notifiedAt) {
        desktopNotify('FINSIGHT · alert', `${label} — now ${r.value != null ? +Number(r.value).toPrecision(6) : '—'}`);
        a.notifiedAt = Date.now(); changed = true;
      }
      return { ...a, kind: a.kind || 'price', label, currentPrice: price, currentValue: r.value, level: r.level, currency: q.currency, name: q.name, met };
    });
    if (changed) savePortfolio(p);
    return out;
  });
}
export const alertsWithStatus = () => evaluateAlerts(false);

export async function importCsv(text: unknown, replace: boolean, accountId?: string, base?: string) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('No valid rows found. Expected columns: symbol, quantity, avg price (optional: date).');
  const divs = parseIbkrDividends(text); // dividend history from IBKR statements (empty otherwise)
  // One lock for the whole import; uses buyUnlocked to avoid a self-deadlock.
  return withLock(() => withUndo(`Import ${rows.length} rows`, async () => {
    // Resolve the account up front so importing into "ALL"/unknown fails with a clear
    // error instead of every row silently failing inside the per-row catch below.
    const p = loadPortfolio(); const acc = resolveAccount(p, accountId);
    if (replace) { acc.positions = []; acc.transactions = []; acc.dividends = []; savePortfolio(p); }
    let added = 0; const failed: string[] = [];
    for (const r of rows) {
      try { await buyUnlocked(r.symbol, r.quantity, r.price, r.dateMs, accountId, base); added++; }
      catch (e) { failed.push(r.symbol); }
    }
    // Store dividends (reload since buyUnlocked re-saved the file each row).
    if (divs.length) {
      const p2 = loadPortfolio(); const acc2 = resolveAccount(p2, accountId);
      acc2.dividends = (acc2.dividends || []).concat(divs); savePortfolio(p2);
    }
    return { added, total: rows.length, failed, dividends: divs.length };
  }));
}
export function resetPortfolio(accountId?: string) {
  return withLock(() => withUndo('Clear all positions', () => {
    const p = loadPortfolio();
    const acc = resolveAccount(p, accountId);
    acc.positions = []; acc.transactions = []; acc.dividends = [];
    savePortfolio(p);
    return p;
  }));
}
