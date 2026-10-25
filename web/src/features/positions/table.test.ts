import test from 'node:test';
import assert from 'node:assert/strict';
import { assetClass, defaultPosView, filterChips, parsePosView, priceFlashes, splitByAccount, tableModel, toggleCollapsed, toggleSort, type Categories } from './table.ts';
import type { Position } from '../../../../shared/types.ts';

const pos = (symbol: string, marketValue: number, extra: Partial<Position> = {}) => ({
  symbol, name: symbol + ' Inc', currency: 'USD', quantity: 10, avgCost: 1, fxRate: 1, last: marketValue / 10, change: 0, changePct: 0,
  marketValue, cost: marketValue / 2, costAtNow: 0, unrealized: marketValue / 2, unrealizedPct: 100, stockPnl: 0, fxPnl: 1, dayChange: 2,
  quoted: true, weight: 0, ...extra,
}) as Position;
const cats: Categories = { A: { symbol: 'A', type: 'EQUITY', sector: 'Tech', category: 'Tech' }, E: { symbol: 'E', type: 'ETF', sector: null, category: 'ETF / Fund' } };
const positions = [pos('A', 300), pos('E', 100), pos('M', 100)];

test('asset classes and filter chips match legacy', () => {
  assert.equal(assetClass(cats, 'A'), 'Stocks');
  assert.equal(assetClass(cats, 'E'), 'ETFs');
  assert.equal(assetClass(cats, 'M'), 'Funds & Other'); // no category (manual holding)
  assert.deepEqual(filterChips(defaultPosView(), cats, positions).map((c) => c.label + ' ' + c.pct),
    ['ALL null', 'STOCKS 60%', 'ETFS 20%', 'FUNDS & OTHER 20%']);
  // an active filter keeps its chip even when nothing is left in that class
  assert.deepEqual(filterChips({ ...defaultPosView(), filter: 'Crypto' }, cats, positions).map((c) => c.id), ['ALL', 'Stocks', 'ETFs', 'Crypto', 'Funds & Other']);
});

test('filter, search, scope and sort', () => {
  const v = { ...defaultPosView(), filter: 'Stocks' };
  const m = tableModel(v, cats, positions, 'Main');
  assert.equal(m.body.kind, 'rows');
  assert.deepEqual(m.scope && [m.scope.shown, m.scope.of, m.scope.pctOfInvested], [1, 3, 60]);
  assert.equal(tableModel({ ...defaultPosView(), q: 'zz' }, cats, positions, 'Main').body.kind, 'nomatch');
  assert.equal(tableModel(defaultPosView(), cats, [], 'Main').body.kind, 'empty');
  assert.equal(tableModel(defaultPosView(), cats, positions, 'Main').scope, null);
  const bySym = tableModel(toggleSort(defaultPosView(), 'symbol'), cats, positions, 'Main').body;
  assert.deepEqual(bySym.kind === 'rows' && bySym.rows.map((r) => r.symbol), ['A', 'E', 'M']);
  assert.deepEqual(toggleSort(toggleSort(defaultPosView(), 'symbol'), 'symbol').sortDir, -1);
  assert.deepEqual(toggleSort(defaultPosView(), 'marketValue').sortDir, 1);
  assert.deepEqual(toggleSort(defaultPosView(), 'last').sortDir, -1);
});

test('groups sort by value, collapse by group:key, and split by account', () => {
  const v = { ...defaultPosView(), group: 'class' as const };
  const m = tableModel(toggleCollapsed(v, 'ETFs'), cats, positions, 'Main');
  assert.ok(m.body.kind === 'groups');
  assert.deepEqual(m.body.groups.map((g) => [g.key, g.open, g.sums.marketValue]), [['Stocks', true, 300], ['ETFs', false, 100], ['Funds & Other', true, 100]]);
  assert.deepEqual(toggleCollapsed(toggleCollapsed(v, 'ETFs'), 'ETFs').collapsed, []);

  const two = pos('A', 300, { quantity: 30, avgCost: 2, cost: 60, holdings: [
    { accountId: 'a', account: 'Main', quantity: 20, avgCost: 1 }, { accountId: 'b', account: 'IBKR', quantity: 10, avgCost: 4 }] });
  const [main, ibkr] = splitByAccount(two, 'x');
  assert.deepEqual([main!.account, main!.marketValue, main!.cost, ibkr!.account, ibkr!.marketValue, ibkr!.cost], ['Main', 200, 20, 'IBKR', 100, 40]);
  assert.deepEqual(splitByAccount(pos('M', 1), 'Main').map((r) => r.account), ['Main']);
});

test('saved view parses like legacy and flashes compare with the last price', () => {
  assert.deepEqual(parsePosView('{bad'), defaultPosView());
  assert.deepEqual(parsePosView(JSON.stringify({ group: 'sector' })), { ...defaultPosView(), group: 'sector' });
  assert.deepEqual(priceFlashes({ A: 30, E: 10 }, positions), { A: '', E: '', M: '' });
  assert.deepEqual(priceFlashes({ A: 20, E: 11 }, positions), { A: 'flash-up', E: 'flash-down', M: '' });
});
