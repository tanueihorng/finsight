// BOOKRACE-001: quote and category look-ups fetch with bounded concurrency, and
// the HTTP routes de-duplicate and cap the symbol list.
import { setSymbol, reset } from './helpers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { getQuotes, getCategories, settledLimit, FETCH_CONCURRENCY } from '../lib/market.ts';
import { startServer, setup, json } from './serverproc.ts';

/** Count in-flight Yahoo requests; each one yields a few turns so they overlap. */
function track(t: { after: (fn: () => void) => void }) {
  const real = globalThis.fetch;
  const s = { now: 0, max: 0, total: 0 };
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    s.now++; s.total++; s.max = Math.max(s.max, s.now);
    try { for (let i = 0; i < 3; i++) await new Promise((r) => setImmediate(r)); return await real(url as string, init); }
    finally { s.now--; }
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = real; });
  return s;
}
const syms = (n: number) => Array.from({ length: n }, (_, i) => `S${i}`);

test('settledLimit keeps order, records failures and never exceeds the limit', async () => {
  let now = 0, max = 0;
  const r = await settledLimit([1, 2, 3, 4, 5, 6, 7], 3, async (x) => {
    now++; max = Math.max(max, now); await new Promise((res) => setImmediate(res)); now--;
    if (x === 4) throw new Error('four'); return x * 10;
  });
  assert.equal(max, 3);
  assert.deepEqual(r.map((x) => x.status === 'fulfilled' ? x.value : (x.reason as Error).message), [10, 20, 30, 'four', 50, 60, 70]);
  assert.deepEqual(await settledLimit([], 3, async (x) => x), []);
});

test('getQuotes: 60 symbols never put more than the bound in flight, and keep input order', async (t) => {
  reset();
  for (const s of syms(60)) setSymbol(s, { price: 10 });
  const s = track(t);
  const q = await getQuotes(syms(60));
  assert.equal(s.total, 60);
  assert.equal(s.max, FETCH_CONCURRENCY);
  assert.deepEqual(q.map((x) => x.symbol), syms(60));
});

test('getCategories: bounded too', async (t) => {
  reset();
  for (const s of syms(30)) setSymbol(s, { price: 10 });
  const s = track(t);
  const c = await getCategories(syms(30));
  assert.equal(Object.keys(c).length, 30);
  assert.ok(s.max <= FETCH_CONCURRENCY, `max in flight ${s.max}`);
});

test('HTTP: /api/quote and /api/categories de-duplicate and cap the symbol list', async (t) => {
  const srv = await startServer(); t.after(() => srv.stop());
  const c = await setup(srv);
  const dup = await srv.req('GET', '/api/quote?symbols=NVDA,NVDA,%20NVDA%20,MSFT', json(c));
  assert.equal(dup.status, 200);
  assert.deepEqual(dup.json.quotes.map((x: { symbol: string }) => x.symbol), ['NVDA', 'MSFT']);
  const ok = await srv.req('GET', '/api/quote?symbols=' + syms(200).join(','), json(c));
  assert.equal(ok.status, 200); assert.equal(ok.json.quotes.length, 200);
  for (const path of ['/api/quote', '/api/categories']) {
    const big = await srv.req('GET', `${path}?symbols=` + syms(201).join(','), json(c));
    assert.equal(big.status, 400, path); assert.deepEqual(big.json, { error: 'at most 200 symbols' });
  }
  assert.deepEqual((await srv.req('GET', '/api/categories?symbols=', json(c))).json, {});
});
