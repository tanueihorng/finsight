import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CouncilBudget, runCouncil } from '../src/chat/council.ts';
import type { CouncilEvidence } from '../src/chat/council.ts';
import type { ApiBrain, StepRequest } from '../src/brains/types.ts';
import { BrainManifest } from '../src/brains/types.ts';
const finding = { findings: [{ claim: 'Insufficient evidence', evidenceIds: ['e1'], assumptions: [], uncertainty: 'Policy missing', counterevidence: [], invalidation: 'New filing', missingEvidence: ['Policy'] }], unresolvedQuestions: ['Suitability unknown'] };
const manifest = BrainManifest.parse({ apiVersion: 1, kind: 'brain', id: 'test-brain', label: 'Test', transport: 'mock', model: 'test', pricing: { inputPerM: 0.1, outputPerM: 0.1, version: '1' }, capabilities: { tools: true, streaming: false, contextTokens: 100000 }, costTier: '$', maxOutputTokens: 100 });
const setup = (step: ApiBrain['step']) => ({ question: 'Review synthetic company', evidence: [{ id: 'e1', source: 'Synthetic filing', observedAt: '2026-10-01', retrievedAt: '2026-10-28', content: 'Test evidence' }], brain: { kind: 'api' as const, manifest, step }, system: 'Core rules', signal: new AbortController().signal, capUsd: 1, dayBudget: new CouncilBudget(1), emit: () => {}, account: () => {}, execute: async (_role: string, _name: string, _args: unknown, _signal: AbortSignal): Promise<CouncilEvidence> => { throw Error('Must not execute'); }, tools: [] });
const result = () => ({ blocks: [{ type: 'text' as const, text: JSON.stringify(finding) }], usage: { inputTokens: 100, outputTokens: 100 }, stopReason: 'end' as const });

test('reservations stop concurrent overspend; settlement cannot release twice; unknown usage retains reserve', () => {
 const b = new CouncilBudget(1); const settle = b.reserve(0.7);
 assert.throws(() => b.reserve(0.4)); settle(null); assert.throws(() => settle(0)); assert.throws(() => b.reserve(0.4));
 const done = b.reserve(0.2); done(0.1); assert.doesNotThrow(() => b.reserve(0.2));
});
test('council isolates initial histories, fixes rounds and limits concurrency', async () => {
 const requests: StepRequest[] = []; let active = 0, peak = 0;
 const o = setup(async (r) => { requests.push(r); active++; peak = Math.max(peak, active); await new Promise((resolve) => setTimeout(resolve, 2)); active--; return result(); });
 const out = await runCouncil(o);
 assert.equal(out.steps, 7); assert.equal(out.runs.length, 7); assert.equal(peak, 2);
 for (const r of requests.slice(0, 3)) { assert.equal(r.messages.length, 1); assert.equal(JSON.parse((r.messages[0]!.blocks[0] as { text: string }).text).data, null); }
 assert.match(out.text, /Insufficient evidence/);
});
test('hallucinated tools are denied at execution; failures label partial synthesis', async () => {
 let executed = false;
 const o = setup(async (r) => r.system.includes('Council role: chair') ? result() : { ...result(), blocks: [{ type: 'tool_call', id: 'x', name: 'propose_record_update', args: {} }], stopReason: 'tool_use' });
 o.execute = async () => { executed = true; throw Error('Unexpected'); };
 const out = await runCouncil(o); assert.equal(executed, false); assert.match(out.text, /Partial/); assert.ok(out.runs.some((r) => r.error?.includes('denied')));
});
test('stop aborts non-cooperative provider without accepting late completion', async () => {
 const ctrl = new AbortController(); let release!: (v: ReturnType<typeof result>) => void; const events: string[] = [];
 const o = { ...setup(async () => new Promise((resolve) => { release = resolve; })), signal: ctrl.signal, emit: (r: {status: string}) => { events.push(r.status); } };
 const pending = runCouncil(o); ctrl.abort(); await assert.rejects(pending); release(result()); await new Promise((r) => setTimeout(r, 0)); assert.ok(!events.includes('completed'));
});

test('malformed output gets at most one accounted repair per stage', async () => {
 let n = 0;
 const o = setup(async () => ++n === 1 ? { ...result(), blocks: [{ type: 'text', text: 'not JSON' }] } : result());
 const out = await runCouncil(o);
 assert.equal(out.steps, 8); assert.equal(out.runs.filter((r) => r.status === 'completed').length, 7);
 let dispatched = 0;
 const broken = await runCouncil(setup(async () => { dispatched++; return { ...result(), blocks: [{ type: 'text', text: 'not JSON' }] }; }));
 assert.equal(dispatched, 14); assert.equal(broken.steps, 14); assert.match(broken.text, /Partial/);
});

test('per-call output limits do not mutate model defaults and reject invalid bounds', async () => {
 const { outputLimit } = await import('../src/brains/types.ts');
 assert.equal(outputLimit(manifest, { maxOutputTokens: 50 }), 50);
 assert.equal(outputLimit(manifest, {}), 100);
 assert.throws(() => outputLimit(manifest, { maxOutputTokens: 101 }));
 assert.throws(() => outputLimit(manifest, { maxOutputTokens: -1 }));
 assert.equal(manifest.maxOutputTokens, 100);
});

test('invalid cost settlement retains reservation instead of poisoning the cap', () => {
 const budget = new CouncilBudget(1); const settle = budget.reserve(0.8);
 assert.throws(() => settle(Number.NaN));
 assert.throws(() => budget.reserve(0.3));
});

test('oversized research batches execute four calls and acknowledge every skipped call before synthesis', async () => {
 const executed: string[] = [];
 let checkedFollowup = false;
 const o = setup(async (req) => {
  if (!req.system.includes('Council role: growth') || req.system.includes('This phase has no research tools.')) return result();
  if (req.messages.length === 1) return { ...result(), blocks: ['get_quote', 'get_history', 'edgar_filings', 'edgar_financials', 'get_quote'].map((name, i) => ({ type: 'tool_call' as const, id: 'call' + i, name, args: {} })), stopReason: 'tool_use' };
  const replies = req.messages.filter((m) => m.role === 'tool').flatMap((m) => m.blocks);
  assert.equal(replies.length, 5);
  assert.deepEqual(replies.map((b) => b.type === 'tool_result' && [b.callId, b.ok]), [['call0', true], ['call1', true], ['call2', true], ['call3', true], ['call4', false]]);
  const skipped = replies[4]!;
  assert.ok(skipped.type === 'tool_result' && /not executed.*research.*limit/i.test(skipped.content));
  assert.equal(req.tools.length, 0);
  checkedFollowup = true;
  return result();
 });
 o.execute = async (_role, name) => { executed.push(name); return { id: 'research' + executed.length, source: 'Synthetic ' + name, observedAt: '2026-10-01', retrievedAt: '2026-10-29', content: 'Synthetic result' }; };
 const out = await runCouncil(o);
 assert.deepEqual(executed, ['get_quote', 'get_history', 'edgar_filings', 'edgar_financials']);
 assert.ok(checkedFollowup);
 assert.equal(out.steps, 8);
 assert.ok(out.runs.every((r) => r.status === 'completed'));
});

test('a forbidden call in an oversized batch is rejected before any tool execution', async () => {
 let executed = false;
 const o = setup(async (req) => req.system.includes('Council role: growth') ? { ...result(), blocks: ['get_quote', 'get_history', 'edgar_filings', 'edgar_financials', 'propose_record_update'].map((name, i) => ({ type: 'tool_call' as const, id: 'call' + i, name, args: {} })), stopReason: 'tool_use' } : result());
 o.execute = async () => { executed = true; throw Error('Unexpected'); };
 const out = await runCouncil(o);
 assert.equal(executed, false);
 assert.match(out.runs.find((r) => r.role === 'growth' && r.phase === 'assessment')!.error!, /Council tool denied/);
 assert.match(out.text, /Partial council review/);
});

test('a figure absent from cited evidence gets one repair; an unresolved one is flagged, not hidden', async () => {
  const figure = { ...finding, findings: [{ ...finding.findings[0]!, claim: 'Holding is 15.28% of the portfolio' }] };
  const asText = (a: unknown) => ({ ...result(), blocks: [{ type: 'text' as const, text: JSON.stringify(a) }] });
  const chair = (req: StepRequest) => /Council role: chair/.test(req.system);
  let n = 0;
  const fixed = await runCouncil(setup(async (req: StepRequest) => {
    n++;
    return chair(req) && !/Figure check failed/.test(JSON.stringify(req.messages.at(-1))) ? asText(figure) : result();
  }));
  assert.equal(n, 8); // six specialist calls, the chair, and one chair repair
  assert.ok(fixed.runs.every((r) => r.status === 'completed' && !r.metricIssues));
  assert.doesNotMatch(fixed.text, /Figure check/);
  const stuck = await runCouncil(setup(async (req: StepRequest) => (chair(req) ? asText(figure) : result())));
  const flagged = stuck.runs.filter((r) => r.metricIssues);
  assert.deepEqual(flagged.map((r) => r.role), ['chair']);
  assert.equal(flagged[0]!.status, 'completed');
  assert.match(flagged[0]!.metricIssues!.join(), /15\.28% is not in its cited evidence/);
  assert.match(stuck.text, /Figure check \(unresolved[\s\S]*chair synthesis: finding 1: 15\.28%/);
});


test('repeated unresolved figures reach the chair and remain flagged without a global step cap', async () => {
 const assessment = { ...finding, findings: [{ ...finding.findings[0]!, claim: 'Holding is 99.99% of assets' }] };
 let calls = 0;
 const o = setup(async () => { calls++; return { ...result(), blocks: [{ type: 'text' as const, text: JSON.stringify(assessment) }] }; });
 const out = await runCouncil({ ...o, prepare: async (call) => { await call('subject resolution', [{ role:'user', blocks:[{type:'text',text:'subject'}] }]); return { question:o.question, evidence:[] }; } });
 assert.equal(calls, 15); assert.equal(out.steps, 15);
 assert.equal(out.runs.length, 7); assert.ok(out.runs.every((r) => r.status === 'completed' && r.metricIssues?.length));
 assert.match(out.text, /chair synthesis: finding 1: 99\.99%/);
});

test('council advertises four research tools and allows 2000 output tokens when the model supports it', async () => {
 const requests: StepRequest[] = [];
 const base = setup(async (req) => { requests.push(req); return result(); });
 const capable = { ...base, brain: { ...base.brain, manifest: { ...base.brain.manifest, maxOutputTokens: 4096 } } };
 const out = await runCouncil(capable);
 assert.equal(out.runs.length, 7);
 assert.ok(requests.every((r) => r.maxOutputTokens === 2000));
 assert.match(requests[0]!.system, /at most 4 tool calls/);
 assert.match(requests[0]!.system, /at most four evidence-backed findings/);
});
