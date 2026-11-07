// After-cost returns (FEAT-015 §1): splits the money made into price, FX,
// realized, dividends and withholding tax, all in base currency, and shows fund
// expense ratios as an estimated annual cost. Every figure is computed here from
// FinSight's own records; what the records cannot show (broker fees) is reported
// as unknown rather than estimated.
import { portfolioWithQuotes } from './portfolio.ts';
import { dividendsReport } from './dividends.ts';
import { portfolioPerformance } from './performance.ts';
import { getCategories, getFundProfile } from './market.ts';
import type { CostReport, CostRow, CostTotals } from '../shared/costs.ts';
export type { CostReport, CostRow, CostTotals };

const FUND_TYPES = new Set(['ETF', 'MUTUALFUND', 'FUND']);

export interface CostInput {
  base: string; account: string; asOf: number;
  positions: { symbol: string; marketValue: number; stockPnl: number; fxPnl: number; quoted: boolean }[];
  realized: { price: number; fx: number; legacy: number };
  dividends: { symbol: string; gross: number; tax: number; net: number }[];
  funds: Record<string, { expenseRatioPct: number | null }>; // symbols known to be funds
  returns: CostReport['returns'];
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Pure: the decomposition. */
export function summarize(i: CostInput): CostReport {
  const bySym = new Map<string, CostRow>();
  const row = (symbol: string): CostRow => {
    const k = symbol.toUpperCase();
    let r = bySym.get(k);
    if (!r) bySym.set(k, r = { symbol: k, held: false, marketValue: 0, pricePnl: 0, fxPnl: 0, divGross: 0, divTax: 0, divNet: 0, netGain: 0, isFund: false, expenseRatioPct: null, annualFundFee: null });
    return r;
  };
  for (const p of i.positions) {
    const r = row(p.symbol);
    r.held = true; r.marketValue += n(p.marketValue); r.pricePnl += n(p.stockPnl); r.fxPnl += n(p.fxPnl);
  }
  for (const d of i.dividends) { const r = row(d.symbol); r.divGross += n(d.gross); r.divTax += n(d.tax); r.divNet += n(d.net); }
  const fundsWithoutRatio: string[] = [];
  for (const r of bySym.values()) {
    r.netGain = r.pricePnl + r.fxPnl + r.divNet;
    const f = i.funds[r.symbol];
    if (f) {
      r.isFund = true; r.expenseRatioPct = f.expenseRatioPct;
      if (f.expenseRatioPct != null) r.annualFundFee = r.marketValue * f.expenseRatioPct / 100;
      else if (r.held) fundsWithoutRatio.push(r.symbol);
    }
  }
  const rows = [...bySym.values()].sort((a, b) => b.marketValue - a.marketValue || b.divGross - a.divGross);
  const sum = (f: (r: CostRow) => number) => rows.reduce((s, r) => s + f(r), 0);
  const book = sum((r) => r.marketValue);
  const t: CostTotals = {
    unrealizedPrice: sum((r) => r.pricePnl), unrealizedFx: sum((r) => r.fxPnl),
    realizedPrice: n(i.realized.price), realizedFx: n(i.realized.fx), realizedLegacy: n(i.realized.legacy),
    divGross: sum((r) => r.divGross), withholding: sum((r) => r.divTax), divNet: sum((r) => r.divNet),
    fees: null, netGain: 0, withholdingPctOfGross: null,
    annualFundFees: sum((r) => r.annualFundFee ?? 0), fundFeePctOfBook: null,
  };
  t.netGain = t.unrealizedPrice + t.unrealizedFx + t.realizedPrice + t.realizedFx + t.realizedLegacy + t.divNet;
  t.withholdingPctOfGross = t.divGross > 0 ? (t.withholding / t.divGross) * 100 : null;
  t.fundFeePctOfBook = book > 0 ? (t.annualFundFees / book) * 100 : null;

  const notes = [
    'Broker fees and commissions are not recorded in FinSight\'s ledger, so they are shown as unknown. If your imported average costs include commissions, those fees are already inside the price P&L.',
    'Fund expense ratios are already deducted inside each fund\'s price, so the annual fund fee is shown for visibility and is not subtracted again.',
    'Withholding uses the tax recorded on each dividend where the import has it, otherwise your per-market withholding settings.',
  ];
  if (i.returns) notes.push('The time-weighted and money-weighted returns come from the Performance panel and count dividends before withholding tax.');
  if (fundsWithoutRatio.length) notes.push(`No expense ratio was found for ${fundsWithoutRatio.join(', ')}; the fund fee total leaves them out.`);
  if (i.positions.some((p) => !p.quoted)) notes.push('Unquoted holdings are valued at their stored price, so their price P&L is whatever that stored price implies.');
  return { base: i.base, account: i.account, asOf: i.asOf, rows, totals: t, returns: i.returns, fundsWithoutRatio, notes };
}

/** Gather the inputs from FinSight's existing reports, then summarize. */
export async function costsReport(baseIn: string | null | undefined, accountId: string | undefined, range = 'max'): Promise<CostReport> {
  const pf = await portfolioWithQuotes(baseIn, accountId);
  const [divs, perf, cats] = await Promise.all([
    dividendsReport(pf.base, accountId),
    portfolioPerformance(range, pf.base, accountId, 'none').catch(() => null),
    pf.positions.length ? getCategories(pf.positions.map((p) => p.symbol)).catch(() => ({})) : Promise.resolve({}),
  ]);
  const funds: CostInput['funds'] = {};
  await Promise.all(pf.positions.map(async (p) => {
    const c = (cats as Record<string, { type?: string | null }>)[p.symbol.toUpperCase()];
    if (!c?.type || !FUND_TYPES.has(c.type.toUpperCase())) return;
    let ratio: number | null = null;
    try { ratio = (await getFundProfile(p.symbol)).expenseRatioPct ?? null; } catch { /* unknown */ }
    funds[p.symbol.toUpperCase()] = { expenseRatioPct: ratio };
  }));
  const s = pf.summary;
  const pr = perf as { twr?: number | null; mwr?: number | null; spanDays?: number } | null;
  return summarize({
    base: pf.base, account: pf.account, asOf: Date.now(),
    positions: pf.positions,
    // summary.realizedLegacy is a COUNT of legacy sales; their money is the remainder of realizedPnl.
    realized: { price: s.realizedStockPnl, fx: s.realizedFxPnl, legacy: s.realizedPnl - s.realizedStockPnl - s.realizedFxPnl },
    dividends: divs.bySymbol,
    funds,
    returns: pr && pr.twr != null ? { twrPct: pr.twr, mwrPct: pr.mwr ?? null, spanDays: pr.spanDays ?? null, range } : null,
  });
}
