// FEAT-017 guardrail shapes, shared by lib/guardrails.ts and the web panel.
export const KINDS = {
  positionMax: { label: 'Largest single holding', unit: 'max % of net worth' },
  symbolMax: { label: 'Named holding', unit: 'max % of net worth' },
  currencyMax: { label: 'Any one foreign currency', unit: 'max % of net worth' },
  accountMax: { label: 'Any one account / broker', unit: 'max % of net worth' },
  cashMin: { label: 'Cash floor', unit: 'min % of net worth' },
  cashMax: { label: 'Cash ceiling', unit: 'max % of net worth' },
} as const;
export type Kind = keyof typeof KINDS;
export type LimitStatus = 'proposed' | 'accepted';
export interface Limit { kind: Kind; symbol?: string; pct: number; status: LimitStatus; note?: string; updatedAt: number }
export type CheckState = 'unset' | 'ok' | 'near' | 'breach' | 'no-data';
export interface Observation { key: string; value: number; pct: number }
export interface Check {
  kind: Kind; symbol?: string; label: string; unit: string;
  limit: { pct: number; status: LimitStatus; note?: string; updatedAt: number } | null;
  state: CheckState; worst: Observation | null; over: Observation[];
}
export interface GuardrailInput {
  base: string;
  positions: { symbol: string; currency: string; marketValue: number; quoted?: boolean }[];
  cash: { ccy: string; base: number }[];
  accounts: { id: string; name: string; netWorth: number }[];
}
export interface GuardrailReport {
  base: string; netWorth: number; asOf: number; checks: Check[];
  counts: { breach: number; near: number; ok: number; unset: number };
  notes: string[];
}

