// Regression tests for the valuation and reporting defects reproduced by the
// SWEEP-002 audit (AUDITFIX-003). Each case is the audit's synthetic example.
import { setSymbol, reset, dataDir } from './helpers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as pf from '../lib/portfolio.ts';
import { exposureReport } from '../lib/holdings.ts';
import { evaluate, cleanLimit } from '../lib/guardrails.ts';
import { radar } from '../lib/radar.ts';
import { lookThrough, normTicker, issuerOf, isCalendarDate, type HoldingsSnapshot } from '../shared/lookthrough.ts';

const day = (n: number) => Date.UTC(2026, 0, n);
const snap = (over: Partial<HoldingsSnapshot> = {}): HoldingsSnapshot => ({
  fund: 'XYZ', source: 'fixture', holdingsDate: '2026-03-01', retrievedAt: '2026-03-03',
  constituents: [{ ticker: 'ABC', name: 'ABC', weightPct: 100 }], ...over,
});
const fund = (s: HoldingsSnapshot) => lookThrough([{ symbol: 'XYZ', marketValue: 20, assetType: 'ETF' }], [s], { asOf: '2026-03-04' });

test('exposure leaves out amounts it cannot convert and says which currencies', async () => {
  reset();
  setSymbol('XYZ', { currency: 'USD', price: 20 });
  await pf.buy('XYZ', 1, 20);
  await pf.setCash('JPY', 10000);
  const ex = await exposureReport('USD');
  assert.deepEqual(ex.fxMissing, ['JPY']);
  assert.deepEqual(ex.unvalued, [{ item: 'Cash', currency: 'JPY', amount: 10000 }]);
  assert.equal(ex.cash, 0);
  assert.equal(ex.netWorth, 20); // the USD holding only, never JPY 10,000 as USD 10,000
  assert.equal(ex.basis, 20);
});

test('exposure with every rate available reports nothing missing', async () => {
  reset();
  setSymbol('XYZ', { currency: 'USD', price: 20 });
  await pf.buy('XYZ', 1, 20);
  await pf.setCash('USD', 5);
  const ex = await exposureReport('USD');
  assert.deepEqual([ex.fxMissing, ex.unvalued, ex.cash, ex.netWorth], [[], [], 5, 25]);
});

test('guardrails compute no weights while an exchange rate is missing', () => {
  const r = evaluate({ base: 'USD', positions: [{ symbol: 'AAA', currency: 'USD', marketValue: 60 }], cash: [{ ccy: 'JPY', base: 10000 }], accounts: [], fxMissing: ['JPY'] },
    [cleanLimit({ kind: 'positionMax', pct: 30, status: 'accepted' }), cleanLimit({ kind: 'cashMax', pct: 50, status: 'accepted' })]);
  assert.deepEqual(r.checks.filter((c) => c.limit).map((c) => c.state), ['no-data', 'no-data']);
  assert.ok(r.notes.some((n) => /JPY/.test(n)), r.notes.join(' | '));
});

test('a constituent with a non-text ticker invalidates its fund instead of breaking the report', () => {
  const lt = fund(snap({ constituents: [{ ticker: 123 as unknown as string, name: 'ABC', weightPct: 100 }] }));
  assert.equal(lt.funds[0]!.status, 'invalid');
  assert.match(lt.funds[0]!.note, /ticker/);
  assert.deepEqual(lt.unmappedRows.map((r) => [r.reason, r.value]), [['invalid-holdings', 20]]);
  assert.ok(lt.reconciles);
});

test('a non-object constituent invalidates its fund', () => {
  const lt = fund(snap({ constituents: [null as unknown as HoldingsSnapshot['constituents'][0]] }));
  assert.equal(lt.funds[0]!.status, 'invalid');
});

test('ticker normalization keeps exchange listings apart', () => {
  assert.equal(normTicker('ABC.L'), 'ABC.L');
  assert.equal(normTicker('BP.L'), 'BP.L');
  assert.equal(normTicker('brk.b'), 'BRK-B');
  assert.equal(normTicker('BRK/B'), 'BRK-B');
  assert.equal(issuerOf('brk.a'), 'BRK-B');
  const lt = lookThrough(['ABC.L', 'ABC-L'].map((symbol) => ({ symbol, marketValue: 100, assetType: 'EQUITY' })), [], { asOf: '2026-03-04' });
  assert.deepEqual(lt.issuers.map((e) => [e.issuer, e.combined]), [['ABC-L', 100], ['ABC.L', 100]]);
});

test('an impossible holdings date is invalid, not two days old', () => {
  assert.equal(isCalendarDate('2026-02-30'), false);
  assert.equal(isCalendarDate('2026-02-28'), true);
  assert.equal(isCalendarDate('2024-02-29'), true);
  const lt = fund(snap({ holdingsDate: '2026-02-30' }));
  assert.notEqual(lt.funds[0]!.status, 'expanded');
  assert.equal(lt.mapped, 0);
});

test('Event Radar flags every holding over a breached position cap', () => {
  const checks = evaluate({ base: 'USD', positions: [{ symbol: 'AAA', currency: 'USD', marketValue: 60 }, { symbol: 'BBB', currency: 'USD', marketValue: 40 }], cash: [], accounts: [] },
    [cleanLimit({ kind: 'positionMax', pct: 30, status: 'accepted' })]).checks;
  const events = ['AAA', 'BBB'].map((symbol) => ({ symbol, t: day(2), kind: 'EX-DIV' as const, amount: null, held: true, estimated: false }));
  const r = radar({ now: day(1), horizonDays: 3, events, eventsOk: true, fomc: [], weights: { AAA: 60, BBB: 40 }, theses: [], guardrails: checks });
  assert.deepEqual(r.items.map((i) => [i.symbol, i.level]), [['AAA', 'review'], ['BBB', 'review']]);
});

test('Event Radar still flags the largest holding when the cap is only near', () => {
  const checks = evaluate({ base: 'USD', positions: [{ symbol: 'AAA', currency: 'USD', marketValue: 29 }, { symbol: 'BBB', currency: 'USD', marketValue: 71 }], cash: [], accounts: [] },
    [cleanLimit({ kind: 'positionMax', pct: 75, status: 'accepted' })]).checks;
  assert.equal(checks[0]!.state, 'near');
  const events = ['AAA', 'BBB'].map((symbol) => ({ symbol, t: day(2), kind: 'EX-DIV' as const, amount: null, held: true, estimated: false }));
  const r = radar({ now: day(1), horizonDays: 3, events, eventsOk: true, fomc: [], weights: { AAA: 29, BBB: 71 }, theses: [], guardrails: checks });
  assert.deepEqual(r.items.map((i) => [i.symbol, i.level]), [['AAA', 'info'], ['BBB', 'review']]);
});

test('exposure survives a malformed holdings file on disk', async () => {
  reset();
  setSymbol('XYZ', { currency: 'USD', price: 20 });
  await pf.buy('XYZ', 1, 20);
  fs.mkdirSync(path.join(dataDir, 'etf-holdings'), { recursive: true });
  fs.writeFileSync(path.join(dataDir, 'etf-holdings', 'bad.json'), JSON.stringify(snap({ constituents: [{ ticker: 123 as unknown as string, name: 'ABC', weightPct: 100 }] })));
  const ex = await exposureReport('USD', undefined, '2026-03-04');
  assert.equal(ex.funds[0]!.status, 'invalid');
});
