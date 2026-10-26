import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { z } from 'zod';
import { loadConfig } from '../src/config.ts';
import { BrainManifest } from '../src/brains/types.ts';
import { openAiBrain, toOpenAiMessages } from '../src/brains/openai.ts';
import { toAnthropicMessages } from '../src/brains/anthropic.ts';
import { openDb } from '../src/store/db.ts';
import * as store from '../src/store/db.ts';
import { ToolRegistry } from '../src/tools/registry.ts';
import { ChatEngine } from '../src/chat/engine.ts';
import { EventBus } from '../src/chat/bus.ts';
import type { Msg } from '../src/types.ts';

const manifest = () => BrainManifest.parse(JSON.parse(fs.readFileSync(new URL('../plugins/brains/deepseek-flash/manifest.json', import.meta.url), 'utf8')));
const identity = { brain: 'deepseek-flash', model: 'deepseek-flash', origin: 'https://api.deepseek.com' };
function streamed(parts: unknown[], finish = 'tool_calls') {
  // UTF-8 split in the middle of code points; no final newline, including usage.
  const wire = parts.map((delta) => 'data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\n').join('')
    + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: finish }], usage: { prompt_tokens: 10, completion_tokens: 20 } });
  const raw = Buffer.from(wire);
  return new Response(new ReadableStream({ start(c) { for (let i = 0; i < raw.length; i += 3) c.enqueue(raw.subarray(i, i + 3)); c.close(); } }));
}

test('DeepSeek state survives streamed tool rounds and DB reopen, and stays out of UI/events/other providers', async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-reasoning-'));
  let db = openDb(path.join(home, 'test.db'));
  let engine: ChatEngine | undefined;
  try {
    const cfg = loadConfig({ AGENT_HOME: home, FINSIGHT_DATA_DIR: home, RECORDS_DIR: home } as NodeJS.ProcessEnv);
    const registry = new ToolRegistry().add({ name: 'lookup', description: 'Synthetic lookup', input: z.object({}), async handler() { return { ok: true }; } });
    let round = 0;
    const brain = openAiBrain(manifest(), 'synthetic-test', async (_url, init) => {
      const body = JSON.parse(String(init?.body)); const assistants = body.messages.filter((m: { role: string }) => m.role === 'assistant');
      for (let i = 0; i < assistants.length; i++) assert.equal(assistants[i].reasoning_content, `PRIVATE_STATE_${i}_漢字`);
      const n = round++;
      return n < 2 ? streamed([{ reasoning_content: `PRIVATE_STATE_${n}_` }, { reasoning_content: '漢字' }, { tool_calls: [{ index: 0, id: `call${n}`, function: { name: 'lookup', arguments: '{}' } }] }])
        : streamed([{ reasoning_content: `PRIVATE_STATE_${n}_漢字` }, { content: 'Public answer' }], 'stop');
    });
    const makeEngine = () => new ChatEngine({ cfg, db, tools: registry, brains: new Map(), finsight: { get: async () => { throw new Error('synthetic no portfolio'); } }, bus: new EventBus(db) });
    engine = makeEngine(); engine.setBrain('deepseek-flash', brain);
    const thread = store.createThread(db);
    const turn = engine.send({ threadId: thread.id, content: 'Use two tools', brain: 'deepseek-flash' });
    for (let i = 0; i < 400 && engine.isRunning(thread.id); i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal((db.prepare('SELECT status FROM turns WHERE id=?').get(turn.turnId) as { status: string }).status, 'succeeded');
    assert.equal(round, 3);
    const messages = store.listMessages(db, thread.id);
    const assistant = messages.filter((m) => m.role === 'assistant');
    assert.equal(assistant.length, 3);
    for (const m of assistant) assert.ok(m.providerExtra);
    assert.doesNotMatch(JSON.stringify(messages.map((m) => m.blocks)), /PRIVATE_STATE/);
    assert.doesNotMatch(JSON.stringify(store.eventsAfter(db, thread.id, 0)), /PRIVATE_STATE/);
    await engine.drain(); db.close(); db = openDb(path.join(home, 'test.db'));
    const restored = store.listMessages(db, thread.id);
    const own = toOpenAiMessages('system', restored, identity);
    assert.equal(own.filter((m) => m.role === 'assistant')[2].reasoning_content, 'PRIVATE_STATE_2_漢字');
    assert.doesNotMatch(JSON.stringify(toOpenAiMessages('system', restored, { ...identity, origin: 'https://api.openai.com' })), /PRIVATE_STATE/);
    assert.doesNotMatch(JSON.stringify(toOpenAiMessages('system', restored, { ...identity, model: 'other-model' })), /PRIVATE_STATE/);
    assert.doesNotMatch(JSON.stringify(toOpenAiMessages('system', restored, { ...identity, brain: 'other-brain' })), /PRIVATE_STATE/);
    assert.doesNotMatch(JSON.stringify(toAnthropicMessages('haiku', restored)), /PRIVATE_STATE/);
    engine = makeEngine(); engine.setBrain('deepseek-flash', brain);
    engine.send({ threadId: thread.id, content: 'Follow-up after reopening', brain: 'deepseek-flash' });
    for (let i = 0; i < 400 && engine.isRunning(thread.id); i++) await new Promise((r) => setTimeout(r, 5));
    assert.equal(round, 4);
  } finally { await engine?.drain(); db.close(); fs.rmSync(home, { recursive: true, force: true }); }
});

for (const finish of ['length', 'content_filter']) {
  test(`DeepSeek ${finish}: incomplete tool calls are never returned for execution`, async () => {
    const brain = openAiBrain(manifest(), 'synthetic-test', async () => streamed([{ reasoning_content: 'PRIVATE_INCOMPLETE' }, { tool_calls: [{ index: 0, id: 'incomplete', function: { name: 'lookup', arguments: '{' } }] }], finish));
    const result = await brain.step({ system: 'system', messages: [{ role: 'user', blocks: [{ type: 'text', text: 'test' }] }], tools: [], signal: new AbortController().signal, onText: () => {} });
    assert.equal(result.stopReason, finish === 'length' ? 'max_tokens' : 'refusal');
    assert.equal(result.blocks.some((b) => b.type === 'tool_call'), false); assert.equal(result.providerExtra, undefined);
    assert.equal(result.usage.outputTokens, 20);
  });
}

test('legacy DeepSeek history sends an empty state, never foreign provider metadata', () => {
  const msg: Msg = { role: 'assistant', blocks: [{ type: 'text', text: 'Old answer' }], providerExtra: { brain: 'haiku', data: [{ thinking: 'PRIVATE_FOREIGN_STATE' }] } };
  const own = toOpenAiMessages('system', [msg], identity);
  assert.equal(own[1].reasoning_content, ''); assert.doesNotMatch(JSON.stringify(own), /PRIVATE_FOREIGN_STATE/);
});

test('an interrupted stream cannot execute a tool call without a completion marker', async () => {
  const body = 'data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'cut', function: { name: 'lookup', arguments: '{}' } }] } }] }) + '\n\n';
  const brain = openAiBrain(manifest(), 'synthetic-test', async () => new Response(body));
  await assert.rejects(brain.step({ system: 'system', messages: [], tools: [], signal: new AbortController().signal, onText: () => {} }), (e: unknown) => (e as Error).message.includes('completion marker'));
});
