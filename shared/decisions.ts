// FEAT-017 §3 decision-log shapes, shared by lib/decisions.ts and the web panel.
export type DecisionTag = 'pending' | 'decided' | 'unknown';
export type ExecutionTag = 'none' | 'recorded' | 'unknown';
export interface DecisionEntry {
  id: string; date: string | null; title: string;
  decision: string | null; execution: string | null;
  decisionTag: DecisionTag; executionTag: ExecutionTag;
  /** A decision was recorded but no execution is confirmed. */
  decidedNotExecuted: boolean;
  body: string;
}
export interface DecisionReport {
  source: { file: string; found: boolean; modifiedAt: number | null };
  entries: DecisionEntry[]; // newest first
  counts: { total: number; pending: number; decided: number; decidedNotExecuted: number };
  issues: string[];
}
