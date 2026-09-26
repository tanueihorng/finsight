'use strict';
// Portfolio operations and valuation: buy/sell/delete, accounts, live P&L with
// the stock-vs-FX split, FX risk, dividends, watchlist, alerts, CSV import.
const { execFile } = require('child_process');
const { getQuote, getQuotes, getFxRate, usdToBaseAt, fxRateAt, weeklyFxVol } = require('./market');
const {
  newAccountId, newTxId, withUndo, loadPortfolio, recalcPosition, savePortfolio, findPos, resolveAccount,
  viewPositions, viewTransactions, viewCash, withLock,
} = require('./store');
const { parseCsv, parseIbkrDividends } = require('./csv');

// Core buy without the lock — callers must hold the lock (buy / importCsv do).
async function buyUnlocked(symbol, quantity, price, dateMs, accountId, base) {
  symbol = symbol.toUpperCase();
  quantity = Number(quantity);
  price = Number(price);
  if (!symbol || !(quantity > 0) || !(price >= 0)) throw new Error('Need symbol, quantity > 0, price >= 0');
  const p = loadPortfolio();
  const acc = resolveAccount(p, accountId);
  let info = {};
  try { const q = await getQuote(symbol); info = { name: q.name, currency: q.currency }; } catch {}
  const currency = (info.currency || findPos(acc, symbol)?.currency || 'USD').toUpperCase();
  const now = Date.now();
  const t = (dateMs && Number.isFinite(dateMs) && dateMs < now) ? dateMs : now; // purchase date
  let fxUsd = null; // native -> USD rate at purchase time (anchor for FX P&L)
  try { fxUsd = (t === now) ? await getFxRate(currency, 'USD') : await fxRateAt(currency, 'USD', t); } catch {}
  // Persist USD->base at purchase time too, so historical FX P&L in this base is
  // reproducible and doesn't drift with the cached weekly series.
  let usdBase = null; const usdBaseCcy = (base || '').toUpperCase();
  if (usdBaseCcy && usdBaseCcy !== 'USD') {
    try { usdBase = (t === now) ? await getFxRate('USD', usdBaseCcy) : await fxRateAt('USD', usdBaseCcy, t); } catch {}
  }
  let pos = findPos(acc, symbol);
  if (!pos) { pos = { symbol, name: info.name || symbol, currency, quantity: 0, avgCost: 0, lots: [] }; acc.positions.push(pos); }
  const id = newTxId();
  const lot = { q: quantity, px: price, fxUsd, t, tx: id }; // tx links the lot to its BUY for ledger edits
  if (usdBase != null) { lot.usdBase = usdBase; lot.usdBaseCcy = usdBaseCcy; }
  pos.lots.push(lot);
  if (info.name) pos.name = info.name;
  pos.currency = currency;
  recalcPosition(pos);
  acc.transactions.push({ id, type: 'BUY', symbol, quantity, price, currency, fxUsd, time: t });
  savePortfolio(p);
  return p;
}
const buy = (symbol, quantity, price, dateMs, accountId, base) => withLock(() =>
  withUndo(`Buy ${quantity} ${String(symbol).toUpperCase()}`, () => buyUnlocked(symbol, quantity, price, dateMs, accountId, base)));

function sell(symbol, quantity, price, accountId, base) {
  // Fetch everything remote BEFORE taking the write lock: holding the global
  // portfolio lock across Yahoo/FX round-trips stalled every other mutation.
  symbol = String(symbol).toUpperCase();
  const usdBaseCcy = (base || '').toUpperCase();
  // Peek at the local position only to learn its currency so the FX round-trips
  // can run outside the lock. Everything is re-validated under the lock.
  let peekCurrency = null;
  try {
    const pos = findPos(resolveAccount(loadPortfolio(), accountId), symbol);
    if (pos) peekCurrency = (pos.currency || 'USD').toUpperCase();
  } catch {}
  const needPrice = price == null || price === '' || Number.isNaN(Number(price));
  const pricePromise = needPrice
    ? getQuote(symbol).then((q) => q.price).catch(() => null)
    : Promise.resolve(null);
  const fxPromise = !peekCurrency ? Promise.resolve({}) : (async () => {
    const out = {};
    try { out.fxUsdSell = await getFxRate(peekCurrency, 'USD'); } catch {}
    if (usdBaseCcy && usdBaseCcy !== 'USD') {
      try { out.usdBaseSell = await getFxRate('USD', usdBaseCcy); } catch {}
    }
    return out;
  })();

  return withLock(() => withUndo(`Sell ${quantity} ${symbol}`, async () => {
    quantity = Number(quantity);
    const p = loadPortfolio();
    const acc = resolveAccount(p, accountId);
    const pos = findPos(acc, symbol);
    if (!pos) throw new Error(`No position in ${symbol}`);
    if (!(quantity > 0)) throw new Error('Quantity must be > 0');
    if (quantity > pos.quantity + 1e-9) throw new Error(`You only hold ${pos.quantity} ${symbol}`);
    // If price not supplied, use the market price fetched before locking.
    if (needPrice) {
      price = await pricePromise;
      if (price == null) throw new Error('Could not fetch price; supply a sell price');
    }
    price = Number(price);
    const realized = (price - pos.avgCost) * quantity;
    // Selling (effectively) the whole position -> factor 0 so no float dust survives.
    const full = quantity >= pos.quantity - 1e-9;
    const factor = full ? 0 : (pos.quantity - quantity) / pos.quantity; // proportional lot reduction
    // Snapshot the consumed slice of each lot (with its purchase-time FX) BEFORE
    // scaling them down, so realized P&L can later be split into stock vs FX.
    const currency = (pos.currency || 'USD').toUpperCase();
    const consumed = 1 - factor;
    const lotsSold = (pos.lots || [])
      .map((l) => ({ q: l.q * consumed, px: l.px, fxUsd: l.fxUsd ?? null, t: l.t ?? null,
        usdBase: l.usdBase ?? null, usdBaseCcy: l.usdBaseCcy ?? null }))
      .filter((l) => l.q > 1e-12);
    const { fxUsdSell = null, usdBaseSell = null } = await fxPromise;
    pos.lots.forEach((l) => { l.q *= factor; });
    recalcPosition(pos);
    const tx = { id: newTxId(), type: 'SELL', symbol, quantity, price, realized, currency, fxUsdSell, lotsSold, time: Date.now() };
    if (usdBaseSell != null) { tx.usdBaseSell = usdBaseSell; tx.usdBaseSellCcy = usdBaseCcy; }
    acc.transactions.push(tx);
    if (pos.quantity <= 1e-9) acc.positions = acc.positions.filter((x) => x !== pos);
    savePortfolio(p);
    return { portfolio: p, realized };
  }));
}

function del(symbol, accountId) {
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
function setCash(ccy, amount, accountId) {
  ccy = String(ccy || '').toUpperCase().trim();
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
function listAccounts() {
  const p = loadPortfolio();
  return { accounts: p.accounts.map((a) => ({ id: a.id, name: a.name, type: a.type || '', count: a.positions.length })), activeId: p.activeId };
}
function accountAdd(name, type) {
  return withLock(() => withUndo(`Add account ${name || ''}`, () => {
    const p = loadPortfolio();
    const id = newAccountId();
    p.accounts.push({ id, name: String(name || 'Account').slice(0, 40), type: String(type || '').slice(0, 30), positions: [], transactions: [] });
    p.activeId = id;
    savePortfolio(p);
    return id;
  }));
}
function accountRename(id, name, type) {
  return withLock(() => withUndo('Rename account', () => {
    const p = loadPortfolio();
    const a = p.accounts.find((x) => x.id === id);
    if (!a) throw new Error('Unknown account');
    if (name != null) a.name = String(name).slice(0, 40);
    if (type != null) a.type = String(type).slice(0, 30);
    savePortfolio(p);
  }));
}
function accountRemove(id) {
  return withLock(() => withUndo('Delete account', () => {
    const p = loadPortfolio();
    if (p.accounts.length <= 1) throw new Error('Cannot remove your only account');
    p.accounts = p.accounts.filter((x) => x.id !== id);
    if (p.activeId === id) p.activeId = p.accounts[0].id;
    savePortfolio(p);
  }));
}

// native->base FX rate for a purchase lot. Prefers the USD->base rate persisted
// at buy time (reproducible, drift-free) when it was captured for THIS base;
// otherwise reconstructs from the USD anchor + weekly USD->base history (u2b);
// else falls back to today's rate.
function lotBuyRate(l, base, u2b, rateNow) {
  if (l.fxUsd != null && l.usdBase != null && l.usdBaseCcy === base) return l.fxUsd * l.usdBase;
  if (l.fxUsd != null && l.t) return l.fxUsd * u2b(l.t);
  return rateNow;
}

// Realized P&L of one SELL, in base. Sells that captured FX at sell time
// (lotsSold + fxUsdSell) split into stock vs FX, valued at the sell-moment FX;
// legacy sells (no snapshot) convert native realized at today's rate, no split.
function realizedOfSell(t, base, u2b, rateNow) {
  if (Array.isArray(t.lotsSold) && t.fxUsdSell != null) {
    // native -> base at sell: prefer the rate persisted at sell time for THIS base
    // (drift-free), else reconstruct from the USD anchor + weekly history.
    const usdBaseSell = (t.usdBaseSell != null && t.usdBaseSellCcy === base) ? t.usdBaseSell : u2b(t.time);
    const sellRate = t.fxUsdSell * usdBaseSell;
    let costNative = 0, costBase = 0, qt = 0;
    for (const l of t.lotsSold) {
      costNative += l.q * l.px; costBase += l.q * l.px * lotBuyRate(l, base, u2b, sellRate);
      if (l.t) qt += l.q * l.t;
    }
    const proceedsBase = t.price * t.quantity * sellRate;
    const stock = proceedsBase - costNative * sellRate;          // price move @ sell FX
    const fx = costNative * sellRate - costBase;                 // currency move buy->sell
    const dated = t.lotsSold.filter((l) => l.t).reduce((s, l) => s + l.q, 0);
    const heldSince = dated ? qt / dated : null;                 // quantity-weighted purchase time
    return { legacy: false, proceedsBase, costBase, stock, fx, total: stock + fx, sellRate, heldSince };
  }
  const total = t.realized * rateNow;
  return { legacy: true, proceedsBase: t.price * t.quantity * rateNow, costBase: t.price * t.quantity * rateNow - total,
    stock: null, fx: null, total, sellRate: rateNow, heldSince: null };
}

// Portfolio enriched with live quotes + P&L, all rolled up into `base` currency.
// Per-share avg/last stay in each security's NATIVE currency; market values,
// cost, P&L and totals are converted to `base` at current FX (best effort).
async function portfolioWithQuotes(base = 'SGD', accountId) {
  base = (base || 'SGD').toUpperCase();
  const p = loadPortfolio();
  const srcPositions = viewPositions(p, accountId);
  const srcTx = viewTransactions(p, accountId);
  const symbols = srcPositions.map((x) => x.symbol);
  const quotes = symbols.length ? await getQuotes(symbols) : [];
  const qmap = Object.fromEntries(quotes.map((q) => [q.symbol, q]));

  // Resolve FX rates for every currency present (positions + sell history).
  const currencies = new Set();
  srcPositions.forEach((pos) => currencies.add((qmap[pos.symbol]?.currency || pos.currency || 'USD').toUpperCase()));
  srcTx.forEach((t) => { if (t.type === 'SELL') currencies.add((t.currency || 'USD').toUpperCase()); });
  const cashNative = viewCash(p, accountId);
  Object.keys(cashNative).forEach((c) => currencies.add(c));
  const fx = {}; const fxMissing = [];
  for (const c of currencies) {
    try { fx[c] = await getFxRate(c, base); }
    catch { fx[c] = 1; if (c !== base) fxMissing.push(c); }
  }
  const rate = (c) => fx[(c || 'USD').toUpperCase()] ?? 1;
  const u2b = await usdToBaseAt(base); // t(ms) -> USD->base rate at that time

  let totalValue = 0, totalCost = 0, dayPnl = 0, totalStockPnl = 0, totalFxPnl = 0, prevValue = 0;
  const positions = srcPositions.map((pos) => {
    const { lots, ...rest } = pos;
    const q = qmap[pos.symbol] || {};
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
      ...rest, currency, fxRate, last, change: q.change ?? null, changePct: q.changePct ?? null,
      marketValue, cost, costAtNow, unrealized, unrealizedPct, stockPnl, fxPnl, dayChange, name: q.name || pos.name,
    };
  });
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
    if (r.legacy) realizedLegacy++; else { realizedStockPnl += r.stock; realizedFxPnl += r.fx; }
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
    transactions: srcTx.slice(-50).reverse(),
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
async function fxRisk(base = 'SGD', accountId) {
  base = (base || 'SGD').toUpperCase();
  const p = loadPortfolio();
  const srcPositions = viewPositions(p, accountId);
  const symbols = srcPositions.map((x) => x.symbol);
  const quotes = symbols.length ? await getQuotes(symbols) : [];
  const qmap = Object.fromEntries(quotes.map((q) => [q.symbol, q]));

  // Current native->base spot for every currency held.
  const currencies = new Set();
  srcPositions.forEach((pos) => currencies.add((qmap[pos.symbol]?.currency || pos.currency || 'USD').toUpperCase()));
  const spot = {};
  for (const c of currencies) { try { spot[c] = await getFxRate(c, base); } catch { spot[c] = 1; } }
  const u2b = await usdToBaseAt(base); // t(ms) -> USD->base rate at that time

  const cashNative = viewCash(p, accountId);
  for (const c of Object.keys(cashNative)) if (spot[c] == null) { try { spot[c] = await getFxRate(c, base); } catch { spot[c] = 1; } }
  const byCcy = {};     // ccy -> { mvNative, mvBase, costNative, costBase, fxPnl }
  const lots = [];
  let totalValue = 0, totalFxPnl = 0;
  for (const pos of srcPositions) {
    const q = qmap[pos.symbol] || {};
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
  const cashByCcy = {};
  for (const [c, amt] of Object.entries(cashNative)) {
    const b = amt * (spot[c] ?? 1);
    totalValue += b;
    if (c === base) continue;
    const e = byCcy[c] || (byCcy[c] = { mvNative: 0, mvBase: 0, costNative: 0, costBase: 0, fxPnl: 0 });
    e.mvNative += amt; e.mvBase += b; cashByCcy[c] = b;
  }
  lots.sort((a, b) => (b.t || 0) - (a.t || 0));       // newest buys first

  // Weekly FX volatility per exposure currency, for a 1-week parametric VaR.
  const vols = {};
  for (const ccy of Object.keys(byCcy)) vols[ccy] = await weeklyFxVol(ccy, base);

  const exposures = Object.entries(byCcy).map(([ccy, e]) => {
    const blendedEntry = e.costNative ? e.costBase / e.costNative : spot[ccy]; // weighted-avg native->base cost
    const nowRate = spot[ccy];
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
async function watchlistWithQuotes() {
  const p = loadPortfolio();
  const syms = p.watchlist || [];
  return syms.length ? await getQuotes(syms) : [];
}
async function watchAdd(symbol) {
  symbol = (symbol || '').toUpperCase().trim();
  if (!symbol) throw new Error('Symbol required');
  try { await getQuote(symbol); } catch { throw new Error(`Unknown symbol ${symbol}`); }
  return withLock(() => {
    const p = loadPortfolio();
    if (!p.watchlist.includes(symbol)) { p.watchlist.push(symbol); savePortfolio(p); }
    return p;
  });
}
function watchRemove(symbol) {
  symbol = (symbol || '').toUpperCase().trim();
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
async function alertAdd({ symbol, op, price, note }) {
  symbol = (symbol || '').toUpperCase().trim();
  op = (op === '<' || op === 'below' || op === 'under') ? '<' : '>';
  price = Number(price);
  if (!symbol || !(price > 0)) throw new Error('Need a symbol and a price > 0');
  try { await getQuote(symbol); } catch { throw new Error(`Unknown symbol ${symbol}`); }
  return withLock(() => {
    const p = loadPortfolio();
    const id = 'a' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36);
    p.alerts.push({ id, symbol, op, price, note: note || '', createdAt: Date.now(), triggeredAt: null });
    savePortfolio(p);
    return p;
  });
}
function alertRemove(id) {
  return withLock(() => {
    const p = loadPortfolio();
    p.alerts = p.alerts.filter((a) => a.id !== id);
    savePortfolio(p);
    return p;
  });
}
// Native macOS desktop notification (works even when the browser is closed).
// Disable with NOTIFY=0.
function desktopNotify(title, message) {
  if (process.env.NOTIFY === '0' || process.platform !== 'darwin') return;
  try {
    execFile('osascript',
      ['-e', 'on run {t, m}', '-e', 'display notification m with title t sound name "Ping"', '-e', 'end run', title, message],
      () => {});
  } catch {}
}

// Evaluate every alert against the live price. Sets triggeredAt on first cross.
// When doNotify is true (the background timer), also fires a desktop notification
// once per alert (tracked via notifiedAt) so you're alerted even with the app closed.
async function evaluateAlerts(doNotify) {
  // Quote fetches are slow network round-trips — do them BEFORE taking the
  // global write lock, otherwise every buy/sell/import queues behind Yahoo.
  const syms = [...new Set(loadPortfolio().alerts.map((a) => a.symbol))];
  const quotes = syms.length ? await getQuotes(syms) : [];
  const qmap = Object.fromEntries(quotes.map((q) => [q.symbol, q]));
  return withLock(async () => {
    const p = loadPortfolio();
    let changed = false;
    const out = p.alerts.map((a) => {
      const q = qmap[a.symbol] || {};
      const price = q.price ?? null;
      const met = price != null && (a.op === '>' ? price >= a.price : price <= a.price);
      if (met && !a.triggeredAt) { a.triggeredAt = Date.now(); changed = true; }
      if (doNotify && met && a.triggeredAt && !a.notifiedAt) {
        desktopNotify('FINSIGHT · price alert', `${a.symbol} ${a.op === '>' ? '≥' : '≤'} ${a.price} — now ${price}`);
        a.notifiedAt = Date.now(); changed = true;
      }
      return { ...a, currentPrice: price, currency: q.currency, name: q.name, met };
    });
    if (changed) savePortfolio(p);
    return out;
  });
}
const alertsWithStatus = () => evaluateAlerts(false);

async function importCsv(text, replace, accountId, base) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error('No valid rows found. Expected columns: symbol, quantity, avg price (optional: date).');
  const divs = parseIbkrDividends(text); // dividend history from IBKR statements (empty otherwise)
  // One lock for the whole import; uses buyUnlocked to avoid a self-deadlock.
  return withLock(() => withUndo(`Import ${rows.length} rows`, async () => {
    // Resolve the account up front so importing into "ALL"/unknown fails with a clear
    // error instead of every row silently failing inside the per-row catch below.
    const p = loadPortfolio(); const acc = resolveAccount(p, accountId);
    if (replace) { acc.positions = []; acc.transactions = []; acc.dividends = []; savePortfolio(p); }
    let added = 0; const failed = [];
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
function resetPortfolio(accountId) {
  return withLock(() => withUndo('Clear all positions', () => {
    const p = loadPortfolio();
    const acc = resolveAccount(p, accountId);
    acc.positions = []; acc.transactions = []; acc.dividends = [];
    savePortfolio(p);
    return p;
  }));
}

module.exports = {
  buy, buyUnlocked, sell, del, listAccounts, accountAdd, accountRename, accountRemove,
  lotBuyRate, realizedOfSell, portfolioWithQuotes, fxRisk, setCash,
  watchlistWithQuotes, watchAdd, watchRemove, alertAdd, alertRemove, evaluateAlerts, alertsWithStatus,
  importCsv, resetPortfolio,
};
