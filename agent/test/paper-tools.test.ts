// Paper trading tools (FEAT-012): Kestrel's orders go to FinSight's paper order
// route with its thread id; FinSight's answer (placed, pending, refused) and
// error reasons come back unchanged; the tools reach no other write route.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegistry } from '../src/tools/index.ts';
import { finsightClient } from '../src/tools/finsight.ts';
import { fakeFinsight, testConfig, testCtx, TOKEN } from './helpers.ts';

test('paper tools post orders with the thread id and pass FinSight\'s answer through', async (t) => {
  const fake = await fakeFinsight(); t.after(() => fake.close());
  const cfg = testConfig(fake);
  const sent: { method: string; url: string; auth: string | null; body: any }[] = [];
  const replies: Record<string, [number, unknown]> = {
    '/api/paper/state': [200, { connected: true, settings: { approval: 'ask' }, account: { cash: 1000 } }],
    '/api/paper/orders': [200, { placed: false, pendingApproval: true, ticket: { id: 'tk1' } }],
    '/api/paper/orders/cancel': [400, { error: 'Alpaca DELETE /v2/orders failed (422): order is already in "filled" state' }],
  };
  const fetchImpl = (async (input: URL | string, init?: RequestInit) => {
    const u = new URL(String(input));
    sent.push({ method: init?.method || 'GET', url: u.pathname, auth: new Headers(init?.headers).get('authorization'), body: init?.body ? JSON.parse(String(init.body)) : null });
    const [status, body] = replies[u.pathname] ?? [404, { error: 'Unknown endpoint' }];
    return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const ctx = { ...testCtx(cfg), finsight: finsightClient(cfg.finsightUrl, cfg.finsightDataDir, fetchImpl), threadId: 'th_42' };
  const reg = buildRegistry();

  const acct = await reg.execute('paper_account', {}, ctx);
  assert.equal(acct.ok, true); assert.equal(JSON.parse(acct.content).settings.approval, 'ask');

  const placed = await reg.execute('paper_place_order', { symbol: 'AAPL', side: 'buy', qty: 3, note: 'test' }, ctx);
  assert.equal(placed.ok, true); assert.equal(JSON.parse(placed.content).pendingApproval, true);
  const post = sent.find((x) => x.url === '/api/paper/orders')!;
  assert.equal(post.method, 'POST'); assert.equal(post.auth, `Bearer ${TOKEN}`);
  assert.deepEqual(post.body, { symbol: 'AAPL', side: 'buy', type: 'market', qty: 3, tif: 'day', note: 'test', threadId: 'th_42' });

  const cancel = await reg.execute('paper_cancel_order', { id: 'a1b2c3d4-0000' }, ctx);
  assert.equal(cancel.ok, false); assert.match(cancel.content, /already in \\"filled\\" state/);

  assert.equal((await reg.execute('paper_place_order', { symbol: 'AAPL', side: 'hold' }, ctx)).ok, false, 'schema refuses a bad side');
  assert.deepEqual([...new Set(sent.filter((x) => x.method === 'POST').map((x) => x.url))].sort(), ['/api/paper/orders', '/api/paper/orders/cancel']);
});
