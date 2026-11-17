import test from 'node:test';
import assert from 'node:assert/strict';
import { lookThrough, type ExposureReport } from '../../../../shared/lookthrough.ts';
import { inScope, segments, share, sources, unmappedGroups, denominator, DIRECT_COLOR, UNMAPPED_COLOR } from './exposure.ts';

const lt = lookThrough([
  { symbol: 'NVDA', marketValue: 600, assetType: 'EQUITY' },
  { symbol: 'BIG', marketValue: 1000, assetType: 'ETF' },
  { symbol: 'NOFILE', marketValue: 400, assetType: 'ETF' },
], [{ fund: 'BIG', holdingsDate: '2026-10-31', retrievedAt: '2026-11-01T00:00:00Z', source: 't', constituents: [{ ticker: 'NVDA', name: 'NVIDIA', weightPct: 20 }] }], { asOf: '2026-11-11' });
const rep: ExposureReport = { ...lt, book: 'real', account: 'a1', base: 'SGD', cash: 500, netWorth: 2500, fileErrors: [] };

test('legend lists direct, then each fund; funds without a usable file are grey', () => {
  const s = sources(rep);
  assert.deepEqual(s.map((x) => [x.key, x.status]), [['DIRECT', 'direct'], ['BIG', 'expanded'], ['NOFILE', 'missing']]);
  assert.equal(s[0]!.color, DIRECT_COLOR); assert.equal(s[2]!.color, UNMAPPED_COLOR); assert.equal(s[1]!.holdingsDate, '2026-10-31');
});

test('bar segments scale to the largest issuer; direct comes first', () => {
  const e = rep.issuers[0]!; // NVDA 600 + 200 = 800
  const seg = segments(e, e.combined, sources(rep));
  assert.deepEqual(seg.map((x) => [x.key, x.value, x.width]), [['DIRECT', 600, 75], ['BIG', 200, 25]]);
});

test('basis switch changes the denominator, not the amounts', () => {
  assert.equal(denominator(rep, 'invested'), 2000); assert.equal(denominator(rep, 'networth'), 2500);
  assert.equal(share(800, 2000), 0.4); assert.equal(share(800, 2500), 0.32); assert.equal(share(1, 0), 0);
});

test('unmapped rows group by reason, largest first', () => {
  // BIG unlisted 80% = 800, NOFILE 400
  assert.deepEqual(unmappedGroups(rep).map((g) => [g.reason, g.value]), [['fund-residual', 800], ['no-holdings-file', 400]]);
});

test('a response from another account, base or book is out of scope', () => {
  assert.equal(inScope(rep, { book: 'real', account: 'a1', base: 'sgd' }), true);
  assert.equal(inScope(rep, { book: 'paper', account: 'a1', base: 'SGD' }), false);
  assert.equal(inScope(rep, { book: 'real', account: 'a2', base: 'SGD' }), false);
  assert.equal(inScope(rep, { book: 'real', account: 'a1', base: 'USD' }), false);
  assert.equal(inScope(undefined, { book: 'real', account: 'a1', base: 'SGD' }), false);
});
