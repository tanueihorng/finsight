import type { FxRisk, Portfolio, Position, Summary } from '../../../../shared/types.ts';
import { fmt, money, moneyBig, moneySigned, signStr } from '../../ui/format.ts';

// Ported 1:1 from legacy app.js CARD_DEFS / cardPrefs (baseline 31437a0).
export interface CardView { value: string; sub: string; signVal?: number | null }
export interface CardInput { s: Summary; base: string; positions: Position[]; cash: Portfolio['cash']; fxRisk: FxRisk | null }
interface CardDef { label: string; render(i: CardInput): CardView }

const best = (ps: Position[], dir: 1 | -1) => ps.filter((p) => p.changePct != null).sort((a, b) => dir * ((b.changePct ?? 0) - (a.changePct ?? 0)))[0];

export const CARD_DEFS: Record<string, CardDef> = {
  total_value: { label: 'TOTAL VALUE', render: ({ s, base }) => ({ value: money(base, s.totalValue), sub: 'invested · cost ' + moneyBig(base, s.totalCost) }) },
  net_worth: { label: 'NET WORTH', render: ({ s, base }) => ({ value: money(base, s.netWorth ?? s.totalValue), sub: s.cashBase ? 'incl. cash ' + moneyBig(base, s.cashBase) : 'holdings (no cash set)' }) },
  cash: { label: 'CASH', render: ({ s, base, cash }) => ({ value: moneyBig(base, s.cashBase || 0), sub: cash.length ? cash.map((c) => c.ccy).join(' · ') : 'CASH USD 5000 to set' }) },
  day_pnl: { label: 'DAY P&L', render: ({ s, base }) => ({ value: moneySigned(base, s.dayPnl), sub: 'today', signVal: s.dayPnl }) },
  unrealized: { label: 'UNREALIZED P&L', render: ({ s, base }) => ({ value: moneySigned(base, s.totalUnrealized), sub: signStr(s.totalUnrealizedPct) + '%', signVal: s.totalUnrealized }) },
  stock_pnl: { label: 'STOCK P&L', render: ({ s, base }) => ({ value: moneySigned(base, s.totalStockPnl), sub: 'price move', signVal: s.totalStockPnl }) },
  fx_pnl: { label: 'FX P&L', render: ({ s, base }) => ({ value: moneySigned(base, s.totalFxPnl), sub: 'currency move', signVal: s.totalFxPnl }) },
  fx_exposure: { label: 'FX EXPOSURE', render: ({ base, fxRisk: r }) => {
    if (!r || !r.exposures || !r.exposures.length) return { value: '—', sub: 'foreign currency' };
    const pct = r.totalValue ? (r.foreignBase / r.totalValue) * 100 : 0;
    return { value: moneyBig(base, r.foreignBase), sub: fmt(pct, 0) + '% in ' + r.exposures.map((e) => e.ccy).join('/') };
  } },
  realized: { label: 'REALIZED P&L', render: ({ s, base }) => ({ value: moneySigned(base, s.realizedPnl), sub: 'lifetime', signVal: s.realizedPnl }) },
  realized_fx: { label: 'REALIZED FX', render: ({ s, base }) => ({ value: moneySigned(base, s.realizedFxPnl || 0), sub: 'closed · currency', signVal: s.realizedFxPnl || 0 }) },
  cost_basis: { label: 'COST BASIS', render: ({ s, base }) => ({ value: moneyBig(base, s.totalCost), sub: base }) },
  day_pct: { label: 'DAY %', render: ({ s }) => { const pct = s.dayPct ?? 0; return { value: signStr(pct) + '%', sub: 'today', signVal: pct }; } },
  positions: { label: 'POSITIONS', render: ({ positions }) => ({ value: String(positions.length), sub: 'holdings' }) },
  best: { label: 'BEST TODAY', render: ({ positions }) => { const x = best(positions, 1); return x ? { value: x.symbol, sub: signStr(x.changePct) + '%', signVal: x.changePct } : { value: '—', sub: '' }; } },
  worst: { label: 'WORST TODAY', render: ({ positions }) => { const x = best(positions, -1); return x ? { value: x.symbol, sub: signStr(x.changePct) + '%', signVal: x.changePct } : { value: '—', sub: '' }; } },
};
export const ALL_CARDS = Object.keys(CARD_DEFS);
export const DEFAULT_CARDS = ['net_worth', 'total_value', 'day_pnl', 'unrealized', 'stock_pnl', 'fx_pnl', 'fx_exposure', 'realized'];
export const DEFAULT_ORDER = [...DEFAULT_CARDS, ...ALL_CARDS.filter((id) => !DEFAULT_CARDS.includes(id))];
export const CASH_CARDS = new Set(['net_worth', 'cash']); // clicking these opens the cash editor

export interface CardPrefs { order: string[]; enabled: string[]; nwFirst?: boolean }
// nwFirst: true — intended fix (PILOT-2): legacy saved defaults without it, so
// the one-time NET-WORTH-first upgrade re-ran after the first reload and undid
// a reorder of NET WORTH.
export const defaultPrefs = (): CardPrefs => ({ order: [...DEFAULT_ORDER], enabled: [...DEFAULT_CARDS], nwFirst: true });

// Parse the saved 'finsight-cards' value exactly as legacy did. `migrated` is
// true when the one-time NET WORTH-first upgrade ran and must be saved back.
export function parsePrefs(raw: string | null): { prefs: CardPrefs; migrated: boolean } {
  try {
    const p = JSON.parse(raw ?? 'null') as CardPrefs | null;
    if (p && Array.isArray(p.order) && Array.isArray(p.enabled)) {
      ALL_CARDS.forEach((id) => { if (!p.order.includes(id)) p.order.push(id); });
      p.order = p.order.filter((id) => CARD_DEFS[id]);
      p.enabled = p.enabled.filter((id) => CARD_DEFS[id]);
      if (!p.enabled.length) p.enabled = [...DEFAULT_CARDS]; // never render an empty summary
      let migrated = false;
      if (!p.nwFirst) {
        p.nwFirst = true; migrated = true;
        p.order = ['net_worth', ...p.order.filter((id) => id !== 'net_worth')];
        if (!p.enabled.includes('net_worth')) p.enabled.unshift('net_worth');
      }
      return { prefs: p, migrated };
    }
  } catch { /* fall through to defaults */ }
  return { prefs: defaultPrefs(), migrated: false };
}

export const visibleCards = (p: CardPrefs) => p.order.filter((id) => p.enabled.includes(id));
export function toggleCard(p: CardPrefs, id: string, on: boolean): CardPrefs {
  const enabled = on ? (p.enabled.includes(id) ? p.enabled : [...p.enabled, id]) : p.enabled.filter((x) => x !== id);
  return { ...p, enabled };
}
export function moveCard(p: CardPrefs, id: string, dir: 'up' | 'down'): CardPrefs {
  const i = p.order.indexOf(id), j = dir === 'up' ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= p.order.length) return p;
  const order = [...p.order]; [order[i], order[j]] = [order[j]!, order[i]!];
  return { ...p, order };
}
