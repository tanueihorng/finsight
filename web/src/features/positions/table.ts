// Positions table logic (D1), ported 1:1 from public/app.js S14. No DOM here:
// the island renders what these return. assetClass/splitByAccount are also the
// shared versions C3 (allocation) imports; legacy keeps its own copy until C3.
import type { Category, Position } from '../../../../shared/types.ts';

export const ASSET_CLASSES = ['Stocks', 'ETFs', 'Crypto', 'Funds & Other'] as const;
export type Categories = Record<string, Category | undefined>;
export type Row = Position & { account?: string };
export type Group = 'none' | 'class' | 'account' | 'sector' | 'currency';
export type SortKey = 'symbol' | 'quantity' | 'avgCost' | 'last' | 'changePct' | 'marketValue' | 'unrealized' | 'unrealizedPct' | 'fxPnl' | 'weight';
export interface PosView { filter: string; group: Group; sortKey: SortKey; sortDir: 1 | -1; q: string; collapsed: string[] }

export const defaultPosView = (): PosView => ({ filter: 'ALL', group: 'none', sortKey: 'marketValue', sortDir: -1, q: '', collapsed: [] });
// Legacy merged whatever was saved over the defaults, without validation.
export function parsePosView(raw: string | null): PosView {
  try { return { ...defaultPosView(), ...JSON.parse(raw || '{}') }; } catch { return defaultPosView(); }
}

// Yahoo quoteType -> asset class. Unquoted manual holdings (e.g. a unit trust) land in Funds & Other.
export function assetClass(cats: Categories, sym: string): string {
  const t = cats[sym]?.type;
  if (t === 'CRYPTOCURRENCY') return 'Crypto';
  if (t === 'ETF') return 'ETFs';
  if (t === 'EQUITY') return 'Stocks';
  return 'Funds & Other';
}
// In the combined view a symbol held in several accounts is split into one row per
// account (value pro rata by quantity, cost by that account's own average cost).
export function splitByAccount(p: Position, accountName: string): Row[] {
  const hs = p.holdings;
  if (!hs || !hs.length) return [{ ...p, account: accountName }];
  if (hs.length === 1) return [{ ...p, account: hs[0]!.account }];
  const costNative = p.avgCost * p.quantity || 1;
  return hs.map((h) => {
    const qf = h.quantity / (p.quantity || 1), cf = (h.avgCost * h.quantity) / costNative;
    const marketValue = p.marketValue * qf, cost = p.cost * cf, unrealized = marketValue - cost;
    return { ...p, account: h.account, quantity: h.quantity, avgCost: h.avgCost, marketValue, cost, unrealized,
      unrealizedPct: cost ? unrealized / cost * 100 : 0, fxPnl: p.fxPnl * cf, weight: p.weight * qf, dayChange: p.dayChange * qf };
  });
}
export function groupKey(view: PosView, cats: Categories, p: Row): string {
  switch (view.group) {
    case 'class': return assetClass(cats, p.symbol);
    case 'account': return p.account || 'Account';
    case 'sector': return cats[p.symbol]?.category || 'Other';
    case 'currency': return p.currency;
    default: return '';
  }
}
export function sortRows(view: PosView, rows: Row[]): Row[] {
  const k = view.sortKey, d = view.sortDir;
  return [...rows].sort((a, b) => {
    const x = a[k], y = b[k];
    if (k === 'symbol') return d * String(x).localeCompare(String(y));
    return d * ((x == null ? -Infinity : x as number) - (y == null ? -Infinity : y as number));
  });
}
export interface Sums { marketValue: number; cost: number; unrealized: number; fxPnl: number; weight: number; unrealizedPct: number }
export function sumRows(rows: Row[]): Sums {
  const s = { marketValue: 0, cost: 0, unrealized: 0, fxPnl: 0, weight: 0, unrealizedPct: 0 };
  rows.forEach((r) => { s.marketValue += r.marketValue; s.cost += r.cost; s.unrealized += r.unrealized; s.fxPnl += r.fxPnl || 0; s.weight += r.weight; });
  s.unrealizedPct = s.cost ? s.unrealized / s.cost * 100 : 0;
  return s;
}

export interface Chip { id: string; label: string; value: number; pct: string | null }
export function filterChips(view: PosView, cats: Categories, positions: Position[]): Chip[] {
  const total = positions.reduce((s, p) => s + p.marketValue, 0) || 1;
  const byCls: Record<string, number> = {};
  positions.forEach((p) => { const c = assetClass(cats, p.symbol); byCls[c] = (byCls[c] || 0) + p.marketValue; });
  return [{ id: 'ALL', label: 'ALL', value: total, pct: null },
    ...ASSET_CLASSES.filter((c) => byCls[c] || view.filter === c)
      .map((c) => ({ id: c, label: c.toUpperCase(), value: byCls[c] || 0, pct: ((byCls[c] || 0) / total * 100).toFixed(0) + '%' }))];
}

export interface TableModel {
  chips: Chip[];
  scope: { shown: number; of: number; sums: Sums; pctOfInvested: number } | null;
  body: { kind: 'empty' } | { kind: 'nomatch' } | { kind: 'rows'; rows: Row[] }
    | { kind: 'groups'; groups: { key: string; open: boolean; rows: Row[]; sums: Sums }[] };
}
export function tableModel(view: PosView, cats: Categories, positions: Position[], accountName: string): TableModel {
  if (!positions.length) return { chips: [], scope: null, body: { kind: 'empty' } };
  const chips = filterChips(view, cats, positions);
  const q = view.q.trim().toUpperCase();
  let rows: Row[] = positions.filter((p) => (view.filter === 'ALL' || assetClass(cats, p.symbol) === view.filter)
    && (!q || p.symbol.toUpperCase().includes(q) || String(p.name || '').toUpperCase().includes(q)));
  if (view.group === 'account') rows = rows.flatMap((p) => splitByAccount(p, accountName));
  let scope: TableModel['scope'] = null;
  if (view.filter !== 'ALL' || q) {
    const sums = sumRows(rows), all = positions.reduce((t, p) => t + p.marketValue, 0) || 1;
    scope = { shown: new Set(rows.map((r) => r.symbol)).size, of: positions.length, sums, pctOfInvested: sums.marketValue / all * 100 };
  }
  if (!rows.length) return { chips, scope, body: { kind: 'nomatch' } };
  if (view.group === 'none') return { chips, scope, body: { kind: 'rows', rows: sortRows(view, rows) } };
  const groups: Record<string, Row[]> = {};
  rows.forEach((r) => { const k = groupKey(view, cats, r); (groups[k] || (groups[k] = [])).push(r); });
  return { chips, scope, body: { kind: 'groups', groups: Object.entries(groups)
    .map(([key, rs]) => ({ key, rows: sortRows(view, rs), sums: sumRows(rs), open: !view.collapsed.includes(view.group + ':' + key) }))
    .sort((a, b) => b.sums.marketValue - a.sums.marketValue) } };
}

// Clicking a column: same column flips direction; a new column starts
// descending, except SYMBOL, which starts A→Z.
export function toggleSort(view: PosView, k: SortKey): PosView {
  return view.sortKey === k ? { ...view, sortDir: view.sortDir > 0 ? -1 : 1 } : { ...view, sortKey: k, sortDir: k === 'symbol' ? 1 : -1 };
}
export function toggleCollapsed(view: PosView, key: string): PosView {
  const k = view.group + ':' + key;
  return { ...view, collapsed: view.collapsed.includes(k) ? view.collapsed.filter((c) => c !== k) : [...view.collapsed, k] };
}

// Row flash: compare each new price with the last one seen (store.lastPrices).
export function priceFlashes(prev: Record<string, number>, positions: Position[]): Record<string, '' | 'flash-up' | 'flash-down'> {
  return Object.fromEntries(positions.map((p) => {
    const was = prev[p.symbol];
    return [p.symbol, was == null || was === p.last ? '' : p.last > was ? 'flash-up' : 'flash-down'];
  }));
}
