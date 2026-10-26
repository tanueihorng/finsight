// Portfolio store safety (Phase 6 regression tranche): missing, corrupt and
// legacy files, lot migration, the write lock and the undo cap.
import { dataDir, reset } from './helpers.ts';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as store from '../lib/store.ts';

const FILE = path.join(dataDir, 'portfolio.json');
beforeEach(reset);

test('a missing store loads as a fresh book with one Main account and writes nothing', () => {
  const p = store.loadPortfolio();
  assert.deepEqual(p, {
    accounts: [{ id: 'main', name: 'Main', type: 'Brokerage', positions: [], transactions: [], dividends: [], cash: {} }],
    watchlist: [], alerts: [], settings: {}, activeId: 'main',
  });
  assert.equal(fs.existsSync(FILE), false);
});

test('a corrupt store is moved aside, never overwritten, and loading throws', () => {
  fs.writeFileSync(FILE, '{"accounts": [ truncated');
  assert.throws(() => store.loadPortfolio(), /portfolio\.json was corrupt; backed up to a \.corrupt\.json file/);
  assert.equal(fs.existsSync(FILE), false);
  const backups = fs.readdirSync(dataDir).filter((f) => /^portfolio\.corrupt\.\d+\.json$/.test(f));
  assert.equal(backups.length, 1);
  assert.equal(fs.readFileSync(path.join(dataDir, backups[0]!), 'utf8'), '{"accounts": [ truncated');
  // The next start is fresh.
  assert.equal(store.loadPortfolio().accounts[0]!.id, 'main');
});

test('the legacy single-portfolio file migrates into Main, keeping holdings and history', () => {
  fs.writeFileSync(FILE, JSON.stringify({
    positions: [{ symbol: 'AAPL', quantity: '10', avgCost: '150.5', currency: 'USD' }, { symbol: 'D05.SI', quantity: 3, avgCost: null }],
    transactions: [{ type: 'BUY', symbol: 'AAPL', quantity: 10, price: 150.5, time: 1700000000000 }, { type: 'BUY', symbol: 'D05.SI', quantity: 3, price: 0 }],
    realizedPnl: 12, watchlist: ['MSFT'],
  }));
  const p = store.loadPortfolio();
  assert.equal(p.accounts.length, 1);
  const a = p.accounts[0];
  assert.deepEqual([a!.id, a!.name, a!.type, p.activeId], ['main', 'Main', 'Brokerage', 'main']);
  assert.equal('positions' in p || 'transactions' in p || 'realizedPnl' in p, false);
  assert.deepEqual(p.watchlist, ['MSFT']);
  assert.deepEqual(a!.positions[0]!.lots, [{ q: 10, px: 150.5, fxUsd: null, t: null }]);
  assert.deepEqual([a!.positions[0]!.quantity, a!.positions[0]!.avgCost], [10, 150.5]);
  assert.deepEqual([a!.positions[1]!.quantity, a!.positions[1]!.avgCost], [3, 0]);
  assert.deepEqual(a!.transactions.map((t) => t.id), ['main-0-' + (1700000000000).toString(36), 'main-1-0']);
});

test('accounts get defaults; an unknown activeId falls back to the first account', () => {
  fs.writeFileSync(FILE, JSON.stringify({ accounts: [{ id: 'b1', positions: [{ symbol: 'X', lots: [{ q: 2, px: 5 }, { q: 'bad', px: 1 }] }] }, { name: 'Second' }], activeId: 'gone' }));
  const p = store.loadPortfolio();
  assert.equal(p.activeId, 'b1');
  assert.equal(p.accounts[0]!.name, 'Account');
  assert.match(p.accounts[1]!.id, /^acc[0-9a-z]+$/);
  assert.deepEqual([p.accounts[0]!.positions[0]!.quantity, p.accounts[0]!.positions[0]!.avgCost], [2, 5]);
  assert.deepEqual(p.accounts[1]!.cash, {});
});

test('saves are atomic, pretty-printed and private', () => {
  const p = store.loadPortfolio();
  store.savePortfolio(p);
  assert.equal(fs.readFileSync(FILE, 'utf8'), JSON.stringify(p, null, 2));
  assert.equal(fs.statSync(FILE).mode & 0o777, 0o600);
  assert.deepEqual(fs.readdirSync(dataDir).filter((f) => f.includes('.tmp.')), []);
});

test('the lock runs writes one at a time, in order, and survives a failing writer', async () => {
  const order: number[] = []; let active = 0, maxActive = 0;
  const job = (i: number, fail?: boolean) => store.withLock(async () => {
    active++; maxActive = Math.max(maxActive, active);
    await new Promise((r) => setTimeout(r, 5));
    order.push(i); active--;
    if (fail) throw new Error('boom ' + i);
    return i;
  });
  const results = await Promise.allSettled([job(1), job(2, true), job(3), job(4)]);
  assert.deepEqual(order, [1, 2, 3, 4]);
  assert.equal(maxActive, 1);
  assert.deepEqual(results.map((r) => r.status), ['fulfilled', 'rejected', 'fulfilled', 'fulfilled']);
});

test('undo keeps the last 25 changes, skips no-op writes and restores accounts only', async () => {
  const change = (i: number) => store.withLock(() => store.withUndo('change ' + i, () => {
    const p = store.loadPortfolio(); p.accounts[0]!.cash = { USD: i }; p.watchlist = ['W' + i]; store.savePortfolio(p);
  }));
  for (let i = 1; i <= 30; i++) await change(i);
  await store.withLock(() => store.withUndo('no-op', () => {}));
  const info = store.undoInfo();
  assert.equal(info.available, 25);
  assert.equal(info.last!.label, 'change 30');
  const u = await store.undo();
  assert.equal(u.undone, 'change 30'); assert.equal(u.available, 24);
  const p = store.loadPortfolio();
  assert.deepEqual(p.accounts[0]!.cash, { USD: 29 });
  assert.deepEqual(p.watchlist, ['W30'], 'watchlist is not part of the snapshot');
  for (let i = 0; i < 24; i++) await store.undo();
  assert.deepEqual(store.loadPortfolio().accounts[0]!.cash, { USD: 5 });
  await assert.rejects(store.undo(), /Nothing to undo/);
});

test('the first change on a fresh store is undoable back to an empty book', async () => {
  await store.withLock(() => store.withUndo('first', () => {
    const p = store.loadPortfolio(); p.accounts[0]!.cash = { SGD: 10 }; store.savePortfolio(p);
  }));
  await store.undo();
  const p = store.loadPortfolio();
  assert.deepEqual(p.accounts.map((a) => [a.id, a.cash]), [['main', {}]]);
});
