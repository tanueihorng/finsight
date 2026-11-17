// FEAT-018 look-through. Expected numbers are worked out by hand in the
// comments, independently of the code under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { lookThrough, shockImpact, normTicker, issuerOf, pickSnapshots, type HoldingsSnapshot, type ScopePosition } from '../shared/lookthrough.ts';
import { loadSnapshots } from '../lib/holdings.ts';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} !≈ ${b}`);
const AS_OF = '2026-11-11';
const snap = (fund: string, holdingsDate: string, constituents: HoldingsSnapshot['constituents'], extra: Partial<HoldingsSnapshot> = {}): HoldingsSnapshot =>
  ({ fund, holdingsDate, retrievedAt: holdingsDate + 'T12:00:00Z', source: 'test', constituents, ...extra });

// One direct NVDA holding and two overlapping funds.
//   NVDA direct                    10,000
//   FA 20,000: NVDA 5% = 1,000, MSFT 4% = 800, cash 1% = 200, unlisted 90% = 18,000
//   FB  5,000: NVDA 10% = 500, GOOGL 5% = 250, GOOG 5% = 250, nested fund 2% = 100,
//              no ticker 3% = 150, unlisted 75% = 3,750
// NVDA combined = 10,000 + 1,000 + 500 = 11,500; basis 35,000.
// mapped = 11,500 + 800 + 500 (Alphabet) = 12,800
// unmapped = 18,000 + 200 + 3,750 + 100 + 150 = 22,200; 12,800 + 22,200 = 35,000.
const POSITIONS: ScopePosition[] = [
  { symbol: 'NVDA', name: 'NVIDIA Corp', marketValue: 10_000, assetType: 'EQUITY' },
  { symbol: 'FA', marketValue: 20_000, assetType: 'ETF' },
  { symbol: 'FB', marketValue: 5_000, assetType: 'ETF' },
];
const SNAPS: HoldingsSnapshot[] = [
  snap('FA', '2026-10-31', [
    { ticker: 'NVDA', name: 'NVIDIA', weightPct: 5 }, { ticker: 'MSFT', name: 'Microsoft', weightPct: 4 },
    { name: 'Cash', weightPct: 1, type: 'cash' }]),
  snap('FB', '2026-10-31', [
    { ticker: 'NVDA', name: 'NVIDIA', weightPct: 10 }, { ticker: 'GOOGL', name: 'Alphabet A', weightPct: 5 },
    { ticker: 'GOOG', name: 'Alphabet C', weightPct: 5 }, { ticker: 'FA', name: 'Fund A', weightPct: 2 },
    { name: 'Some private company', weightPct: 3 }]),
];

test('aggregates a direct holding and two overlapping funds into one issuer', () => {
  const lt = lookThrough(POSITIONS, SNAPS, { asOf: AS_OF });
  const nvda = lt.issuers.find((e) => e.issuer === 'NVDA')!;
  close(nvda.direct, 10_000); close(nvda.indirect, 1_500); close(nvda.combined, 11_500);
  close(nvda.share, 11_500 / 35_000);
  assert.deepEqual(nvda.contributions.map((c) => [c.via, Math.round(c.value), c.weightPct, c.holdingsDate]),
    [['DIRECT', 10_000, null, null], ['FA', 1_000, 5, '2026-10-31'], ['FB', 500, 10, '2026-10-31']]);
  assert.equal(lt.issuers[0]!.issuer, 'NVDA');
  const alphabet = lt.issuers.find((e) => e.issuer === 'GOOGL')!;
  close(alphabet.combined, 500); assert.deepEqual(alphabet.tickers.sort(), ['GOOG', 'GOOGL']);
  assert.equal(alphabet.contributions.length, 1, 'both share classes merge into one FB contribution');
  close(alphabet.contributions[0]!.weightPct!, 10);
});

test('mapped plus unmapped reconciles with the scope, each residual visible', () => {
  const lt = lookThrough(POSITIONS, SNAPS, { asOf: AS_OF });
  close(lt.basis, 35_000); close(lt.mapped, 12_800); close(lt.unmapped, 22_200);
  assert.equal(lt.reconciles, true); close(lt.difference, 0);
  const by = (pos: string, reason: string) => lt.unmappedRows.find((r) => r.position === pos && r.reason === reason)?.value;
  close(by('FA', 'fund-residual')!, 18_000); close(by('FA', 'fund-non-equity')!, 200);
  close(by('FB', 'fund-residual')!, 3_750); close(by('FB', 'nested-fund')!, 100); close(by('FB', 'unresolved-issuer')!, 150);
  const fa = lt.funds.find((f) => f.fund === 'FA')!;
  assert.equal(fa.status, 'expanded'); assert.equal(fa.holdingsDate, '2026-10-31'); assert.equal(fa.ageDays, 11);
  close(fa.mappedValue, 1_800); close(fa.mappedShare, 0.09);
});

test('shock applies once to combined mapped exposure', () => {
  const lt = lookThrough(POSITIONS, SNAPS, { asOf: AS_OF });
  const s = shockImpact(lt, 'NVDA', 30)!;
  // 30% of 11,500 = 3,450; 3,450 / 35,000 = 9.857%
  close(s.impact, -3_450); close(s.impactShare, -3_450 / 35_000); close(s.coverage, 12_800 / 35_000);
  close(shockImpact(lt, 'NVDA', 250)!.impact, -11_500, 1e-9); // clamped to a 100% loss
  assert.equal(shockImpact(lt, 'NOPE', 10), null);
});

test('stale, invalid, missing and unsupported positions stay unmapped at full value', () => {
  const positions: ScopePosition[] = [
    { symbol: 'OLD', marketValue: 1_000, assetType: 'ETF' },
    { symbol: 'BAD', marketValue: 2_000, assetType: 'ETF' },
    { symbol: 'NOFILE', marketValue: 3_000, assetType: 'ETF' },
    { symbol: 'BTC-USD', marketValue: 4_000, assetType: 'CRYPTOCURRENCY' },
    { symbol: 'MYSTERY', marketValue: 500, assetType: null },
  ];
  const snaps = [
    snap('OLD', '2026-08-31', [{ ticker: 'NVDA', name: 'NVIDIA', weightPct: 50 }]),          // 72 days > 45
    snap('BAD', '2026-11-01', [{ ticker: 'NVDA', name: 'NVIDIA', weightPct: 80 }, { ticker: 'AAPL', name: 'Apple', weightPct: 30 }]), // 110%
  ];
  const lt = lookThrough(positions, snaps, { asOf: AS_OF });
  assert.equal(lt.issuers.length, 0); close(lt.mapped, 0); close(lt.unmapped, 10_500); assert.equal(lt.reconciles, true);
  const reason = (p: string) => lt.unmappedRows.find((r) => r.position === p)!.reason;
  assert.equal(reason('OLD'), 'stale-holdings'); assert.equal(reason('BAD'), 'invalid-holdings');
  assert.equal(reason('NOFILE'), 'no-holdings-file'); assert.equal(reason('BTC-USD'), 'unsupported-asset'); assert.equal(reason('MYSTERY'), 'unsupported-asset');
  assert.equal(lt.funds.find((f) => f.fund === 'OLD')!.ageDays, 72);
  // A longer stale limit expands it: 50% of 1,000.
  close(lookThrough(positions, snaps, { asOf: AS_OF, staleDays: 90 }).issuers[0]!.combined, 500);
});

test('an issuer conflict is unmapped; rounding over 100% scales to the fund value', () => {
  const lt = lookThrough([{ symbol: 'F', marketValue: 1_000, assetType: 'ETF' }], [snap('F', '2026-11-01', [
    { ticker: 'GOOG', name: 'Alphabet C', weightPct: 40, issuer: 'GOOGL' },   // share class of the stated issuer: fine
    { ticker: 'META', name: 'Meta?', weightPct: 20, issuer: 'MSFT' },         // conflict: unresolved
    { ticker: 'AAPL', name: 'Apple', weightPct: 40.4 },                       // total 100.4%
  ])], { asOf: AS_OF });
  // scale 100/100.4: GOOG 400/1.004, AAPL 404/1.004, META 200/1.004 unresolved
  close(lt.issuers.find((e) => e.issuer === 'GOOGL')!.combined, 400 / 1.004, 1e-6);
  close(lt.unmappedRows.find((r) => r.reason === 'unresolved-issuer')!.value, 200 / 1.004, 1e-6);
  assert.equal(lt.unmappedRows.some((r) => r.reason === 'fund-residual'), false);
  assert.equal(lt.reconciles, true);
});

test('snapshot choice uses the latest holdings date on or before asOf', () => {
  const a = snap('Q', '2026-09-30', []), b = snap('Q', '2026-10-31', []), future = snap('Q', '2026-11-30', []);
  assert.equal(pickSnapshots([b, a, future], AS_OF).get('Q'), b);
  assert.equal(pickSnapshots([a, future], '2026-10-15').get('Q'), a);
  const lt = lookThrough([{ symbol: 'Q', marketValue: 100, assetType: 'ETF' }], [future], { asOf: AS_OF });
  assert.equal(lt.unmappedRows[0]!.reason, 'no-holdings-file'); assert.match(lt.unmappedRows[0]!.detail, /after 2026-11-11/);
});

test('ticker normalisation keeps exchange suffixes and merges share classes', () => {
  assert.equal(normTicker('brk.b'), 'BRK-B'); assert.equal(normTicker('BRK/B'), 'BRK-B'); assert.equal(normTicker('D05.SI'), 'D05.SI');
  assert.equal(issuerOf('GOOG'), 'GOOGL'); assert.equal(issuerOf('brk.a'), 'BRK-B');
});

test('a scope change recomputes from that scope only', () => {
  const a = lookThrough(POSITIONS, SNAPS, { asOf: AS_OF });
  const b = lookThrough([POSITIONS[2]!], SNAPS, { asOf: AS_OF });
  close(b.basis, 5_000); close(b.issuers.find((e) => e.issuer === 'NVDA')!.combined, 500);
  assert.equal(b.issuers.some((e) => e.issuer === 'MSFT'), false);
  assert.notEqual(a.issuers.length, b.issuers.length);
});

test('the synthetic fixtures load and are valid, dated snapshots', () => {
  const { snapshots, errors } = loadSnapshots(path.join(import.meta.dirname, 'fixtures', 'etf-holdings'));
  assert.deepEqual(errors, []);
  assert.deepEqual(snapshots.map((s) => `${s.fund}@${s.holdingsDate}`).sort(), ['QQQM@2026-09-30', 'QQQM@2026-10-31', 'VOO@2026-10-31']);
  // NVDA 60 direct + VOO + QQQM: values chosen by hand, 7.5% and 9.0% weights.
  const lt = lookThrough([
    { symbol: 'NVDA', marketValue: 6_000, assetType: 'EQUITY' },
    { symbol: 'VOO', marketValue: 10_000, assetType: 'ETF' },
    { symbol: 'QQQM', marketValue: 4_000, assetType: 'ETF' },
  ], snapshots, { asOf: AS_OF });
  close(lt.issuers.find((e) => e.issuer === 'NVDA')!.combined, 6_000 + 750 + 360);
  assert.equal(lt.issuers.find((e) => e.issuer === 'BRK-B')!.tickers[0], 'BRK-B');
  assert.equal(lt.reconciles, true);
});
