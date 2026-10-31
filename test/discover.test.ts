// FEAT-010 Discover: deterministic ranking, exclusions, staleness and
// exchange-local earnings dates. Pure functions only; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { daysBetween, earningsRows, exclusionReason, localDay, marketTz, rankMovers, STALE_MS, universe } from '../lib/discover.ts';
import type { EventItem, Quote } from '../shared/types.ts';

const NOW = Date.UTC(2026, 9, 30, 20, 0); // Fri 30 Oct 2026, 16:00 New York
const q = (symbol: string, changePct: number | null, extra: Record<string, unknown> = {}): Quote => ({
  symbol, name: symbol + ' Inc', currency: 'USD', exchange: 'NasdaqGS', type: 'EQUITY',
  price: 100, prevClose: changePct == null ? null : 100 / (1 + changePct / 100), change: changePct, changePct, marketTime: NOW - 60_000, ...extra,
}) as Quote;

test('the universe is holdings then watchlist, upper-cased, de-duplicated, with membership flags', () => {
  assert.deepEqual(universe(['nvda', 'AMD'], ['AMD', 'tsla']), [
    { symbol: 'NVDA', held: true, watched: false },
    { symbol: 'AMD', held: true, watched: true },
    { symbol: 'TSLA', held: false, watched: true },
  ]);
});

test('indices, FX, futures and crypto are excluded with a reason; equities and SG/HK listings are not', () => {
  assert.equal(exclusionReason('^GSPC'), 'index');
  assert.equal(exclusionReason('USDSGD=X'), 'fx');
  assert.equal(exclusionReason('GC=F'), 'futures');
  assert.equal(exclusionReason('BTC-USD'), 'crypto');
  for (const s of ['NVDA', 'D05.SI', '0700.HK', 'BRK-B']) assert.equal(exclusionReason(s), null, s);
});

test('gainers sort descending, losers ascending, ties by symbol; zero is unchanged, not ranked', () => {
  const members = universe(['B', 'A', 'C', 'D', 'E', 'F'], []);
  const r = rankMovers(members, [q('B', 2), q('A', 2), q('C', 5), q('D', -1), q('E', -3), q('F', 0)], NOW);
  assert.deepEqual(r.gainers.map((x) => x.symbol), ['C', 'A', 'B']);
  assert.deepEqual(r.losers.map((x) => x.symbol), ['E', 'D']);
  assert.equal(r.unchanged, 1);
  assert.deepEqual(r.excluded, []);
});

test('missing quotes, failed quotes and quotes without a baseline are excluded, not ranked as zero', () => {
  const members = universe(['OK', 'GONE', 'ERR', 'NOPREV', 'NOPRICE'], []);
  const r = rankMovers(members, [q('OK', 1), { symbol: 'ERR', error: 'HTTP 404 for x' }, q('NOPREV', null), q('NOPRICE', 3, { price: null })], NOW);
  assert.deepEqual(r.gainers.map((x) => x.symbol), ['OK']);
  assert.deepEqual(r.excluded, [
    { symbol: 'GONE', reason: 'no-quote', detail: undefined },
    { symbol: 'ERR', reason: 'no-quote', detail: 'HTTP 404 for x' },
    { symbol: 'NOPREV', reason: 'no-change' },
    { symbol: 'NOPRICE', reason: 'no-change' },
  ]);
});

test('a cached-after-failure or old-session quote stays ranked but is flagged stale', () => {
  const members = universe(['FRESH', 'CACHED', 'OLD', 'NOTIME'], []);
  const r = rankMovers(members, [
    q('FRESH', 1), q('CACHED', 2, { cache: { cachedAt: '', status: 'stale-fallback' } }),
    q('OLD', 3, { marketTime: NOW - STALE_MS - 1 }), q('NOTIME', 4, { marketTime: null }),
  ], NOW);
  const flag = Object.fromEntries(r.gainers.map((x) => [x.symbol, x.staleReason]));
  assert.deepEqual(flag, { FRESH: null, CACHED: 'cached-after-failure', OLD: 'old-session', NOTIME: 'old-session' });
  // Exactly at the limit is still fresh.
  assert.equal(rankMovers(universe(['X'], []), [q('X', 1, { marketTime: NOW - STALE_MS })], NOW).gainers[0]!.stale, false);
});

test('membership flags carry through to ranked rows', () => {
  const r = rankMovers(universe(['A'], ['A', 'B']), [q('A', 1), q('B', -1)], NOW);
  assert.deepEqual([r.gainers[0]!.held, r.gainers[0]!.watched, r.losers[0]!.held, r.losers[0]!.watched], [true, true, false, true]);
});

test('earnings dates use the exchange-local calendar day, across the UTC date line', () => {
  assert.equal(marketTz('NVDA'), 'America/New_York');
  assert.equal(marketTz('D05.SI'), 'Asia/Singapore');
  assert.equal(marketTz('0700.HK'), 'Asia/Hong_Kong');
  const t = Date.UTC(2026, 10, 3, 2, 30); // 3 Nov 02:30 UTC
  assert.equal(localDay(t, 'America/New_York'), '2026-11-02');
  assert.equal(localDay(t, 'Asia/Singapore'), '2026-11-03');
  assert.equal(daysBetween('2026-10-30', '2026-11-02'), 3);
  assert.equal(daysBetween('2026-10-31', '2026-11-01'), 1); // US DST ends 1 Nov: still one day
});

test('earnings rows keep estimates marked, drop past and non-earnings events, and sort by time', () => {
  const members = universe(['NVDA', 'D05.SI'], ['AMD']);
  const ev: EventItem[] = [
    { symbol: 'AMD', kind: 'EARNINGS', t: Date.UTC(2026, 10, 3, 21), estimated: false, held: false },
    { symbol: 'NVDA', kind: 'EARNINGS', t: Date.UTC(2026, 10, 19, 21), estimated: true, held: true },
    { symbol: 'NVDA', kind: 'EX-DIV', t: Date.UTC(2026, 10, 5), estimated: false, held: true, amount: 0.01 },
    { symbol: 'D05.SI', kind: 'EARNINGS', t: Date.UTC(2026, 9, 29, 1), estimated: false, held: true }, // yesterday in SG
    { symbol: 'D05.SI', kind: 'EARNINGS', t: Date.UTC(2026, 9, 30, 17), estimated: false, held: true }, // 31 Oct 01:00 SG = tomorrow there
  ];
  const rows = earningsRows(ev, members, NOW);
  assert.deepEqual(rows.map((r) => [r.symbol, r.day, r.inDays, r.estimated, r.held, r.watched]), [
    ['D05.SI', '2026-10-31', 0, false, true, false], // NOW is already 31 Oct 04:00 in Singapore
    ['AMD', '2026-11-03', 4, false, false, true],
    ['NVDA', '2026-11-19', 20, true, true, false],
  ]);
});
