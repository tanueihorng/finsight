// COUNCILQUALITY-001 items 2/3: evidence is planned by instrument type before
// specialists run, and every item keeps its real outcome. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectEvidence, planEvidence, PLAN_LIMITS, secTicker, subjectKind } from '../src/chat/council-evidence.ts';

const keys = (p: ReturnType<typeof planEvidence>) => p.items.map((i) => i.key);

test('equities get filings, financials and price path; portfolio, policy and macro context are planned once', () => {
  const p = planEvidence([{ symbol: 'AMD', type: 'EQUITY' }], Date.UTC(2026, 9, 29));
  assert.deepEqual(keys(p), ['history:AMD', 'financials:AMD', 'filings:AMD', 'portfolio:weights', 'portfolio:sectors', 'portfolio:policy', 'macro:DGS10']);
  assert.deepEqual(p.items.find((i) => i.key === 'portfolio:weights')!.args, { symbols: ['AMD'] });
  assert.equal(p.items.find((i) => i.key === 'macro:DGS10')!.args.start, '2025-10-28');
  assert.deepEqual(p.coverage, []);
});

test('funds get a fund profile, and the missing issuer document is explicit rather than silent', () => {
  const p = planEvidence([{ symbol: 'VOO', type: 'ETF' }]);
  assert.ok(keys(p).includes('fund:VOO'));
  assert.ok(!keys(p).some((k) => k.startsWith('financials:')));
  assert.deepEqual(p.coverage.map((c) => [c.key, c.status]), [['issuer:VOO', 'unavailable']]);
});

test('non-US listings are not sent to SEC EDGAR; extra subjects are bounded and recorded', () => {
  assert.equal(secTicker('D05.SI'), false); assert.equal(secTicker('BRK.B'), true); assert.equal(secTicker('AMD'), true);
  assert.equal(subjectKind('Mutual Fund'), 'fund'); assert.equal(subjectKind('Equity'), 'equity'); assert.equal(subjectKind(undefined), 'other');
  const p = planEvidence([{ symbol: 'D05.SI', type: 'EQUITY' }, { symbol: 'A' }, { symbol: 'B' }, { symbol: 'C' }]);
  assert.ok(p.coverage.some((c) => c.key === 'financials:D05.SI' && c.status === 'not_applicable'));
  assert.ok(p.coverage.some((c) => c.subject === 'C' && c.status === 'skipped_limit'));
  // Three subjects at most three items each, plus four shared items, fit the item cap.
  assert.ok(p.items.length <= PLAN_LIMITS.items);
});

test('collection keeps order, records failures with reasons and honours the concurrency bound', async () => {
  const plan = planEvidence([{ symbol: 'AMD', type: 'EQUITY' }]);
  let live = 0, peak = 0;
  const out = await collectEvidence(plan, async (tool) => {
    live++; peak = Math.max(peak, live); await new Promise((r) => setTimeout(r, 2)); live--;
    if (tool === 'get_macro_series') throw Error('Research tool failed: get_macro_series (FINSIGHT_ERROR: 404)');
    return { id: 'e-' + tool, source: tool, observedAt: 'x', retrievedAt: 'y', content: '{}' };
  }, new AbortController().signal);
  assert.ok(peak <= PLAN_LIMITS.concurrency);
  assert.equal(out.evidence.length, plan.items.length - 1);
  const macro = out.coverage.find((c) => c.key === 'macro:DGS10')!;
  assert.equal(macro.status, 'failed'); assert.match(macro.reason!, /FINSIGHT_ERROR: 404/);
  assert.equal(out.coverage.find((c) => c.key === 'history:AMD')!.evidenceId, 'e-get_history');
});

test('cancellation propagates instead of being recorded as a source failure', async () => {
  const ac = new AbortController();
  await assert.rejects(collectEvidence(planEvidence([{ symbol: 'AMD', type: 'EQUITY' }]), async () => { ac.abort(); throw Error('aborted'); }, ac.signal));
});
