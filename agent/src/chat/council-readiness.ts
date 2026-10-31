// Research readiness is separate from execution status (COUNCILQUALITY-001
// item 7). A turn can finish without errors while stages failed, evidence was
// missing or figures stayed unverified; this says which, from recorded facts.
import { stageIssues, type CouncilRun } from './council.ts';
import type { Coverage } from './council-evidence.ts';

export type ReadinessLevel = 'ready' | 'partial' | 'insufficient';
export type Readiness = {
  kind: 'readiness'; version: 1; level: ReadinessLevel;
  stages: { completed: number; failed: number; stopped: number; expected: number };
  evidence: Record<Coverage['status'], number>;
  unverifiedFigures: number; reasons: string[];
  // Each stage that did not complete and why, e.g. "Risk challenge: stopped by the spending cap".
  stageIssues?: string[]; budget?: { capUsd: number; capSource: string };
};
const EXPECTED_STAGES = 7;

export function councilReadiness(runs: CouncilRun[], coverage: Coverage[], budget?: { capUsd: number; capSource: string }): Readiness {
  const count = (s: CouncilRun['status']) => runs.filter((r) => r.status === s).length;
  const stages = { completed: count('completed'), failed: count('failed'), stopped: count('stopped'), expected: EXPECTED_STAGES };
  const evidence = { retrieved: 0, failed: 0, not_applicable: 0, unavailable: 0, skipped_limit: 0 } as Readiness['evidence'];
  for (const c of coverage) evidence[c.status]++;
  const unverifiedFigures = runs.reduce((s, r) => s + (r.metricIssues?.length ?? 0), 0);
  const chairDone = runs.some((r) => r.role === 'chair' && r.status === 'completed');
  const assessed = runs.filter((r) => r.phase === 'assessment' && r.status === 'completed').length;
  const reasons: string[] = [];
  const issues = stageIssues(runs);
  if (stages.completed < EXPECTED_STAGES) reasons.push(`${stages.completed} of ${EXPECTED_STAGES} stages completed` + (issues.length ? ` (${issues.join('; ')})` : ''));
  const capped = runs.some((r) => r.cause === 'budget');
  if (!chairDone) reasons.push('no chair synthesis');
  if (evidence.failed) reasons.push(`${evidence.failed} planned evidence item${evidence.failed === 1 ? '' : 's'} failed`);
  if (evidence.unavailable) reasons.push(`${evidence.unavailable} planned evidence item${evidence.unavailable === 1 ? '' : 's'} unavailable`);
  if (evidence.skipped_limit) reasons.push(`${evidence.skipped_limit} skipped by the research limit`);
  if (unverifiedFigures) reasons.push(`${unverifiedFigures} unverified figure check${unverifiedFigures === 1 ? '' : 's'}`);
  // Coverage and numeric checks do not verify whether qualitative conclusions
  // follow from their sources. Do not label the overall research ready until
  // that independent verification exists.
  reasons.push('qualitative claims have not been independently verified');
  const level: ReadinessLevel = !chairDone || assessed < 2 ? 'insufficient' : reasons.length ? 'partial' : 'ready';
  return { kind: 'readiness', version: 1, level, stages, evidence, unverifiedFigures, reasons, ...(issues.length ? { stageIssues: issues } : {}), ...(capped && budget ? { budget } : {}) };
}

export function readinessLine(r: Readiness): string {
  const e = r.evidence;
  const gaps = [e.failed && `${e.failed} failed`, e.unavailable && `${e.unavailable} unavailable`, e.not_applicable && `${e.not_applicable} not applicable`, e.skipped_limit && `${e.skipped_limit} skipped`].filter(Boolean).join(', ');
  return `Research readiness: ${r.level} · stages ${r.stages.completed}/${r.stages.expected} · evidence ${e.retrieved} retrieved${gaps ? ` (${gaps})` : ''}` + (r.unverifiedFigures ? ` · ${r.unverifiedFigures} unverified figure${r.unverifiedFigures === 1 ? '' : 's'}` : '') + (r.reasons.length ? `\nLimitations: ${r.reasons.join('; ')}.` : '') + (r.budget ? `\nSpending cap: US$${r.budget.capUsd.toFixed(2)} per Council turn from ${r.budget.capSource}.` : '');
}
