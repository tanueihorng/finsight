// COUNCILQUALITY-001 frozen TSM-ENTRY replay: the evidence packet and stage
// findings of the audited 2026-10-31 demo turn (fictional portfolio), checked
// again with today's figure rules. The run named "all accounts combined" in
// each claim and labelled 15% a proposed limit, yet its scope warnings fired.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { metricIssues } from '../src/chat/council-metrics.ts';

type Run = { role: string; phase: string; findings: Parameters<typeof metricIssues>[0]; recordedIssues: string[] };
const fixture = JSON.parse(fs.readFileSync(new URL('./fixtures/council-tsm-entry.json', import.meta.url), 'utf8')) as { evidence: { id: string; content: string }[]; runs: Run[] };
const replay = (role: string, phase: string) => {
  const run = fixture.runs.find((r) => r.role === role && r.phase === phase)!;
  return { recorded: run.recordedIssues, now: metricIssues(run.findings, fixture.evidence) };
};

test('TSM replay: the recorded false account-scope warnings no longer fire', () => {
  const flagged = fixture.runs.filter((r) => r.recordedIssues.some((i) => /account scope/.test(i)));
  assert.deepEqual(flagged.map((r) => `${r.role} ${r.phase}`), ['risk assessment', 'growth challenge', 'chair synthesis']);
  for (const r of flagged) assert.deepEqual(metricIssues(r.findings, fixture.evidence).filter((i) => /account scope/.test(i)), [], `${r.role} ${r.phase}`);
});

test('TSM replay: a real mixed-denominator pairing is still caught', () => {
  // "12.54% of securities-plus-cash and 15.63% of securities" in one claim.
  const { now } = replay('growth', 'challenge');
  assert.equal(now.length, 1);
  assert.match(now[0]!, /^finding 4: mixes denominators .*12\.54%.*15\.63% on securities\)/);
});

test('TSM replay: stages that passed still pass', () => {
  for (const [role, phase] of [['growth', 'assessment'], ['macro', 'assessment'], ['macro', 'challenge'], ['risk', 'assessment'], ['chair', 'synthesis']] as const) assert.deepEqual(replay(role, phase).now, [], `${role} ${phase}`);
});
