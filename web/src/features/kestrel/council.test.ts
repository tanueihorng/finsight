import test from 'node:test';
import assert from 'node:assert/strict';
import { councilModel, type CouncilPart } from './council.ts';

const finding = (claim: string, extra: Record<string, unknown> = {}) => ({ claim, evidenceIds: ['e1', 'e2'], assumptions: ['A'], uncertainty: 'Some doubt', counterevidence: ['C'], invalidation: 'New data', missingEvidence: ['M'], ...extra });
function run(role: string, phase: string, status: string, claim = role + ' ' + phase): CouncilPart {
  return { kind: 'council', key: role + phase, role, phase, status, model: 'fixture', costUsd: status === 'completed' ? 0.001 : null, ms: 1000,
    detail: status === 'completed' ? JSON.stringify({ findings: [finding(claim)], unresolvedQuestions: ['Q?'] }) : status === 'failed' ? 'source down' : '' } as CouncilPart;
}
const all = () => ['growth', 'macro', 'risk'].flatMap((r) => [run(r, 'assessment', 'completed'), run(r, 'challenge', 'completed')]).concat(run('chair', 'synthesis', 'completed', 'Chair ruling'));

test('a complete review maps real fields only', () => {
  const v = councilModel(all(), true, true);
  assert.equal(v.title, 'Review complete');
  assert.deepEqual(v.stageDone, [true, true, true]);
  assert.equal(v.done, 7);
  const g = v.roles[0]!;
  assert.equal(g.claim, 'growth assessment');
  assert.equal(g.challengeClaim, 'growth challenge');
  assert.equal(g.evidence, 2);
  assert.equal(g.against, 2);
  assert.deepEqual(g.steps.map((s) => [s.kind, s.tag]), [['claim', 'G1'], ['challenge', 'G2']]);
  assert.equal(v.chair.lead, 'Chair ruling');
  assert.deepEqual(v.chair.questions, ['Q?']);
  assert.deepEqual(v.chair.evidence, ['e1', 'e2']);
  assert.equal(v.cost?.toFixed(3), '0.007');
});

test('UNPEEK blanks every finding, count and question', () => {
  const v = councilModel(all(), true, false);
  assert.equal(v.hidden, true);
  for (const r of v.roles) {
    assert.equal(r.claim, ''); assert.equal(r.evidence, null); assert.equal(r.uncertainty, ''); assert.equal(r.invalidation, '');
    assert.deepEqual([...r.assumptions, ...r.counter, ...r.missing], []);
    assert.ok(r.steps.every((s) => s.text === 'Findings hidden' && !s.evidence.length));
  }
  assert.equal(v.chair.lead, ''); assert.deepEqual(v.chair.questions, []); assert.deepEqual(v.chair.evidence, []);
  const shown = JSON.stringify({ ...v, roles: v.roles.map(({ runs: _, ...r }) => r), chair: { ...v.chair, runs: [] } });
  for (const text of ['growth assessment', 'Chair ruling', 'Some doubt', 'New data', 'Q?']) assert.ok(!shown.includes(text), text);
});

test('running, failed, queued and not-run states stay truthful', () => {
  const live = councilModel([run('growth', 'assessment', 'running'), run('macro', 'assessment', 'failed')], false, true);
  assert.equal(live.title, 'Council in session');
  assert.equal(live.roles[0]!.state, 'running');
  assert.equal(live.roles[0]!.steps[0]!.running, true);
  assert.equal(live.roles[1]!.state, 'failed');
  assert.deepEqual(live.roles[1]!.steps.map((s) => [s.kind, s.text]), [['gap', 'Assessment missing: source down']]);
  assert.equal(live.roles[2]!.state, 'queued');
  assert.equal(live.chair.waiting, 'Waiting for Business & Growth');
  assert.equal(live.activeLabel, 'Assess · Business');
  const ended = councilModel([run('growth', 'assessment', 'stopped')], true, true);
  assert.equal(ended.title, 'Review ended with gaps');
  assert.equal(ended.roles[1]!.state, 'not-run');
  assert.equal(ended.cost, null);
});

test('a failed chair reports the failure, with its error only under PEEK', () => {
  const runs = ['growth', 'macro', 'risk'].map((r) => run(r, 'assessment', 'completed')).concat({ ...run('chair', 'synthesis', 'failed'), detail: 'provider timeout' } as CouncilPart);
  const v = councilModel(runs, true, true);
  assert.equal(v.chair.state, 'failed');
  assert.equal(v.chair.waiting, 'Synthesis failed');
  assert.equal(v.chair.error, 'Synthesis failed: provider timeout');
  assert.equal(councilModel(runs, true, false).chair.error, 'Synthesis failed.');
  const stopped = councilModel([run('chair', 'synthesis', 'stopped')], true, true);
  assert.equal(stopped.chair.error, 'Synthesis interrupted.');
});


test('figure warnings remain available in both views and hide details under UNPEEK', () => {
  const runs = [{ ...run('growth', 'assessment', 'completed'), flags: ['private growth detail'] }, { ...run('growth', 'challenge', 'completed'), flags: ['private growth detail'] }, { ...run('chair', 'synthesis', 'completed'), flags: ['private chair detail'] }];
  const visible = councilModel(runs, true, true), hidden = councilModel(runs, true, false);
  assert.deepEqual(visible.roles[0]!.flags, ['private growth detail']);
  assert.deepEqual(visible.chair.flags, ['private chair detail']);
  assert.equal(hidden.roles[0]!.flagCount, 1); assert.deepEqual(hidden.roles[0]!.flags, []);
  assert.equal(hidden.chair.flagCount, 1); assert.deepEqual(hidden.chair.flags, []);
});

// TSM demo audit 2026-10-31: the risk assessment completed and only its
// challenge was refused by the spending cap. The card must not say the
// assessment is missing, live or on replay.
test('a challenge stopped by the spending cap keeps the assessment and names the phase and cause', () => {
  const runs = all().map((r) => r.role === 'risk' && r.phase === 'challenge' ? { ...r, status: 'failed', detail: 'Council turn budget cannot cover next call', cause: 'budget' as const, costUsd: 0 } : r);
  for (const peek of [true, false]) {
    const risk = councilModel(runs, true, peek).roles[2]!;
    assert.equal(risk.state, 'failed');
    assert.equal(risk.stateLabel, 'Partial');
    assert.equal(risk.phaseNote, 'Assessed · challenge not run · spending cap reached');
    assert.ok(!JSON.stringify(risk.steps).includes('Assessment missing'));
    assert.equal(risk.steps.at(-1)!.text, peek ? 'Challenge not run · spending cap reached: Council turn budget cannot cover next call' : 'Challenge not run · spending cap reached');
  }
  // A genuinely failed assessment still says so.
  const failed = all().map((r) => r.role === 'risk' && r.phase === 'assessment' ? { ...r, status: 'failed', cause: 'model' as const } : r).filter((r) => !(r.role === 'risk' && r.phase === 'challenge'));
  const risk = councilModel(failed, true, true).roles[2]!;
  assert.equal(risk.phaseNote, 'Assessment missing'); assert.equal(risk.stateLabel, 'Failed');
  // A challenge that failed for another reason is not blamed on the budget.
  const model = all().map((r) => r.role === 'macro' && r.phase === 'challenge' ? { ...r, status: 'failed', cause: 'model' as const } : r);
  assert.equal(councilModel(model, true, false).roles[1]!.phaseNote, 'Assessed · challenge failed');
});
