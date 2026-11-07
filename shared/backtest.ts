// FEAT-015 §6 backtester and paper promotion: shapes shared by lib/backtest.ts and the panel.
export interface TradeStats {
  n: number; winRate: number | null; avgRetPct: number | null; expectancyR: number | null; compoundedPct: number | null;
}
export interface SymbolResult {
  symbol: string; bars: number; from: string | null; to: string | null; error?: string;
  all: TradeStats; inSample: TradeStats; outOfSample: TradeStats;
  timeInMarketPct: number | null; buyHoldPct: number | null; strategyPct: number | null;
}
export interface BacktestRun {
  strategy: { id: string; name: string; measure: 'R' | 'pct' }; range: string; runAt: number;
  universe: string[]; splitPct: number;
  symbols: SymbolResult[];
  total: { all: TradeStats; inSample: TradeStats; outOfSample: TradeStats; beatBuyHold: number; compared: number };
  gate: PaperGate;
  notes: string[];
}
export interface PaperGate { minTrades: number; minOutOfSample: number; passes: boolean; reasons: string[] }
export type OwnerStatus = 'backtested' | 'paper';
export interface PaperRecord {
  status: OwnerStatus; since: string; universe: string[]; range: string; note?: string; updatedAt: number;
  evidence: { runAt: number; n: number; outOfSampleN: number; avgRetPct: number | null; outOfSampleAvgRetPct: number | null; expectancyR: number | null };
}
export interface StrategyRow {
  id: string; name: string; summary: string; kind: string; measure: 'R' | 'pct' | null;
  /** Status recorded in the repository for the built-in library (generic, not yours). */
  libraryStatus: string | null;
  /** Your own status for it, from DATA_DIR. "accepted" is never set by FinSight. */
  owner: PaperRecord | null;
}
export interface PaperTrade { symbol: string; entryDate: string; exitDate: string | null; retPct: number | null; R: number | null; open: boolean }
export interface PaperTrack { id: string; since: string; trades: PaperTrade[]; stats: TradeStats; live: { symbol: string; stage: string }[] }
