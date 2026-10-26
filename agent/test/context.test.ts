import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { loadConfig } from '../src/config.ts';
import { openDb } from '../src/store/db.ts';
import * as store from '../src/store/db.ts';
import { saveUpload, documentText, ensureDocumentText, attachmentBlock } from '../src/uploads.ts';
import { attachmentTools } from '../src/tools/attachments.ts';
import { ToolRegistry } from '../src/tools/registry.ts';
import type { ToolCtx } from '../src/tools/registry.ts';
import { BrainManifest, costOf } from '../src/brains/types.ts';
import type { ApiBrain } from '../src/brains/types.ts';
import { inputBudget, selectContext, contextSize, IMAGE_CONTEXT_TOKENS, bytes, bytePrefix } from '../src/chat/context.ts';
import { ChatEngine } from '../src/chat/engine.ts';
import { EventBus } from '../src/chat/bus.ts';
import type { Msg } from '../src/types.ts';

const manifest = (capacity = 1_000_000) => BrainManifest.parse({ apiVersion: 1, kind: 'brain', id: 'context-test', label: 'Context test', transport: 'mock', model: 'test', pricing: { inputPerM: 0, outputPerM: 0, version: 'test' }, capabilities: { tools: true, streaming: true, contextTokens: capacity }, maxOutputTokens: 1000, costTier: '$' });
const text = (value: string): Msg => ({ role: 'user', blocks: [{ type: 'text', text: value }] });
const tail = 'TAIL_EVIDENCE_7392';
function fixture(t: { after: (fn: () => void | Promise<void>) => void }) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-context-'));
  const cfg = loadConfig({ AGENT_HOME: home, FINSIGHT_DATA_DIR: home, RECORDS_DIR: home } as NodeJS.ProcessEnv);
  const db = openDb(':memory:'); const thread = store.createThread(db);
  const finsight = { get: async () => { throw new Error('No network in context fixture'); } };
  const reg = new ToolRegistry().add(...attachmentTools);
  const bus = new EventBus(db);
  const engine = new ChatEngine({ cfg, db, tools: reg, brains: new Map(), finsight, bus });
  const ctx: ToolCtx = { cfg, db, finsight, signal: new AbortController().signal, threadId: thread.id, budget: { searches: 0, fetches: 0 }, citations: [] };
  t.after(async () => { await engine.drain(); db.close(); fs.rmSync(home, { recursive: true, force: true }); });
  return { home, cfg, db, thread, reg, engine, ctx };
}
async function wait(db: ReturnType<typeof openDb>, turnId: string) {
  for (let i = 0; i < 400; i++) {
    const row = db.prepare('SELECT status,error FROM turns WHERE id=?').get(turnId) as { status: string; error: string };
    if (row.status !== 'running') return row;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error('turn did not finish');
}

test('full extracted text and a tail beyond both old cutoffs survive upload', async (t) => {
  const f = fixture(t), full = 'x'.repeat(350_000) + tail;
  const upload = await saveUpload(f.home, 'report.txt', Buffer.from(full).toString('base64'));
  assert.equal(upload.chars, full.length);
  assert.equal(documentText(f.home, upload.id), full);
  assert.equal((await ensureDocumentText(f.home, upload.id)).text, full);
  assert.equal(fs.statSync(path.join(f.home, 'uploads', upload.id, 'extracted.txt')).mode & 0o777, 0o600);
});

test('legacy capped extracts recover from the original; a missing original is explicitly incomplete', async (t) => {
  const f = fixture(t), full = 'x'.repeat(250_000) + tail;
  const upload = await saveUpload(f.home, 'old.txt', Buffer.from(full).toString('base64'));
  const dir = path.join(f.home, 'uploads', upload.id), meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  delete meta.extractionVersion; meta.chars = 200_000;
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta)); fs.writeFileSync(path.join(dir, 'extracted.txt'), full.slice(0, 200_000));
  assert.equal((await ensureDocumentText(f.home, upload.id)).text, full);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8')).chars, full.length);
  delete meta.extractionVersion; fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta)); fs.unlinkSync(path.join(dir, 'old.txt'));
  const incomplete = await ensureDocumentText(f.home, upload.id);
  assert.equal(incomplete.complete, false); assert.match(incomplete.warning!, /Re-upload/);
});

test('paged document tools find tail evidence, escape literal queries and reject other threads/paths', async (t) => {
  const f = fixture(t), full = 'x'.repeat(300_000) + '[net.*] ' + tail;
  const doc = await saveUpload(f.home, 'report.txt', Buffer.from(full).toString('base64'));
  const foreign = await saveUpload(f.home, 'private.txt', Buffer.from('OTHER_THREAD_SECRET').toString('base64'));
  store.appendMessage(f.db, f.thread.id, 'user', [attachmentBlock(doc)]);
  const other = store.createThread(f.db); store.appendMessage(f.db, other.id, 'user', [attachmentBlock(foreign)]);
  const search = JSON.parse((await f.reg.execute('search_attachments', { query: '[net.*]' }, f.ctx)).content);
  assert.equal(search.results.length, 1); assert.equal(search.results[0].offset, 300_000);
  const read = JSON.parse((await f.reg.execute('read_attachment', { id: doc.id, offset: search.results[0].offset, length: 100 }, f.ctx)).content);
  assert.match(read.text, /TAIL_EVIDENCE/); assert.equal(read.nextOffset, null); assert.equal(read.completeExtraction, true);
  assert.equal((await f.reg.execute('read_attachment', { id: foreign.id }, f.ctx)).ok, false);
  assert.equal((await f.reg.execute('read_attachment', { id: '../../secret' }, f.ctx)).ok, false);
  const list = JSON.parse((await f.reg.execute('list_attachments', {}, f.ctx)).content);
  assert.equal(list.total, 1); assert.equal(list.attachments[0].id, doc.id);
  assert.equal((await f.reg.execute('list_attachments', {}, { ...f.ctx, threadId: undefined })).ok, false);
});

test('model capacity, system/tool menus and output reserves determine context budget', () => {
  const small = manifest(100_000), big = manifest();
  assert.ok(inputBudget(big, 'system', []) > inputBudget(small, 'system', []));
  assert.ok(inputBudget(small, 's'.repeat(5000), []) < inputBudget(small, 's', []));
  assert.ok(inputBudget(small, 's', [{ name: 'x', description: 'x'.repeat(5000), parameters: {} }]) < inputBudget(small, 's', []));
  assert.ok(inputBudget({ ...small, maxOutputTokens: 20_000 }, 's', []) < inputBudget(small, 's', []));
  assert.equal(bytePrefix('漢字🙂', 7), '漢');
  assert.ok(bytes(bytePrefix('\"'.repeat(10000), 1000)) <= 1000);
});

test('context eviction keeps whole turns, counts hidden provider state and never drops the current turn', () => {
  const old: Msg[] = [text('Old user'), { role: 'assistant', blocks: [{ type: 'tool_call', id: 'old', name: 'x', args: {} }], providerExtra: { brain: 'context-test', data: 'private'.repeat(3000) } }, { role: 'tool', blocks: [{ type: 'tool_result', callId: 'old', name: 'x', ok: true, content: 'result' }] }];
  const current = [text('CURRENT_USER'), text('[Context snapshot')];
  const r = selectContext([...old, ...current], 5000, [true, false, false, true, false]);
  assert.equal(r.omitted, 3); assert.match(JSON.stringify(r.messages), /CURRENT_USER/); assert.doesNotMatch(JSON.stringify(r.messages), /"callId":"old"/);
  assert.match(JSON.stringify(r.messages), /Earlier conversation/);
  assert.ok(bytes(r.messages) <= 5000);
  const calls: Msg[] = [text('latest'), { role: 'assistant', blocks: [{ type: 'tool_call', id: 'new', name: 'x', args: {} }] }, { role: 'tool', blocks: [{ type: 'tool_result', callId: 'new', name: 'x', ok: true, content: 'y'.repeat(8000) }] }];
  assert.throws(() => selectContext(calls, 1000, [true, false, false]), (e: unknown) => (e as { code: string }).code === 'CONTEXT_TOO_LARGE');
});

test('large-context model actually receives evidence beyond 200k, not just attachment metadata', async (t) => {
  const f = fixture(t), full = 'x'.repeat(250_000) + tail;
  const doc = await saveUpload(f.home, 'analysis.txt', Buffer.from(full).toString('base64'));
  let observed = '';
  const brain: ApiBrain = { kind: 'api', manifest: manifest(), async step(req) { observed = JSON.stringify(req.messages); return { blocks: [{ type: 'text', text: 'Done' }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'end' }; } };
  f.engine.setBrain('context-test', brain);
  const result = f.engine.send({ threadId: f.thread.id, content: 'Find the last evidence.', brain: 'context-test', attachmentIds: [doc.id] });
  assert.equal((await wait(f.db, result.turnId)).status, 'succeeded');
  assert.ok(observed.includes(tail));
});

test('small-context document preview discloses omissions and retrieves the omitted tail through a tool round trip', async (t) => {
  const f = fixture(t), doc = await saveUpload(f.home, 'large.txt', Buffer.from('x'.repeat(250_000) + tail).toString('base64'));
  let step = 0;
  f.engine.setBrain('context-test', { kind: 'api', manifest: manifest(100_000), async step(req) {
    const data = JSON.stringify(req.messages);
    if (!step++) {
      assert.match(data, /Only characters/); assert.ok(!data.includes(tail));
      return { blocks: [{ type: 'tool_call', id: 'read-tail', name: 'read_attachment', args: { id: doc.id, offset: 250_000, length: 100 } }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'tool_use' };
    }
    assert.ok(data.includes(tail));
    return { blocks: [{ type: 'text', text: 'Tail read' }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'end' };
  } });
  const result = f.engine.send({ threadId: f.thread.id, content: 'Read the final evidence.', brain: 'context-test', attachmentIds: [doc.id] });
  assert.equal((await wait(f.db, result.turnId)).status, 'succeeded'); assert.equal(step, 2);
  assert.ok(store.eventsAfter(f.db, f.thread.id, 0).some((e) => e.type === 'budget.warning' && (e.payload as { scope?: string }).scope === 'context'));
});

test('oversized current request fails explicitly before a provider call and retains stored input', async (t) => {
  const f = fixture(t); let called = false;
  f.engine.setBrain('context-test', { kind: 'api', manifest: manifest(5000), async step() { called = true; throw new Error('must not call'); } });
  const result = f.engine.send({ threadId: f.thread.id, content: 'z'.repeat(12_000), brain: 'context-test' });
  const row = await wait(f.db, result.turnId); assert.equal(row.status, 'failed'); assert.match(row.error, /context capacity/); assert.equal(called, false);
  assert.ok(JSON.stringify(store.listMessages(f.db, f.thread.id)).includes('z'.repeat(12_000)));
});

test('long-context pricing includes full prompt, cached reads/writes and output at the correct tier boundary', () => {
  for (const [name, threshold, im, om] of [['haiku', 100_000, 5, 5], ['gpt-6-luna', 272_000, 2, 1.5]] as const) {
    const m = BrainManifest.parse(JSON.parse(fs.readFileSync(new URL(`../plugins/brains/${name}/manifest.json`, import.meta.url), 'utf8')));
    const usage = { inputTokens: threshold, outputTokens: 1000, cacheReadTokens: 1000, cacheWriteTokens: 1000 };
    const base = ((threshold - 2000) * .1 + 1000 * .01 + 1000 * .125 + 1000 * .5) / 1e6;
    assert.equal(costOf(m, usage), base);
    const expected = (((threshold - 1999) * .1 + 1000 * .01 + 1000 * .125) * im + 1000 * .5 * om) / 1e6;
    assert.equal(costOf(m, { ...usage, inputTokens: threshold + 1 }), expected);
  }
});

// A valid one-pixel PNG padded with a legal tEXt chunk: encoded byte size
// varies independently of visual resolution, precisely the context-budget bug.
function paddedPng(size: number): Buffer {
  const chunk = (type: string, data: Buffer) => {
    const label = Buffer.from(type), length = Buffer.alloc(4), crc = Buffer.alloc(4);
    length.writeUInt32BE(data.length); crc.writeUInt32BE(crc32(Buffer.concat([label, data])));
    return Buffer.concat([length, label, data, crc]);
  };
  const sig = Buffer.from('89504e470d0a1a0a', 'hex');
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  const head = chunk('IHDR', ihdr), image = chunk('IDAT', deflateSync(Buffer.from([0, 255, 0, 0, 255]))), end = chunk('IEND', Buffer.alloc(0));
  const padding = Buffer.alloc(size - sig.length - head.length - image.length - end.length - 12, 65);
  Buffer.from('Comment\0').copy(padding);
  return Buffer.concat([sig, head, chunk('tEXt', padding), image, end]);
}

for (const [id, size] of [['haiku', 1024 * 1024], ['gpt-6-luna', 1024 * 1024], ['gpt-6-sol', 210_000], ['haiku', 15 * 1024 * 1024]] as const) {
  test(`image send: ${id} accepts ${size} upload bytes without treating base64 as text context`, async (t) => {
    const f = fixture(t);
    const buffer = paddedPng(size); assert.equal(buffer.length, size);
    const upload = await saveUpload(f.home, 'synthetic-image.png', buffer.toString('base64'));
    const m = BrainManifest.parse(JSON.parse(fs.readFileSync(new URL(`../plugins/brains/${id}/manifest.json`, import.meta.url), 'utf8')));
    let imageReceived = false;
    f.engine.setBrain(id, { kind: 'api', manifest: m, async step(req) {
      const images = req.messages.flatMap((x) => x.blocks).filter((b) => b.type === 'image');
      assert.equal(images.length, 1); assert.equal(Buffer.from(images[0]!.data, 'base64').length, size); imageReceived = true;
      return { blocks: [{ type: 'text', text: 'Image received' }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'end' };
    } });
    const turn = f.engine.send({ threadId: f.thread.id, content: 'Read this image', brain: id, attachmentIds: [upload.id] });
    assert.equal((await wait(f.db, turn.turnId)).status, 'succeeded'); assert.equal(imageReceived, true);
  });
}

test('switching models removes empty foreign state-only messages after stripping provider metadata', async (t) => {
  const f = fixture(t);
  store.appendMessage(f.db, f.thread.id, 'user', [{ type: 'text', text: 'Old question' }]);
  store.appendMessage(f.db, f.thread.id, 'assistant', [], { providerExtra: { brain: 'deepseek-flash', data: { reasoning_content: 'PRIVATE' } } });
  let called = false;
  f.engine.setBrain('context-test', { kind: 'api', manifest: manifest(), async step(req) {
    assert.ok(req.messages.every((m) => m.blocks.length > 0)); called = true;
    return { blocks: [{ type: 'text', text: 'Done' }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'end' };
  } });
  const turn = f.engine.send({ threadId: f.thread.id, content: 'New model', brain: 'context-test' });
  assert.equal((await wait(f.db, turn.turnId)).status, 'succeeded'); assert.equal(called, true);
});

test('same-brain state-only messages remain available for protocol replay', async (t) => {
  const f = fixture(t);
  store.appendMessage(f.db, f.thread.id, 'user', [{ type: 'text', text: 'Old question' }]);
  store.appendMessage(f.db, f.thread.id, 'assistant', [], { providerExtra: { brain: 'context-test', data: { reasoning_content: 'PRIVATE' } } });
  f.engine.setBrain('context-test', { kind: 'api', manifest: manifest(), async step(req) {
    assert.ok(req.messages.some((m) => !m.blocks.length && m.providerExtra?.brain === 'context-test'));
    return { blocks: [{ type: 'text', text: 'Done' }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'end' };
  } });
  const turn = f.engine.send({ threadId: f.thread.id, content: 'Same model', brain: 'context-test' });
  assert.equal((await wait(f.db, turn.turnId)).status, 'succeeded');
});

test('failed new extraction is recorded and not attempted again every model step', async (t) => {
  const f = fixture(t);
  const upload = await saveUpload(f.home, 'broken.docx', Buffer.from('504b030400000000', 'hex').toString('base64'));
  const dir = path.join(f.home, 'uploads', upload.id), metaFile = path.join(dir, 'meta.json');
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  assert.equal(meta.extractionVersion, 2); assert.equal(meta.extractionStatus, 'failed');
  // A now-readable original must not cause an automatic retry of a recorded
  // failure. Re-uploading creates a new attempt instead.
  fs.writeFileSync(path.join(dir, 'broken.docx'), 'would be readable now');
  fs.writeFileSync(metaFile, JSON.stringify({ ...meta, mime: 'text/plain' }));
  for (let i = 0; i < 3; i++) {
    const result = await ensureDocumentText(f.home, upload.id);
    assert.equal(result.complete, false); assert.ok(!result.text); assert.match(result.warning!, /Re-upload/);
  }
});

test('failed legacy recovery is attempted once, retaining existing extracted text and warning', async (t) => {
  const f = fixture(t), upload = await saveUpload(f.home, 'legacy.txt', Buffer.from('original tail').toString('base64'));
  const dir = path.join(f.home, 'uploads', upload.id), metaFile = path.join(dir, 'meta.json');
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8')); delete meta.extractionVersion; delete meta.extractionStatus;
  fs.writeFileSync(metaFile, JSON.stringify(meta)); fs.writeFileSync(path.join(dir, 'extracted.txt'), 'old partial'); fs.unlinkSync(path.join(dir, 'legacy.txt'));
  assert.equal((await ensureDocumentText(f.home, upload.id)).complete, false);
  fs.writeFileSync(path.join(dir, 'legacy.txt'), 'restored original should not trigger a per-step retry');
  for (let i = 0; i < 3; i++) {
    const result = await ensureDocumentText(f.home, upload.id); assert.equal(result.complete, false); assert.equal(result.text, 'old partial'); assert.match(result.warning!, /Re-upload/);
  }
});

test('multi-document search cursor pages all matches once, including transitions to earlier offsets in the next file', async (t) => {
  const f = fixture(t), contents = ['needle----needle', 'xneedle', 'needle' + 'x'.repeat(50) + 'needle'];
  const uploads = [];
  for (let i = 0; i < contents.length; i++) {
    const u = await saveUpload(f.home, `doc${i}.txt`, Buffer.from(contents[i]!).toString('base64')); uploads.push(u);
    store.appendMessage(f.db, f.thread.id, 'user', [attachmentBlock(u)]);
  }
  const all: string[] = []; let cursor: { id: string; offset: number } | undefined;
  for (let n = 0; n < 10; n++) {
    const response = await f.reg.execute('search_attachments', { query: 'needle', limit: 1, cursor }, f.ctx);
    assert.equal(response.ok, true); const page = JSON.parse(response.content);
    all.push(...page.results.map((r: { id: string; offset: number }) => `${r.id}:${r.offset}`));
    if (!page.hasMore) { assert.equal(page.nextCursor, null); break; }
    assert.ok(page.nextCursor?.id); assert.equal(typeof page.nextCursor.offset, 'number'); cursor = page.nextCursor;
  }
  assert.deepEqual(all, [`${uploads[0]!.id}:0`, `${uploads[0]!.id}:10`, `${uploads[1]!.id}:1`, `${uploads[2]!.id}:0`, `${uploads[2]!.id}:56`]);
  assert.equal((await f.reg.execute('search_attachments', { query: 'needle', offset: 1 }, f.ctx)).ok, false, 'global scalar offsets are ambiguous');
  const foreign = await saveUpload(f.home, 'other.txt', Buffer.from('needle').toString('base64'));
  assert.equal((await f.reg.execute('search_attachments', { query: 'needle', cursor: { id: foreign.id, offset: 0 } }, f.ctx)).ok, false);
});


test('image budget charges a fixed estimate per image, independent of encoded payload length', () => {
  const image = (data: string): Msg => ({ role: 'user', blocks: [{ type: 'image', mime: 'image/png', name: 'chart', data }] });
  assert.equal(contextSize([image('a')]), contextSize([image('a'.repeat(2_000_000))]));
  assert.equal(contextSize([image('a')]), bytes([image('')]) + IMAGE_CONTEXT_TOKENS);
  assert.throws(() => selectContext([image('a')], IMAGE_CONTEXT_TOKENS - 1), (e: unknown) => (e as { code: string }).code === 'CONTEXT_TOO_LARGE');
});
