import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createApi, ApiError } from './client.ts';
import { createBus, mutationInvalidations } from './invalidation.ts';

test('API maps plain and structured errors, including non-JSON errors', async () => {
  for (const [status, body, message] of [[400, '{"error":"bad input"}', 'bad input'], [503, '{"error":{"code":"OFFLINE","message":"offline"}}', 'offline'], [502, 'not JSON', 'HTTP 502']] as const) {
    const api = createApi(async () => new Response(body, { status }), () => {});
    await assert.rejects(api('/api/test'), (e: unknown) => e instanceof ApiError && e.status === status && e.message === message);
  }
});
test('401 locks before surfacing the HTTP error; successful calls carry cookies and signals', async () => {
  let locked = 0;
  const api = createApi(async () => new Response('{"error":"Locked"}', { status: 401 }), () => { locked++; });
  await assert.rejects(api('/api/test'), ApiError); assert.equal(locked, 1);
  const controller = new AbortController();
  const ok = createApi(async (path, init) => {
    assert.equal(path, '/api/test'); assert.equal(init?.signal, controller.signal); assert.equal(init?.credentials, 'same-origin');
    assert.equal(new Headers(init?.headers).get('accept'), 'application/json');
    return new Response('{"ok":true}');
  }, () => assert.fail('success must not lock'));
  assert.deepEqual(await ok('/api/test', { signal: controller.signal }), { ok: true });
});
test('while locked, protected requests fail without a network call; auth calls still go out', async () => {
  let locked = true; const sent: string[] = [];
  const api = createApi(async (path) => { sent.push(String(path)); return new Response('{"ok":true}'); }, () => {}, () => locked);
  await assert.rejects(api('/api/markets'), (e: unknown) => e instanceof ApiError && e.status === 401);
  assert.deepEqual(await api('/api/auth/status'), { ok: true });
  locked = false; assert.deepEqual(await api('/api/markets'), { ok: true });
  assert.deepEqual(sent, ['/api/auth/status', '/api/markets']);
});
test('abort reasons propagate; cross-origin paths are refused before fetch', async () => {
  const controller = new AbortController(); controller.abort();
  const api = createApi(async (_, init) => { init?.signal?.throwIfAborted(); throw new Error('unexpected fetch'); }, () => {});
  await assert.rejects(api('/api/test', { signal: controller.signal }), (e: unknown) => e === controller.signal.reason);
  for (const path of ['https://example.com/api/test', '//example.com/api/test', '/api/\\example.com']) await assert.rejects(api(path), TypeError);
});
test('bus works before Query, fans out once and cleans subscriptions despite failing readers', async () => {
  const bus = createBus(); const calls: string[] = [];
  const off = bus.on('portfolio', () => { calls.push('legacy'); });
  await bus.invalidate('portfolio'); assert.deepEqual(calls, ['legacy']); calls.length = 0;
  const disconnect = bus.connect((key) => { calls.push(`query:${key}`); });
  const bad = bus.on('portfolio', () => { throw new Error('reader failed'); });
  const outcomes = await bus.invalidate('portfolio'); assert.deepEqual(calls, ['query:portfolio', 'legacy']);
  assert.equal(outcomes.filter((r) => r.status === 'rejected').length, 1);
  off(); bad(); disconnect(); calls.length = 0;
  await bus.invalidate('portfolio'); assert.deepEqual(calls, []);
  assert.ok(mutationInvalidations.sell.includes('chart-trades'));
  assert.ok(mutationInvalidations.cash.includes('wealth'));
});
