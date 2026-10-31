import { setSymbol, reset } from './helpers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { cache, cached, cachedWithStatus } from '../lib/cache.ts';
import * as market from '../lib/market.ts';

const age = (key: string, ms: number) => { cache.get(key)!.at -= ms; };

test('cached: fresh values are reused, concurrent callers share one fetch', async () => {
  reset();
  let calls = 0;
  const fn = async () => { calls++; await new Promise((r) => setTimeout(r, 5)); return calls; };
  const [a, b] = await Promise.all([cached('k1', 1000, fn), cached('k1', 1000, fn)]);
  assert.equal(a, 1); assert.equal(b, 1); assert.equal(calls, 1);
  assert.equal(await cached('k1', 1000, fn), 1);
});

test('cached: stale values are served at once and refreshed in the background', async () => {
  reset();
  let v = 'old';
  await cached('k2', 1000, async () => v, { stale: 60000 });
  age('k2', 2000); v = 'new';
  assert.equal(await cached('k2', 1000, async () => v, { stale: 60000 }), 'old');
  await new Promise((r) => setTimeout(r, 5));
  assert.equal(await cached('k2', 1000, async () => v, { stale: 60000 }), 'new');
});

test('cached: when the upstream fails, the last good value wins over an error', async () => {
  reset();
  await cached('k3', 1000, async () => 42);
  age('k3', 10 * 60000);
  assert.equal(await cached('k3', 1000, async () => { throw new Error('down'); }), 42);
  await assert.rejects(cached('k4', 1000, async () => { throw new Error('down'); }), /down/);
});

test('cache reports original cache time and a failed refresh', async () => {
  reset(); await cached('provenance', 1000, async () => 42); age('provenance', 60000);
  const old = cache.get('provenance')!.at;
  const result = await cachedWithStatus('provenance', 1000, async () => { throw new Error('down'); });
  assert.equal(result.value, 42); assert.equal(result.cache.status, 'stale-fallback');
  assert.equal(result.cache.cachedAt, new Date(old).toISOString());
});

test('quote exposes the cached observation on refresh failure', async () => {
  reset(); setSymbol('STALE', { price: 42 });
  await market.getQuote('STALE'); age('q:STALE', 60000);
  const observedAt = cache.get('q:STALE')!.at;
  const realFetch = global.fetch;
  global.fetch = (async () => { throw new Error('offline'); }) as typeof fetch;
  try {
    const quote = await market.getQuote('STALE');
    assert.equal(quote.price, 42); assert.equal(quote.cache?.status, 'stale-fallback');
    assert.equal(quote.cache?.cachedAt, new Date(observedAt).toISOString());
  } finally { global.fetch = realFetch; }
});

test('Yahoo 429 on both hosts triggers a backoff instead of retry storms', async () => {
  reset();
  setSymbol('AAA', { price: 10 });
  const realFetch = global.fetch;
  let hits = 0;
  global.fetch = (async () => { hits++; return { ok: false, status: 429, json: async () => ({}) }; }) as unknown as typeof fetch; // a Response stand-in
  try {
    await assert.rejects(market.getQuote('ZZZ'), /429/);
    assert.equal(hits, 2);
    await assert.rejects(market.getQuote('YYY'), /rate-limited/);
    assert.equal(hits, 2); // no network during the cooldown
  } finally { global.fetch = realFetch; }
});
