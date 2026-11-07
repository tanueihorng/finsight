// FEAT-014 thesis shapes, shared by lib/theses.ts and the web panel.
export const ROLES = ['core', 'tactical', 'unclassified'] as const;
export type Role = typeof ROLES[number];
export const TRIGGER_KINDS = ['business', 'valuation', 'portfolio-fit'] as const;
export type TriggerKind = typeof TRIGGER_KINDS[number];
export const VERDICTS = ['intact', 'weakened', 'broken', 'insufficient'] as const;
export type Verdict = typeof VERDICTS[number];
export const VERDICT_TEXT: Record<Verdict, string> = { intact: 'intact', weakened: 'weakened', broken: 'broken', insufficient: 'insufficient evidence' };

export interface Trigger { text: string; kind: TriggerKind; urgent: boolean }
export interface ThesisCheck { date: string; verdict: Verdict; note?: string }
export interface Thesis {
  symbol: string; role: Role;
  mechanism: string;
  valuation?: { low?: number; high?: number; currency?: string; note?: string };
  triggers: Trigger[];
  maxWeightPct?: number;
  reviewEveryDays: number;
  nextReview: string; // YYYY-MM-DD
  checks: ThesisCheck[]; // newest first
  createdAt: number; updatedAt: number;
}
export interface ThesisRow {
  symbol: string; held: boolean; weightPct: number | null; last: number | null; currency: string | null;
  thesis: Thesis | null;
  /** Days until next review; negative = overdue. Null without a thesis. */
  dueInDays: number | null;
  /** Price against the written valuation range, when both exist and currencies match. */
  vsValuation: 'below' | 'within' | 'above' | null;
  overMaxWeight: boolean;
}
export interface ThesisReport { asOf: number; today: string; rows: ThesisRow[]; counts: { held: number; withThesis: number; overdue: number; broken: number } }
