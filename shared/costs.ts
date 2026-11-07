// FEAT-015 §1 after-cost returns: shapes shared by lib/costs.ts and the web panel.
// All amounts are in the report's base currency.
export interface CostRow {
  symbol: string; held: boolean; marketValue: number;
  pricePnl: number; fxPnl: number;            // unrealized, open position
  divGross: number; divTax: number; divNet: number; // recorded dividends, all time
  netGain: number;                             // pricePnl + fxPnl + divNet
  isFund: boolean; expenseRatioPct: number | null; annualFundFee: number | null;
}
export interface CostTotals {
  unrealizedPrice: number; unrealizedFx: number;
  realizedPrice: number; realizedFx: number; realizedLegacy: number;
  divGross: number; withholding: number; divNet: number;
  /** Broker fees and commissions: FinSight's ledger has no fee field, so this is not known. */
  fees: null;
  netGain: number;                             // all of the above after withholding
  withholdingPctOfGross: number | null;
  annualFundFees: number; fundFeePctOfBook: number | null;
}
export interface CostReport {
  base: string; account: string; asOf: number;
  rows: CostRow[]; totals: CostTotals;
  returns: { twrPct: number | null; mwrPct: number | null; spanDays: number | null; range: string } | null;
  fundsWithoutRatio: string[];
  notes: string[];
}
