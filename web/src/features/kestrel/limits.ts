import { createStore } from 'zustand/vanilla';

// Kestrel's spending and tool limits (GET/PATCH /api/agent/limits): the
// fields the dialog edits and the pure form logic, unit-tested without a DOM.
export interface LimitsResponse { limits: Record<string, number | undefined>; defaults: Record<string, number>; set: Record<string, number>; todayUsd: number }
export interface LimitField { key: string; label: string; help: string; usd?: boolean; int?: boolean; min: number; max: number; fallback?: string }
export const LIMIT_FIELDS: LimitField[] = [
  { key: 'dayUsd', label: 'Daily spend cap (US$)', help: 'All of Kestrel\'s model and paid search costs in a day. When reached, chat stops until tomorrow.', usd: true, min: 0.01, max: 1000 },
  { key: 'turnUsd', label: 'Per chat reply (US$)', help: 'Cost ceiling for one ordinary reply.', usd: true, min: 0.01, max: 100 },
  { key: 'councilTurnUsd', label: 'Per council review (US$)', help: 'Cost ceiling for one council run (three specialists and the chair).', usd: true, min: 0.01, max: 100, fallback: 'same as per reply' },
  { key: 'turnSteps', label: 'Steps per reply', help: 'Model and tool calls in one reply.', int: true, min: 1, max: 50 },
  { key: 'turnSeconds', label: 'Time per reply (seconds)', help: 'A reply stops with what it has found after this long.', int: true, min: 5, max: 900 },
  { key: 'searchesPerTurn', label: 'Web searches per reply', help: 'Paid searches count towards the cost ceilings too.', int: true, min: 0, max: 50 },
  { key: 'fetchesPerTurn', label: 'Pages read per reply', help: 'Web pages Kestrel opens and reads in one reply.', int: true, min: 0, max: 50 },
  { key: 'councilResearchCalls', label: 'Council research calls', help: 'Tool calls each council specialist may make while researching.', int: true, min: 1, max: 20 },
  { key: 'councilOutputTokens', label: 'Council answer length (tokens)', help: 'Longest answer each council member may write, up to the model\'s maximum.', int: true, min: 500, max: 64000, fallback: '2000' },
];

/** Form strings (empty = use the default) -> the PATCH body, or the first problem. */
export function limitsPatch(form: Record<string, string>, set: Record<string, number>): { body: Record<string, number | null> } | { error: string } {
  const body: Record<string, number | null> = {};
  for (const f of LIMIT_FIELDS) {
    const raw = (form[f.key] ?? '').trim();
    if (raw === '') { if (f.key in set) body[f.key] = null; continue; }
    const v = Number(raw);
    if (!Number.isFinite(v) || (f.int && !Number.isInteger(v))) return { error: `${f.label}: enter ${f.int ? 'a whole number' : 'a number'}` };
    if (v < f.min || v > f.max) return { error: `${f.label}: between ${f.min} and ${f.max}` };
    if (set[f.key] !== v) body[f.key] = v;
  }
  return { body };
}
export const limitsForm = (set: Record<string, number>) => Object.fromEntries(LIMIT_FIELDS.map((f) => [f.key, set[f.key] != null ? String(set[f.key]) : '']));
export const defaultText = (f: LimitField, defaults: Record<string, number>) => (defaults[f.key] != null ? (f.usd ? `US$${defaults[f.key]}` : String(defaults[f.key])) : f.fallback ?? '');

export type SettingsTab = 'usage' | 'limits';
export const limitsDialog = createStore<{ open: boolean; tab: SettingsTab }>()(() => ({ open: false, tab: 'limits' }));
export const openLimits = () => limitsDialog.setState({ open: true, tab: 'limits' });
export const openUsage = () => limitsDialog.setState({ open: true, tab: 'usage' });
