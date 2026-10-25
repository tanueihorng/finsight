import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkBuild, createChunkGuard, hasUnsavedInput, MARKER_PREFIX } from './chunkGuard.ts';

function harness() {
  const values = new Map<string, string>(), callbacks: (() => void)[] = [];
  let reloads = 0, input = false;
  const storage = { getItem: (k: string) => values.get(k) ?? null, setItem: (k: string, v: string) => { values.set(k, v); }, removeItem: (k: string) => { values.delete(k); } };
  const env = { storage: () => storage, reload: () => { reloads++; }, hasInput: () => input, afterBoot: (cb: () => void) => { callbacks.push(cb); } };
  return { values, storage, env, reloads: () => reloads, input: () => { input = true; }, boot: () => { callbacks.splice(0).forEach((cb) => cb()); } };
}
const error = new TypeError('Failed to fetch dynamically imported module: missing chunk');
const broken = async () => { throw error; };
const good = async () => ({ default: 'ok' });

test('one reload across documents, concurrent failures and successful unrelated imports cannot reset fuse', async () => {
  const h = harness();
  for (let document = 0; document < 3; document++) {
    const wrap = createChunkGuard('build', h.env);
    await wrap(good)(); h.boot();
    await Promise.all(Array.from({ length: 8 }, () => assert.rejects(wrap(broken)(), (e) => e === error)));
    h.boot();
  }
  assert.equal(h.reloads(), 1);
});
test('successful boot clears only the recovered failed import, not another build', async () => {
  const h = harness(); let missing = true;
  const loader = async () => { if (missing) throw error; return 42; };
  await assert.rejects(createChunkGuard('a', h.env)(loader)());
  missing = false;
  await createChunkGuard('b', h.env)(loader)(); h.boot();
  assert.equal(h.values.size, 1);
  await createChunkGuard('a', h.env)(loader)(); h.boot();
  assert.equal(h.values.size, 0);
});
test('input, blocked storage, and silent storage write failure skip reload and preserve original error', async () => {
  for (const mode of ['input', 'denied', 'silent']) {
    const h = harness();
    if (mode === 'input') h.input();
    if (mode === 'denied') h.env.storage = () => { throw Error('denied'); };
    if (mode === 'silent') h.storage.setItem = () => {};
    await assert.rejects(createChunkGuard('a', h.env)(broken)(), (e) => e === error);
    assert.equal(h.reloads(), 0); assert.equal(h.values.size, 0);
  }
});
test('failure during a recovery boot retains its fuse', async () => {
  const h = harness(); h.values.set(MARKER_PREFIX + 'a', String(good));
  const wrap = createChunkGuard('a', h.env);
  await wrap(good)(); await assert.rejects(wrap(broken)()); h.boot();
  assert.equal(h.values.size, 1); assert.equal(h.reloads(), 0);
});
test('build signature follows chunk loader graph and is independent of insertion order', () => {
  assert.equal(chunkBuild({ a: good, b: broken }), chunkBuild({ b: broken, a: good }));
  assert.notEqual(chunkBuild({ a: good }), chunkBuild({ a: broken }));
});
test('PIN/chat/form values and contenteditable drafts prevent reload', () => {
  for (const type of ['password', 'text', 'textarea', 'number']) {
    const doc = { querySelectorAll: (selector: string) => selector === 'input, textarea' ? [{ type, value: 'draft' }] : [] } as unknown as Document;
    assert.equal(hasUnsavedInput(doc), true);
  }
  const doc = { querySelectorAll: (selector: string) => selector === 'input, textarea' ? [{ type: 'hidden', value: 'default' }] : [{ textContent: 'draft' }] } as unknown as Document;
  assert.equal(hasUnsavedInput(doc), true);
});

test('ordinary loader exceptions go directly to the boundary without a reload', async () => {
  const h = harness();
  for (const error of [new Error('fixture chunk failure'), new TypeError('application bug')]) {
    await assert.rejects(createChunkGuard('a', h.env)(async () => { throw error; })(), (e) => e === error);
  }
  assert.equal(h.reloads(), 0); assert.equal(h.values.size, 0);
});
test('an import that already resolved stays synchronous through the guard (H1: no Suspense fallback)', () => {
  const h = harness();
  const ready = { then: (ok: (v: number) => unknown) => ok(7) } as unknown as Promise<number>;
  let seen: number | undefined;
  void createChunkGuard('build', h.env)(() => ready)().then((v) => { seen = v; });
  assert.equal(seen, 7);
  h.boot();
  assert.equal(h.reloads(), 0);
});
