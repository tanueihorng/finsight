// FEAT-009: one view model for every council surface (cards, chain, compact,
// capsule). Built only from public run summaries — status, phase, timing and the
// validated Assessment — never model scratch reasoning. UNPEEK blanks all
// finding text and counts.
import { Assessment } from '../../../../agent/src/chat/council-contract.ts';
import { createStore } from 'zustand/vanilla';
import type { Part } from './turns.ts';

export type CouncilPart = Extract<Part, { kind: 'council' }>;
export type Finding = Assessment['findings'][number];
export const ROLES = [
  { id: 'growth', label: 'Business & Growth', short: 'Business', focus: 'Quality & growth', tag: 'G' },
  { id: 'macro', label: 'Macro & Valuation', short: 'Macro', focus: 'Value & economic forces', tag: 'M' },
  { id: 'risk', label: 'Portfolio Risk', short: 'Risk', focus: 'Exposure & downside', tag: 'R' },
] as const;
export const STAGES = ['Assess', 'Challenge', 'Synthesize'] as const;
// 3 assessments + 3 challenges + 1 synthesis.
const EXPECTED_RUNS = 7;

export type RunState = 'running' | 'completed' | 'failed' | 'stopped' | 'queued' | 'not-run';
export function councilState(runs: CouncilPart[], finished: boolean): RunState {
  if (runs.some((r) => r.status === 'running')) return 'running';
  if (runs.some((r) => r.status === 'failed')) return 'failed';
  if (runs.some((r) => r.status === 'stopped')) return 'stopped';
  if (runs.length && runs.every((r) => r.status === 'completed')) return 'completed';
  return finished ? 'not-run' : 'queued';
}
export const STATE_LABEL: Record<RunState, string> = { running: 'Working', completed: 'Ready', failed: 'Failed', stopped: 'Stopped', queued: 'Queued', 'not-run': 'Not run' };

export function parseAssessment(raw: string): Assessment | null {
  try { const r = Assessment.safeParse(JSON.parse(raw)); return r.success ? r.data : null; } catch { return null; }
}

export interface Step {
  key: string; tag: string; kind: 'assess' | 'claim' | 'challenge' | 'gap';
  label: string; text: string; evidence: string[]; running: boolean;
}
export interface RoleView {
  id: string; label: string; short: string; focus: string; index: number;
  state: RunState; challenged: boolean; phaseNote: string;
  claim: string; evidence: number | null; against: number | null; uncertainty: string; invalidation: string;
  assumptions: string[]; counter: string[]; missing: string[]; challengeClaim: string;
  steps: Step[]; ms: number; runs: CouncilPart[];
}
export interface ChairView {
  state: RunState; lead: string; findings: Finding[]; missing: string[]; changes: string[]; questions: string[];
  evidence: string[]; waiting: string; runs: CouncilPart[];
}
export interface CouncilView {
  hidden: boolean; working: boolean; partial: boolean; incomplete: boolean; finished: boolean;
  stage: number; stageDone: [boolean, boolean, boolean]; title: string;
  roles: RoleView[]; chair: ChairView; cost: number | null; done: number; total: number; activeLabel: string;
}

const uniq = <T,>(xs: T[]) => [...new Set(xs)];
const STEP_LABEL = { assess: 'ASSESS', claim: 'CLAIM', challenge: 'CHALLENGE', gap: 'GAP' } as const;
function step(key: string, tag: string, kind: Step['kind'], text: string, evidence: string[] = [], running = false): Step {
  return { key, tag, kind, label: STEP_LABEL[kind], text, evidence, running };
}

function roleView(role: (typeof ROLES)[number], index: number, all: CouncilPart[], finished: boolean, peek: boolean): RoleView {
  const runs = all.filter((r) => r.role === role.id);
  const state = councilState(runs, finished);
  const challenged = runs.some((r) => r.phase === 'challenge');
  const done = runs.filter((r) => r.status === 'completed');
  const assessed = done.filter((r) => r.phase === 'assessment').map((r) => parseAssessment(r.detail)).find(Boolean) ?? null;
  const challenge = done.filter((r) => r.phase === 'challenge').map((r) => parseAssessment(r.detail)).find(Boolean) ?? null;
  const latest = challenge?.findings.length ? challenge : assessed;
  const first = (assessed?.findings[0] ?? latest?.findings[0]) || null;
  const findings = [...(assessed?.findings ?? []), ...(challenge?.findings ?? [])];
  const steps: Step[] = [];
  let n = 0;
  for (const r of runs) {
    const tag = () => role.tag + ++n;
    if (r.status === 'running') steps.push(step(r.key, '', r.phase === 'challenge' ? 'challenge' : 'assess', r.phase === 'challenge' ? 'Testing the other assessments' : 'Forming an independent assessment', [], true));
    else if (r.status === 'completed') {
      const a = parseAssessment(r.detail);
      if (!peek) steps.push(step(r.key, '', r.phase === 'challenge' ? 'challenge' : 'claim', 'Findings hidden'));
      else for (const [i, f] of (a?.findings ?? []).entries()) steps.push(step(`${r.key}:${i}`, tag(), r.phase === 'challenge' ? 'challenge' : 'claim', f.claim, f.evidenceIds));
    } else steps.push(step(r.key, '', 'gap', r.status === 'stopped' ? 'Review interrupted' : peek && r.detail ? r.detail : 'Assessment missing'));
  }
  const phaseNote = state === 'running' ? (challenged ? 'Testing the other assessments' : 'Forming an independent assessment')
    : state === 'completed' ? (challenged ? 'Assessed · challenged' : 'Assessed')
    : state === 'failed' ? 'Assessment missing' : state === 'stopped' ? 'Review interrupted' : state === 'queued' ? 'Waiting for a research slot' : 'Did not run';
  return {
    id: role.id, label: role.label, short: role.short, focus: role.focus, index, state, challenged, phaseNote,
    claim: peek ? first?.claim ?? '' : '',
    evidence: peek && findings.length ? uniq(findings.flatMap((f) => f.evidenceIds)).length : null,
    against: peek && findings.length ? findings.reduce((s, f) => s + f.counterevidence.length, 0) : null,
    uncertainty: peek ? first?.uncertainty ?? '' : '',
    invalidation: peek ? first?.invalidation ?? '' : '',
    assumptions: peek ? uniq(findings.flatMap((f) => f.assumptions)) : [],
    counter: peek ? uniq(findings.flatMap((f) => f.counterevidence)) : [],
    missing: peek ? uniq(findings.flatMap((f) => f.missingEvidence)) : [],
    challengeClaim: peek ? challenge?.findings[0]?.claim ?? '' : '',
    steps, ms: runs.reduce((s, r) => s + (r.ms || 0), 0), runs,
  };
}

export function councilModel(runs: CouncilPart[], finished: boolean, peek: boolean): CouncilView {
  const roles = ROLES.map((r, i) => roleView(r, i, runs, finished, peek));
  const chairRuns = runs.filter((r) => r.role === 'chair');
  const chairState = councilState(chairRuns, finished);
  const synthesis = [...chairRuns].reverse().filter((r) => r.status === 'completed').map((r) => parseAssessment(r.detail)).find(Boolean) ?? null;
  const findings = peek ? synthesis?.findings ?? [] : [];
  const running = roles.filter((r) => r.state === 'running');
  const waiting = chairState === 'running' ? 'Weighing the evidence and unresolved views'
    : chairState === 'completed' ? 'Synthesis ready · evidence over votes'
    : running.length ? `Waiting for ${running.map((r) => r.label).join(', ')}`
    : finished ? 'Synthesis did not run' : 'Receives all assessments and challenges';
  const stageDone: [boolean, boolean, boolean] = [
    ROLES.every((role) => runs.some((r) => r.role === role.id && r.phase === 'assessment' && r.status === 'completed')),
    ROLES.every((role) => runs.some((r) => r.role === role.id && r.phase === 'challenge' && r.status === 'completed')),
    chairRuns.some((r) => r.status === 'completed'),
  ];
  const stage = chairRuns.length ? 2 : runs.some((r) => r.phase === 'challenge') ? 1 : 0;
  const working = runs.some((r) => r.status === 'running');
  const partial = runs.some((r) => r.status === 'failed' || r.status === 'stopped');
  const incomplete = partial || !stageDone[0] || !stageDone[1] || !stageDone[2];
  const cost = runs.length && runs.every((r) => r.costUsd !== null) ? runs.reduce((s, r) => s + r.costUsd!, 0) : null;
  const active = running.length ? running.map((r) => r.short).join(' · ') : chairState === 'running' ? 'Chair' : '';
  return {
    hidden: !peek, working, partial, incomplete, finished, stage, stageDone,
    title: finished ? (incomplete ? 'Review ended with gaps' : 'Review complete') : working ? 'Council in session' : 'Preparing the next stage',
    roles,
    chair: {
      state: chairState, lead: findings[0]?.claim ?? '', findings,
      missing: uniq(findings.flatMap((f) => f.missingEvidence)), changes: uniq(findings.map((f) => f.invalidation)),
      questions: peek ? synthesis?.unresolvedQuestions ?? [] : [], evidence: uniq(findings.flatMap((f) => f.evidenceIds)),
      waiting, runs: chairRuns,
    },
    cost, done: runs.filter((r) => r.status === 'completed').length, total: EXPECTED_RUNS,
    activeLabel: active ? `${STAGES[stage]} · ${active}` : STAGES[stage],
  };
}

// Cards or Chain of thought on the full page, saved per browser (FEAT-009 §6.4).
export type CouncilViewName = 'cards' | 'chain';
const VIEW_KEY = 'kestrel.councilView';
const readView = (): CouncilViewName => { try { return localStorage.getItem(VIEW_KEY) === 'chain' ? 'chain' : 'cards'; } catch { return 'cards'; } };
export const councilView = createStore<{ view: CouncilViewName }>()(() => ({ view: readView() }));
export function setCouncilView(view: CouncilViewName) {
  try { localStorage.setItem(VIEW_KEY, view); } catch { /* storage blocked */ }
  councilView.setState({ view });
}
