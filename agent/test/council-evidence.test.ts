// COUNCILQUALITY-001 items 2/3: evidence is planned by instrument type before
// specialists run, and every item keeps its real outcome. Synthetic data only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { collectEvidence, planEvidence, PLAN_LIMITS, secTicker, subjectKind } from '../src/chat/council-evidence.ts';

const keys = (p: ReturnType<typeof planEvidence>) => p.items.map((i) => i.key);

test('equities get financials, valuation, the earnings release, 8-K text, earnings dates and price path; portfolio, policy and macro context are planned once', () => {
  const p = planEvidence([{ symbol: 'AMD', type: 'EQUITY' }], Date.UTC(2026, 9, 29));
  assert.deepEqual(keys(p), ['history:AMD', 'financials:AMD', 'valuation:AMD', 'earnings8k:AMD', '8k:AMD', 'events:earnings', 'portfolio:weights', 'portfolio:sectors', 'portfolio:policy', 'macro:DGS10']);
  // The latest results release is requested by item, not left to the latest two 8-Ks.
  assert.deepEqual(p.items.find((i) => i.key === 'earnings8k:AMD')!.args, { ticker: 'AMD', limit: 1, items: ['2.02'], maxChars: 8000 });
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
  assert.ok(p.coverage.some((c) => c.key === 'valuation:D05.SI' && c.status === 'unavailable'));
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

test('trailing twelve months falls back from quarters to fiscal year plus year-to-date, then fiscal year', async () => {
  const { ttm } = await import('../src/tools/web.ts');
  const fy = { start: '2025-01-01', end: '2025-12-31', val: 100, form: '10-K' };
  const ytd = { start: '2026-01-01', end: '2026-06-30', val: 60, form: '10-Q' }, prior = { start: '2025-01-01', end: '2025-06-30', val: 40, form: '10-Q' };
  assert.deepEqual([ttm([fy, ytd, prior])!.value, ttm([fy, ytd, prior])!.method], [120, 'fiscal year + current year-to-date - prior year-to-date']);
  assert.equal(ttm([fy])!.method, 'latest fiscal year (no comparable year-to-date)');
  assert.equal(ttm([{ end: '2026-06-30', val: 5 }]), null); // instants are not flows
});

test('the account on screen adds its own weights beside the all-account figures', () => {
  const all = planEvidence([{ symbol: 'AMD', type: 'EQUITY' }]);
  assert.ok(!keys(all).includes('portfolio:weights:selected'));
  assert.ok(!keys(planEvidence([{ symbol: 'AMD', type: 'EQUITY' }], Date.now(), { account: 'ALL' })).includes('portfolio:weights:selected'));
  const one = planEvidence([{ symbol: 'AMD', type: 'EQUITY' }], Date.now(), { account: 'a1' });
  assert.deepEqual(one.items.find((i) => i.key === 'portfolio:weights:selected')!.args, { symbols: ['AMD'], account: 'a1' });
  assert.deepEqual(one.items.find((i) => i.key === 'portfolio:weights')!.args, { symbols: ['AMD'] });
  // Three equities and a selected account still fit without dropping shared context.
  const three = planEvidence([{ symbol: 'A', type: 'EQUITY' }, { symbol: 'B', type: 'EQUITY' }, { symbol: 'C', type: 'EQUITY' }], Date.now(), { account: 'a1' });
  assert.deepEqual(three.coverage.filter((c) => c.status === 'skipped_limit'), []);
});
