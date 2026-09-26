'use strict';
// Portfolio store (data/portfolio.json): load/migrate, atomic save, account views,
// and the single write lock every read-modify-write goes through.
const fs = require('fs');
const { DATA_DIR, PORTFOLIO_FILE } = require('./config');

// --------------------------------------------------------------------------
// Portfolio store (persisted to data/portfolio.json)
// --------------------------------------------------------------------------
function newAccountId() { return 'acc' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }
function loadPortfolio() {
  let p, raw;
  try { raw = fs.readFileSync(PORTFOLIO_FILE, 'utf8'); }
  catch (e) { if (e.code === 'ENOENT') p = {}; else throw e; } // missing = fresh start
  if (raw !== undefined) {
    try { p = JSON.parse(raw); }
    catch {
      // File exists but is corrupt: back it up rather than silently wiping the portfolio.
      try { fs.renameSync(PORTFOLIO_FILE, PORTFOLIO_FILE.replace(/\.json$/, '') + '.corrupt.' + Date.now() + '.json'); } catch {}
      throw new Error('portfolio.json was corrupt; backed up to a .corrupt.json file. Restart to begin fresh, or restore the backup.');
    }
  }
  // Migrate the legacy single-portfolio shape into one "Main" account.
  if (!Array.isArray(p.accounts)) {
    p.accounts = [{ id: 'main', name: 'Main', type: 'Brokerage',
      positions: Array.isArray(p.positions) ? p.positions : [],
      transactions: Array.isArray(p.transactions) ? p.transactions : [] }];
    delete p.positions; delete p.transactions; delete p.realizedPnl;
  }
  if (!Array.isArray(p.watchlist)) p.watchlist = [];
  if (!Array.isArray(p.alerts)) p.alerts = [];
  if (!p.accounts.length) p.accounts.push({ id: 'main', name: 'Main', type: 'Brokerage', positions: [], transactions: [] });
  for (const a of p.accounts) {
    if (!a.id) a.id = newAccountId();
    if (!a.name) a.name = 'Account';
    if (!Array.isArray(a.positions)) a.positions = [];
    if (!Array.isArray(a.transactions)) a.transactions = [];
    if (!Array.isArray(a.dividends)) a.dividends = []; // [{symbol, date, amount, currency}]
    // Lot migration: coerce q/px to numbers, then derive quantity/avgCost from lots
    // so a hand-edited file can't leave avgCost undefined/NaN and poison P&L.
    for (const pos of a.positions) {
      if (!Array.isArray(pos.lots) || !pos.lots.length) {
        pos.lots = [{ q: Number(pos.quantity) || 0, px: Number(pos.avgCost) || 0, fxUsd: null, t: null }];
      }
      recalcPosition(pos);
    }
  }
  if (!p.activeId || !p.accounts.find((a) => a.id === p.activeId)) p.activeId = p.accounts[0].id;
  return p;
}
function recalcPosition(pos) {
  pos.quantity = pos.lots.reduce((s, l) => s + (Number.isFinite(l.q) ? l.q : 0), 0);
  const costNative = pos.lots.reduce((s, l) => s + (Number.isFinite(l.q) ? l.q : 0) * (Number.isFinite(l.px) ? l.px : 0), 0);
  pos.avgCost = pos.quantity ? costNative / pos.quantity : 0;
}
function savePortfolio(p) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  // Write to a temp file then atomically rename, so a crash mid-write can't truncate the live file.
  const tmp = PORTFOLIO_FILE + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, JSON.stringify(p, null, 2));
  fs.renameSync(tmp, PORTFOLIO_FILE);
  return p;
}
function findPos(acc, symbol) {
  return acc.positions.find((x) => x.symbol.toUpperCase() === symbol.toUpperCase());
}
// Resolve a writable account (rejects the read-only "ALL" view and bad ids).
function resolveAccount(p, accountId) {
  const id = accountId || p.activeId;
  if (id === 'ALL') throw new Error('Pick a specific account first (not "All Accounts")');
  const a = p.accounts.find((x) => x.id === id);
  if (!a) throw new Error('Unknown account');
  return a;
}
// Positions/transactions for a view (one account, or "ALL" = merged across accounts).
function viewPositions(p, accountId) {
  const id = accountId || p.activeId;
  if (id === 'ALL') {
    const map = new Map();
    for (const a of p.accounts) for (const pos of a.positions) {
      const k = pos.symbol.toUpperCase();
      if (!map.has(k)) map.set(k, { symbol: pos.symbol, name: pos.name, currency: pos.currency, lots: [] });
      const m = map.get(k); m.lots.push(...pos.lots); if (pos.name) m.name = pos.name;
    }
    const list = [...map.values()]; list.forEach(recalcPosition); return list;
  }
  const a = p.accounts.find((x) => x.id === id) || p.accounts[0];
  return a ? a.positions : [];
}
function viewTransactions(p, accountId) {
  const id = accountId || p.activeId;
  if (id === 'ALL') return p.accounts.flatMap((a) => a.transactions);
  const a = p.accounts.find((x) => x.id === id) || p.accounts[0];
  return a ? a.transactions : [];
}
function viewDividends(p, accountId) {
  const id = accountId || p.activeId;
  if (id === 'ALL') return p.accounts.flatMap((a) => a.dividends || []);
  const a = p.accounts.find((x) => x.id === id) || p.accounts[0];
  return a ? (a.dividends || []) : [];
}

// Serialize every portfolio read-modify-write (buy/sell/del/watch/alert/import/
// reset and the background alert timer) onto one promise chain so concurrent
// saves can't clobber each other. NOTE: locked functions must never call another
// locked function (buy/importCsv use buyUnlocked) or they'd deadlock the chain.
let _lock = Promise.resolve();
function withLock(fn) { const r = _lock.then(fn, fn); _lock = r.catch(() => {}); return r; }

module.exports = {
  newAccountId, loadPortfolio, recalcPosition, savePortfolio, findPos, resolveAccount,
  viewPositions, viewTransactions, viewDividends, withLock,
};
