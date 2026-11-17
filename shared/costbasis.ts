// FEAT-015 §3 cost-basis review: shapes shared by lib/costbasis.ts and the panel.
export type CostFlag = 'bulk-date' | 'zero-cost' | 'unquoted' | 'out-of-range' | 'marked-placeholder' | 'stale-confirmation';
export type MarkStatus = 'confirmed' | 'placeholder';
export interface CostMark { status: MarkStatus; note?: string; avgCostAtMark: number; at: number }
export interface LotCheck { t: number | null; px: number; weekLow: number | null; weekHigh: number | null; inRange: boolean | null }
export interface CostReviewRow {
  accountId: string; account: string; symbol: string; currency: string;
  quantity: number; avgCost: number; lots: number;
  flags: { flag: CostFlag; reason: string }[];
  mark: CostMark | null;
  /** Present only after a price-range check was requested. */
  lotChecks?: LotCheck[];
  editable: boolean; editBlock?: string;
}
export interface CostReview {
  asOf: number; checked: boolean;
  rows: CostReviewRow[]; // flagged first
  counts: { positions: number; flagged: number; confirmed: number; placeholder: number };
  notes: string[];
}
