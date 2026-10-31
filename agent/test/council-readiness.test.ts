// Research readiness is reported apart from execution (COUNCILQUALITY-001 item 7).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { councilReadiness, readinessLine } from '../src/chat/council-readiness.ts';
import type { CouncilRun } from '../src/chat/council.ts';
import type { Coverage } from '../src/chat/council-evidence.ts';

const run = (role: string, phase: string, status: CouncilRun['status'], metricIssues?: string[]): CouncilRun => ({ id: role + phase, parentId: 'p', role, phase, status, costUsd: 0, ms: 1, model: 'm', version: 1, metricIssues });
const all = (failed: string[] = []) => [
  ...['growth', 'macro', 'risk'].map((r) => run(r, 'assessment', 'completed')),
  ...['growth', 'macro', 'risk'].map((r) => run(r, 'challenge', failed.includes(r) ? 'failed' : 'completed')),
  run('chair', 'synthesis', 'completed')];
const cov = (status: Coverage['status']): Coverage => ({ key: 'k' + Math.random(), purpose: 'p', tool: 't', roles: [], status });

test('unavailable sources and unchecked qualitative claims prevent a ready status', () => {
  const r = councilReadiness(all(), [cov('retrieved'), cov('unavailable')]);
  assert.equal(r.level, 'partial'); assert.deepEqual(r.reasons, ['1 planned evidence item unavailable', 'qualitative claims have not been independently verified']);
  assert.equal(readinessLine(r), 'Research readiness: partial · stages 7/7 · evidence 1 retrieved (1 unavailable)\nLimitations: 1 planned evidence item unavailable; qualitative claims have not been independently verified.');
});

test('the audited live case (two refused challenges) is partial, never a clean success', () => {
  const r = councilReadiness(all(['macro', 'risk']), [cov('retrieved')]);
  assert.equal(r.level, 'partial');
  assert.deepEqual(r.reasons, ['5 of 7 stages completed (Macro challenge: model call failed; Risk challenge: model call failed)', 'qualitative claims have not been independently verified']);
});

// TSM audit 2026-10-31: the risk challenge was refused by the turn cap, not a
// provider failure. The cause and the cap's source reach the answer.
test('a stage refused by the spending cap is named with its cause and the cap source', () => {
  const runs = all(['risk']); runs[5] = { ...runs[5]!, error: 'Council turn budget cannot cover next call: needs up to US$0.0178', cause: 'budget' };
  const r = councilReadiness(runs, [cov('retrieved')], { capUsd: 0.05, capSource: 'limits.turnUsd (limits.councilTurnUsd is not set)' });
  assert.equal(r.level, 'partial');
  assert.deepEqual(r.stageIssues, ['Risk challenge: stopped by the spending cap']);
  assert.equal(r.reasons[0], '6 of 7 stages completed (Risk challenge: stopped by the spending cap)');
  assert.match(readinessLine(r), /Spending cap: US\$0\.05 per Council turn from limits\.turnUsd \(limits\.councilTurnUsd is not set\)\./);
  // No budget line when nothing was refused by the cap.
  assert.equal(councilReadiness(all(), [], { capUsd: 0.05, capSource: 'x' }).budget, undefined);
});

test('failed evidence and unverified figures are partial; no chair synthesis is insufficient', () => {
  const flagged = all(); flagged[6] = run('chair', 'synthesis', 'completed', ['x']);
  assert.deepEqual(councilReadiness(flagged, [cov('failed')]).reasons, ['1 planned evidence item failed', '1 unverified figure check', 'qualitative claims have not been independently verified']);
  const noChair = all().slice(0, 6);
  assert.equal(councilReadiness(noChair, []).level, 'insufficient');
});
