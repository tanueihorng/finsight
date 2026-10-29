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

test('all stages and evidence complete is ready; disclosed unavailable sources do not lower it', () => {
  const r = councilReadiness(all(), [cov('retrieved'), cov('unavailable')]);
  assert.equal(r.level, 'ready'); assert.deepEqual(r.reasons, []);
  assert.equal(readinessLine(r), 'Research readiness: ready · stages 7/7 · evidence 1 retrieved (1 unavailable)');
});

test('the audited live case (two refused challenges) is partial, never a clean success', () => {
  const r = councilReadiness(all(['macro', 'risk']), [cov('retrieved')]);
  assert.equal(r.level, 'partial');
  assert.deepEqual(r.reasons, ['5 of 7 stages completed']);
});

test('failed evidence and unverified figures are partial; no chair synthesis is insufficient', () => {
  const flagged = all(); flagged[6] = run('chair', 'synthesis', 'completed', ['x']);
  assert.deepEqual(councilReadiness(flagged, [cov('failed')]).reasons, ['1 planned evidence item failed', '1 unverified figure check']);
  const noChair = all().slice(0, 6);
  assert.equal(councilReadiness(noChair, []).level, 'insufficient');
});
