import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { BrainManifest } from '../src/brains/types.ts';
import { responsesBrain, toResponsesInput } from '../src/brains/responses.ts';
import { openAiBrain } from '../src/brains/openai.ts';
import { ChatEngine } from '../src/chat/engine.ts';
import { EventBus } from '../src/chat/bus.ts';
import { openDb, createThread, listMessages, eventsAfter, spendSince } from '../src/store/db.ts';
import { loadConfig } from '../src/config.ts';
import { ToolRegistry } from '../src/tools/registry.ts';
import { z } from 'zod';

const manifest = (id: string) => BrainManifest.parse(JSON.parse(fs.readFileSync(new URL(`../plugins/brains/${id}/manifest.json`, import.meta.url), 'utf8')));
const req = { system: 'system', messages: [], tools: [], signal: new AbortController().signal, onText: (_: string) => {} };
const identity = { brain: 'gpt-6-luna', model: 'gpt-6-luna', origin: 'https://api.openai.com' };
const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque-test-only' };
const call = { type: 'function_call', id: 'fc_1', call_id: 'call_1', name: 'test_cash', arguments: '{}' };
const message = { type: 'message', id: 'msg_1', role: 'assistant', content: [{ type: 'output_text', text: 'Cash €42.', annotations: [] }] };
const usage = { input_tokens: 1000, output_tokens: 200, input_tokens_details: { cached_tokens: 400 }, output_tokens_details: { reasoning_tokens: 180 } };
function stream(events: any[]) {
  const bytes = new TextEncoder().encode(events.map((e) => `event: ${e.type}\r\ndata: ${JSON.stringify(e)}\r\n\r\n`).join(''));
  return new Response(new ReadableStream({ start(c) { for (let i = 0; i < bytes.length; i += 3) c.enqueue(bytes.slice(i, i + 3)); c.close(); } }));
}
const completed = (output: any[]) => ({ type: 'response.completed', response: { status: 'completed', output, usage } });

test('Responses supports all OpenAI efforts, uses tool schema and stateless encrypted reasoning; counts reasoning in output usage', async () => {
  for (const id of ['gpt-6-luna', 'gpt-6-sol']) for (const effort of manifest(id).thinking!.levels) {
    let sent: any, url = '', text = '';
    const b = responsesBrain(manifest(id), 'synthetic-key', async (u, o) => {
      url = String(u); sent = JSON.parse(String(o?.body));
      return stream([{ type: 'response.output_text.delta', delta: 'Cash €42.' }, completed([reasoning, message, call])]);
    });
    const r = await b.step({ ...req, effort, tools: [{ name: 'test_cash', description: 'cash', parameters: { type: 'object' } }], onText: (t) => { text += t; } });
    assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(sent.reasoning.effort, effort); assert.equal(sent.store, false);
    assert.deepEqual(sent.include, ['reasoning.encrypted_content']); assert.equal(sent.tools[0].name, 'test_cash'); assert.equal(sent.tools[0].strict, false);
    assert.equal(sent.max_output_tokens, manifest(id).maxOutputTokens); assert.ok(!('reasoning_effort' in sent));
    assert.equal(text, 'Cash €42.'); assert.equal(r.stopReason, 'tool_use'); assert.equal(r.usage.outputTokens, 200);
    assert.equal(r.usage.cacheReadTokens, 400); assert.ok(!JSON.stringify(r.blocks).includes('opaque-test-only'));
    assert.equal((r.providerExtra?.data as any).output[0].encrypted_content, 'opaque-test-only');
  }
});

test('Responses replays exact completed output only for same brain/model/origin; switches reconstruct neutral calls/results and images', () => {
  const messages: any[] = [
    { role: 'user', blocks: [{ type: 'image', mime: 'image/png', data: 'YWJj' }] },
    { role: 'assistant', blocks: [{ type: 'text', text: 'Checking' }, { type: 'tool_call', id: 'call_1', name: 'test_cash', args: {} }], providerExtra: { brain: identity.brain, data: { type: 'openai-responses', model: identity.model, origin: identity.origin, output: [reasoning, call] } } },
    { role: 'tool', blocks: [{ type: 'tool_result', callId: 'call_1', name: 'test_cash', content: '{"cash":42}', ok: true }] },
  ];
  const own = toResponsesInput(messages, identity); assert.deepEqual(own.slice(1, 3), [reasoning, call]);
  assert.equal(own[0].content[0].type, 'input_image'); assert.equal(own[3].call_id, call.call_id);
  for (const other of [{ ...identity, brain: 'gpt-6-sol' }, { ...identity, model: 'different' }, { ...identity, origin: 'https://other.test' }]) {
    const translated = toResponsesInput(messages, other); assert.ok(!JSON.stringify(translated).includes('opaque-test-only'));
    assert.equal(translated.at(-2).call_id, translated.at(-1).call_id); assert.equal(translated[1].role, 'assistant');
  }
});

test('Responses incomplete/refusal never executes partial tools or saves partial opaque state; broken streams fail', async () => {
  for (const reason of ['max_output_tokens', 'content_filter']) {
    const r = await responsesBrain(manifest('gpt-6-luna'), 'test', async () => stream([{ type: 'response.incomplete', response: { status: 'incomplete', output: [reasoning, call], usage, incomplete_details: { reason } } }])).step(req);
    assert.ok(!r.blocks.some((b) => b.type === 'tool_call')); assert.equal(r.providerExtra, undefined);
    assert.equal(r.stopReason, reason === 'content_filter' ? 'refusal' : 'max_tokens');
  }
  const refusal = { ...message, content: [{ type: 'refusal', refusal: 'No' }] };
  const r = await responsesBrain(manifest('gpt-6-luna'), 'test', async () => stream([completed([refusal, call])])).step(req);
  assert.equal(r.stopReason, 'refusal'); assert.equal(r.providerExtra, undefined); assert.equal(r.blocks.length, 0);
  for (const events of [[], [{ type: 'response.failed' }], [{ type: 'error' }]]) {
    await assert.rejects(responsesBrain(manifest('gpt-6-luna'), 'test', async () => stream(events)).step(req));
  }
  const ctrl = new AbortController(); ctrl.abort();
  await assert.rejects(responsesBrain(manifest('gpt-6-luna'), 'test', async (_u, o) => { o?.signal?.throwIfAborted(); throw Error(); }).step({ ...req, signal: ctrl.signal }), (e: any) => e.name === 'AbortError');
  for (const [status, code] of [[400, 'PROVIDER_INVALID'], [429, 'PROVIDER_RATE_LIMIT'], [503, 'PROVIDER_ERROR']] as const) {
    await assert.rejects(responsesBrain(manifest('gpt-6-luna'), 'test', async () => new Response('{}', { status })).step(req), (e: any) => e.code === code);
  }
});

test('DeepSeek off omits reasoning_effort, on sends only supported efforts; default remains high', async () => {
  for (const id of ['deepseek-flash', 'deepseek-pro']) for (const effort of [undefined, ...manifest(id).thinking!.levels]) {
    let sent: any;
    await openAiBrain(manifest(id), 'test', async (_u, o) => {
      sent = JSON.parse(String(o?.body));
      return stream([{ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 2 } }]);
    }).step({ ...req, effort });
    assert.equal(sent.thinking.type, effort === 'none' ? 'disabled' : 'enabled');
    if (effort === 'none') assert.ok(!('reasoning_effort' in sent)); else assert.equal(sent.reasoning_effort, effort ?? 'high');
  }
});

test('engine rejects unsupported efforts before mutation, holds effort across steps, persists/replays encrypted Responses state and records costs', async () => {
  const db = openDb(':memory:');
  try {
    const cfg = loadConfig({ AGENT_HOME: '/tmp/synthetic-effort-test', FINSIGHT_DATA_DIR: '/tmp/synthetic-effort-test' }); cfg.defaultBrain = 'gpt-6-luna';
    const tools = new ToolRegistry().add({ name: 'test_cash', description: 'cash', input: z.object({}), handler: async () => ({ cash: 42 }) });
    let steps = 0;
    const b = responsesBrain(manifest('gpt-6-luna'), 'test', async (_u, o) => {
      const sent = JSON.parse(String(o?.body)); assert.equal(sent.reasoning.effort, 'high'); steps++;
      if (steps === 1) return stream([completed([reasoning, call])]);
      assert.ok(sent.input.some((i: any) => i.encrypted_content === 'opaque-test-only'));
      assert.ok(sent.input.some((i: any) => i.type === 'function_call_output' && i.call_id === 'call_1' && i.output.includes('42')));
      return stream([completed([message])]);
    });
    const engine = new ChatEngine({ cfg, db, tools, bus: new EventBus(db), brains: new Map(), finsight: { get: async () => { throw Error('synthetic'); } } });
    engine.setBrain('gpt-6-luna', b); engine.setBrain('deepseek-pro', openAiBrain(manifest('deepseek-pro'), 'test'));
    const t = createThread(db);
    for (const [brain, effort] of [['gpt-6-luna', 'ultra'], ['deepseek-pro', 'medium']]) assert.throws(() => engine.send({ threadId: t.id, content: 'Cash?', brain, effort: effort as any }), (e: any) => e.code === 'BAD_INPUT');
    assert.equal(listMessages(db, t.id).length, 0);
    const turn = engine.send({ threadId: t.id, content: 'Cash?', effort: 'high' });
    for (let i = 0; i < 200 && engine.isRunning(t.id); i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(steps, 2); assert.ok(eventsAfter(db, t.id, 0).some((e) => e.type === 'turn.finished'));
    assert.equal((eventsAfter(db, t.id, 0).find((e) => e.type === 'turn.started')!.payload as any).effort, 'high');
    assert.ok(spendSince(db, 0) > 0); assert.equal(listMessages(db, t.id).at(-1)?.turnId, turn.turnId);
    assert.ok(!JSON.stringify(listMessages(db, t.id).flatMap((m) => m.blocks)).includes('opaque-test-only'));
  } finally { db.close(); }
});

test('HTTP advertises model thinking levels and rejects invalid/provider-unsupported effort before accepting a turn', async () => {
  const os = await import('node:os'), path = await import('node:path');
  const { createApi } = await import('../src/api/server.ts');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'thinking-api-'));
  const cfg = loadConfig({ AGENT_HOME: home, FINSIGHT_DATA_DIR: home }); cfg.defaultBrain = 'gpt-6-luna';
  fs.writeFileSync(path.join(home, 'agent-link.json'), JSON.stringify({ token: 'synthetic-token', proxySecret: 'synthetic-proxy' }));
  const db = openDb(':memory:'), bus = new EventBus(db), tools = new ToolRegistry();
  const finsight = { get: async () => { throw Error('synthetic'); } };
  const m = manifest('gpt-6-luna');
  const create = () => responsesBrain(m, 'synthetic-key', async () => stream([completed([message])]));
  const brains = new Map([[m.id, { manifest: m, available: true, create }]]);
  const engine = new ChatEngine({ cfg, db, bus, tools, finsight, brains });
  const server = createApi({ cfg, db, bus, tools, finsight, brains, brainsInvalid: [], engine });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const port = (server.address() as import('node:net').AddressInfo).port;
    const http = await import('node:http');
    const request = (route: string, body?: unknown) => new Promise<{ status: number; data: any }>((resolve, reject) => {
      const r = http.request({ hostname: '127.0.0.1', port, path: '/v1' + route, method: body ? 'POST' : 'GET', headers: { host: `127.0.0.1:${cfg.port}`, 'x-agent-secret': 'synthetic-proxy', 'content-type': 'application/json' } }, (res) => {
        let text = ''; res.on('data', (b) => { text += b; }); res.on('end', () => resolve({ status: res.statusCode!, data: JSON.parse(text) }));
      }); r.on('error', reject); r.end(body ? JSON.stringify(body) : undefined);
    });
    const advertised = await request('/brains'); assert.deepEqual(advertised.data.brains[0].thinking, m.thinking);
    const t = createThread(db);
    for (const effort of ['ultra', 3, { high: true }]) assert.equal((await request(`/threads/${t.id}/messages`, { content: 'hello', effort })).status, 400);
    assert.equal(listMessages(db, t.id).length, 0);
    assert.equal((await request(`/threads/${t.id}/messages`, { content: 'hello', effort: 'low' })).status, 202);
    for (let i = 0; i < 200 && engine.isRunning(t.id); i++) await new Promise((r) => setTimeout(r, 10));
    assert.ok(eventsAfter(db, t.id, 0).some((e) => e.type === 'turn.finished'));
  } finally { await engine.drain(); server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); db.close(); fs.rmSync(home, { recursive: true, force: true }); }
});
