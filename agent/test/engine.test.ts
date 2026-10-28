import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { fakeFinsight, testConfig } from './helpers.ts';
import type { Fake } from './helpers.ts';
import { openDb } from '../src/store/db.ts';
import * as store from '../src/store/db.ts';
import { buildRegistry } from '../src/tools/index.ts';
import { finsightClient } from '../src/tools/finsight.ts';
import { EventBus } from '../src/chat/bus.ts';
import { ChatEngine } from '../src/chat/engine.ts';
import { mockBrain } from '../src/brains/mock.ts';
import type { Script } from '../src/brains/mock.ts';
import { BrainManifest } from '../src/brains/types.ts';
import { toOpenAiMessages } from '../src/brains/openai.ts';
import { toAnthropicMessages } from '../src/brains/anthropic.ts';
import type { Msg } from '../src/types.ts';

let fake: Fake;
before(async () => { fake = await fakeFinsight(); });
after(async () => { await fake.close(); });

const manifest = BrainManifest.parse({ apiVersion: 1, kind: 'brain', id: 'mock', label: 'Mock', transport: 'mock', model: 'm',
  pricing: { inputPerM: 1, outputPerM: 2, version: 't' }, capabilities: { tools: true, streaming: true, contextTokens: 100000 }, costTier: '$' });

function setup(script: Script, limits = {}) {
  const cfg = testConfig(fake); Object.assign(cfg.limits, limits); cfg.defaultBrain = 'mock';
  const db = openDb(':memory:'); const bus = new EventBus(db);
  const engine = new ChatEngine({ cfg, db, tools: buildRegistry(), brains: new Map(), finsight: finsightClient(cfg.finsightUrl, cfg.finsightDataDir), bus });
  engine.setBrain('mock', mockBrain(manifest, script));
  return { cfg, db, bus, engine };
}
async function waitTurn(db: any, turnId: string) {
  for (let i = 0; i < 400; i++) { const t = db.prepare('SELECT status FROM turns WHERE id = ?').get(turnId); if (t && t.status !== 'running') return t.status; await new Promise((r) => setTimeout(r, 10)); }
  throw new Error('turn did not finish');
}

test('tool loop: brain calls a tool, gets the real result, answers; events + trace + cost recorded', async () => {
  let sawResult = '';
  const { db, engine } = setup((req, step) => {
    if (step === 0) return [{ type: 'text', text: 'Checking. ' }, { type: 'tool_call', id: 'c1', name: 'get_cash', args: {} }];
    const last = req.messages[req.messages.length - 1]!;
    sawResult = (last.blocks[0] as any).content;
    return [{ type: 'text', text: 'You have S$4,350 cash.' }];
  });
  const t = store.createThread(db);
  const r = engine.send({ threadId: t.id, content: 'How much cash?', idempotencyKey: 'idem-000001' });
  assert.equal(await waitTurn(db, r.turnId), 'succeeded');
  assert.match(sawResult, /"totalBase":4350/);
  const types = store.eventsAfter(db, t.id, 0).map((e) => e.type);
  for (const ty of ['turn.started', 'message.delta', 'tool.started', 'tool.finished', 'turn.finished']) assert.ok(types.includes(ty), ty);
  assert.ok(store.getTrace(db, r.turnId).length >= 3);
  assert.ok(store.spendSince(db, 0) > 0);
  const msgs = store.listMessages(db, t.id);
  assert.ok(msgs.some((m) => m.blocks.some((b) => b.type === 'notice' && b.kind === 'context_pack')), 'context snapshot attached');
  // same idempotency key: no second turn
  const again = engine.send({ threadId: t.id, content: 'How much cash?', idempotencyKey: 'idem-000001' });
  assert.equal(again.existing, true); assert.equal(again.turnId, r.turnId);
});

test('one running turn per thread; stale version is rejected', async () => {
  const { db, engine } = setup(async () => { await new Promise((r) => setTimeout(r, 150)); return [{ type: 'text', text: 'done' }]; });
  const t = store.createThread(db);
  const r = engine.send({ threadId: t.id, content: 'a', expectedVersion: 0 });
  assert.throws(() => engine.send({ threadId: t.id, content: 'b' }), (e: any) => e.code === 'CONFLICT');
  await waitTurn(db, r.turnId);
  assert.throws(() => engine.send({ threadId: t.id, content: 'c', expectedVersion: 0 }), (e: any) => e.code === 'CONFLICT' && /changed/.test(e.message));
});

test('step limit forces a tool-free final answer', async () => {
  let toolsOffered: number[] = [];
  const { db, engine } = setup((req) => {
    toolsOffered.push(req.tools.length);
    return req.tools.length ? [{ type: 'tool_call', id: 'x' + Math.random(), name: 'get_accounts', args: {} }] : [{ type: 'text', text: 'Final answer with what I have.' }];
  }, { turnSteps: 3 });
  const t = store.createThread(db);
  const r = engine.send({ threadId: t.id, content: 'loop forever' });
  assert.equal(await waitTurn(db, r.turnId), 'succeeded');
  assert.deepEqual(toolsOffered.map((n) => n > 0), [true, true, true, false]);
  assert.ok(store.eventsAfter(db, t.id, 0).some((e) => e.type === 'budget.warning'));
});

test('stop aborts the turn and keeps the partial reply', async () => {
  const { db, engine } = setup(async (req) => { req.onText('partial '); await new Promise((r, j) => { const id = setTimeout(r, 2000); req.signal.addEventListener('abort', () => { clearTimeout(id); j(Object.assign(new Error('aborted'), { name: 'AbortError' })); }); }); return []; });
  const t = store.createThread(db);
  const r = engine.send({ threadId: t.id, content: 'long one' });
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(engine.stop(t.id), true);
  assert.equal(await waitTurn(db, r.turnId), 'stopped');
  const last = store.listMessages(db, t.id).pop()!;
  assert.ok(last.blocks.some((b) => b.type === 'notice' && b.kind === 'stopped'));
});

test('daily cap blocks API brains', () => {
  const { db, engine, cfg } = setup(() => [{ type: 'text', text: 'x' }]);
  store.addCost(db, { brain: 'mock', kind: 'tokens', units: 1, usd: cfg.limits.dayUsd + 0.01 });
  const t = store.createThread(db);
  assert.throws(() => engine.send({ threadId: t.id, content: 'hi' }), (e: any) => e.code === 'BUDGET_EXCEEDED');
});

test('SSE replay ordering: events have increasing ids and replay from any point', async () => {
  const { db, engine } = setup(() => [{ type: 'text', text: 'hello world, this is streamed' }]);
  const t = store.createThread(db);
  const r = engine.send({ threadId: t.id, content: 'hi' });
  await waitTurn(db, r.turnId);
  const all = store.eventsAfter(db, t.id, 0);
  const ids = all.map((e) => e.id);
  assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
  const tail = store.eventsAfter(db, t.id, ids[1]!);
  assert.equal(tail.length, all.length - 2);
  const text = all.filter((e) => e.type === 'message.delta').map((e) => (e.payload as any).text).join('');
  assert.equal(text, 'hello world, this is streamed', 'coalesced deltas reassemble exactly');
});

test('provider-neutral history translates to OpenAI and Anthropic shapes (model switch keeps context)', () => {
  const h: Msg[] = [
    { role: 'user', blocks: [{ type: 'text', text: 'cash?' }] },
    { role: 'assistant', blocks: [{ type: 'tool_call', id: 'call:1/x', name: 'get_cash', args: {} }] },
    { role: 'tool', blocks: [{ type: 'tool_result', callId: 'call:1/x', name: 'get_cash', ok: true, content: '{"totalBase":1}' }] },
    { role: 'assistant', blocks: [{ type: 'text', text: 'S$1' }] },
  ];
  const o = toOpenAiMessages('sys', h);
  assert.equal(o[2].tool_calls[0].id, o[3].tool_call_id);
  const a = toAnthropicMessages('haiku', h) as any[];
  assert.equal(a[1].content[0].id, a[2].content[0].tool_use_id);
  assert.match(a[1].content[0].id, /^[A-Za-z0-9_-]+$/);
});

test('search provider is chosen per message, independent of the model; missing key is refused', async () => {
  const { clearSecretCache } = await import('../src/secrets.ts');
  const { searchProviders } = await import('../src/tools/web.ts');
  const saved = process.env.DEEPSEEK_API_KEY;
  try {
    delete process.env.DEEPSEEK_API_KEY; clearSecretCache();
    const { cfg, db, engine } = setup(() => [{ type: 'text', text: 'ok' }]);
    assert.equal(searchProviders(cfg).providers.find((p) => p.id === 'deepseek')!.available, false);
    const t = store.createThread(db);
    assert.throws(() => engine.send({ threadId: t.id, content: 'a', search: 'deepseek' }), (e: any) => e.code === 'SEARCH_NOT_CONFIGURED');
    const auto = engine.send({ threadId: t.id, content: 'b', search: 'auto' });
    await waitTurn(db, auto.turnId);
    process.env.DEEPSEEK_API_KEY = 'synthetic-deepseek-key'; clearSecretCache();
    const picked = engine.send({ threadId: t.id, content: 'c', search: 'deepseek' });
    await waitTurn(db, picked.turnId);
    const started = store.eventsAfter(db, t.id, 0).filter((e) => e.type === 'turn.started').map((e) => (e.payload as any).search);
    assert.deepEqual(started, [cfg.searchProvider, 'deepseek']);
    assert.notEqual(cfg.searchProvider, 'deepseek', 'the shared config is not changed by a per-message pick');
  } finally {
    if (saved === undefined) delete process.env.DEEPSEEK_API_KEY; else process.env.DEEPSEEK_API_KEY = saved;
    clearSecretCache();
  }
});

test('chat list preview is the latest assistant text, plain', async () => {
  const { db, engine } = setup(() => [{ type: 'text', text: '## Summary\n**NVDA** beat   the midpoint.' }]);
  const t = store.createThread(db);
  assert.equal(store.threadPreview(db, t.id), '');
  const r = engine.send({ threadId: t.id, content: 'How did NVDA do?' });
  await waitTurn(db, r.turnId);
  assert.equal(store.threadPreview(db, t.id), 'Summary NVDA beat the midpoint.');
});

test('council gate rejects before mutation; enabled runs persist real activity and immutable lens', async () => {
  const { cfg, db, engine } = setup(() => [{ type: 'text', text: JSON.stringify({ findings: [], unresolvedQuestions: ['No policy or filings supplied'] }) }], { turnUsd: 2 });
  const t = store.createThread(db);
  assert.throws(() => engine.send({ threadId: t.id, content: '/committee synthetic company' }), (e: any) => e.code === 'FEATURE_DISABLED');
  assert.equal(store.listMessages(db, t.id).length, 0);
  cfg.council = true;
  assert.throws(() => engine.send({ threadId: t.id, content: '/committee' }), (e: any) => e.code === 'BAD_INPUT');
  const sent = engine.send({ threadId: t.id, content: '/committee synthetic company', lens: 'growth', pageContext: { symbol: 'NVDA', account: 'main', base: 'SGD' } });
  assert.equal(await waitTurn(db, sent.turnId), 'succeeded');
  const events = store.eventsAfter(db, t.id, 0).filter((e) => e.type === 'council.progress');
  assert.equal(events.length, 14);
  assert.ok(store.listMessages(db, t.id).some((m) => m.blocks.some((b) => b.type === 'notice' && b.kind === 'council_evidence' && b.text.includes('get_quote'))));
  assert.ok(store.listMessages(db, t.id).some((m) => m.blocks.some((b) => b.type === 'notice' && b.kind === 'lens' && b.text === 'growth:1')));
  assert.equal(store.getTrace(db, sent.turnId).length, 7);
  assert.ok(store.listMessages(db, t.id).filter((m) => m.role === 'assistant').some((m) => m.blocks.some((b) => b.type === 'text' && b.text.includes('No policy or filings supplied'))));
});

test('failed council provider calls retain daily reservations and report unknown cost', async () => {
  const { cfg, db, engine } = setup(() => { throw Error('provider disconnected after dispatch'); }, { turnUsd: 2 });
  cfg.council = true;
  const t = store.createThread(db);
  const sent = engine.send({ threadId: t.id, content: '/committee synthetic company' });
  await waitTurn(db, sent.turnId);
  const reserved = db.prepare("SELECT SUM(usd) total FROM cost_ledger WHERE kind='council-reserved'").get() as {total: number};
  assert.ok(reserved.total > 0);
  const finish = store.eventsAfter(db, t.id, 0).find((e) => e.type === 'turn.finished');
  assert.equal((finish?.payload as any)?.costUsd, null);
});

test('unqualified council model is rejected before turn or message mutation', () => {
 const { cfg, db, engine } = setup(() => { throw Error('Must not dispatch'); }); cfg.council = true;
 engine.setBrain('unqualified', mockBrain({ ...manifest, id: 'unqualified', transport: 'openai-compatible' }, () => { throw Error('Must not dispatch'); }));
 const thread = store.createThread(db);
 assert.throws(() => engine.send({ threadId: thread.id, content: '/committee ACME', brain: 'unqualified' }), (e: any) => e.code === 'COUNCIL_MODEL_UNQUALIFIED');
 assert.equal(store.listMessages(db, thread.id).length, 0);
 assert.equal(store.getThread(db, thread.id)?.version, thread.version);
});
