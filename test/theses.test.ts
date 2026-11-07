import './helpers.ts'; // isolated data dir before lib/ loads
import test from 'node:test';
import assert from 'node:assert';
import * as th from '../lib/theses.ts';

const NOW = Date.parse('2026-11-07T04:00:00Z');
const base = { symbol: 'nvda', role: 'core', mechanism: 'Data-centre accelerators with software lock-in', triggers: [{ text: 'Data-centre revenue falls two quarters running', kind: 'business', urgent: true }] };

test('theses: validation follows policy §6 and never defaults a verdict', () => {
  assert.throws(() => th.cleanThesis({ ...base, symbol: '' }, undefined), /valid symbol/);
  assert.throws(() => th.cleanThesis({ ...base, role: 'yolo' }, undefined), /Role/);
  assert.throws(() => th.cleanThesis({ ...base, mechanism: '' }, undefined), /mechanism/);
  assert.throws(() => th.cleanThesis({ ...base, triggers: [] }, undefined), /disprove/);
  assert.throws(() => th.cleanThesis({ ...base, valuation: { low: 200, high: 100 } }, undefined), /above valuation high/);
  assert.throws(() => th.cleanThesis({ ...base, maxWeightPct: 0 }, undefined), /Maximum weight/);
  assert.throws(() => th.cleanThesis({ ...base, reviewEveryDays: 1.5 }, undefined), /whole days/);
  // An unclassified holding may be recorded before its case is written.
  const u = th.cleanThesis({ symbol: 'xyz', role: 'unclassified' }, undefined, NOW);
  assert.deepStrictEqual([u.mechanism, u.triggers, u.checks], ['', [], []]);
  const t = th.cleanThesis({ ...base, reviewEveryDays: '30', valuation: { low: '120', high: '', currency: 'usd' } }, undefined, NOW);
  assert.strictEqual(t.symbol, 'NVDA');
  assert.strictEqual(t.nextReview, '2026-12-07');
  assert.deepStrictEqual(t.valuation, { low: 120, currency: 'USD' });
});

test('theses: save, check, delete; a check moves the next review', () => {
  const t = th.upsert({ ...base, reviewEveryDays: 90 }, NOW);
  assert.strictEqual(t.nextReview, '2027-02-05');
  assert.throws(() => th.addCheck('NVDA', { verdict: 'great' }, NOW), /Verdict/);
  assert.throws(() => th.addCheck('NVDA', { verdict: 'intact', date: '2027-01-01' }, NOW), /future/);
  assert.throws(() => th.addCheck('NVDA', { verdict: 'intact', date: '2026-02-30' }, NOW), /YYYY-MM-DD/);
  assert.throws(() => th.addCheck('AMD', { verdict: 'intact' }, NOW), /No thesis/);
  const c = th.addCheck('nvda', { verdict: 'weakened', date: '2026-11-01', note: 'Q3 margin dipped' }, NOW);
  assert.strictEqual(c.nextReview, '2027-01-30');
  assert.deepStrictEqual(c.checks[0], { date: '2026-11-01', verdict: 'weakened', note: 'Q3 margin dipped' });
  // Editing keeps the review history and creation date.
  const e = th.upsert({ ...base, mechanism: 'Edited' }, NOW + 1000);
  assert.strictEqual(e.checks.length, 1);
  assert.strictEqual(e.createdAt, t.createdAt);
  assert.strictEqual(e.nextReview, '2027-01-30');
  assert.strictEqual(th.remove('NVDA'), true);
  assert.strictEqual(th.remove('NVDA'), false);
  assert.deepStrictEqual(th.list(), []);
});

test('theses: report joins holdings, flags overdue, valuation band and max weight', () => {
  const t1 = th.cleanThesis({ ...base, maxWeightPct: 10, valuation: { low: 100, high: 150, currency: 'USD' }, nextReview: '2026-11-01' }, undefined, NOW);
  const t2 = th.cleanThesis({ symbol: 'OLD', role: 'tactical', mechanism: 'Catalyst', triggers: [{ text: 'Deal fails' }], nextReview: '2026-12-01' }, undefined, NOW);
  t2.checks = [{ date: '2026-10-01', verdict: 'broken' }];
  const r = th.report([
    { symbol: 'NVDA', weight: 8, last: 180, currency: 'USD' }, { symbol: 'nvda', weight: 4, last: 180, currency: 'USD' },
    { symbol: 'VOO', weight: 30, last: 600, currency: 'USD' },
  ], [t1, t2], NOW);
  assert.deepStrictEqual(r.rows.map((x) => x.symbol), ['NVDA', 'OLD', 'VOO']);
  const n = r.rows[0]!;
  assert.strictEqual(n.weightPct, 12);
  assert.strictEqual(n.dueInDays, -6);
  assert.strictEqual(n.vsValuation, 'above');
  assert.strictEqual(n.overMaxWeight, true);
  assert.strictEqual(r.rows[1]!.held, false); // thesis kept after the holding is sold
  assert.strictEqual(r.rows[2]!.thesis, null);
  assert.deepStrictEqual(r.counts, { held: 2, withThesis: 1, overdue: 1, broken: 1 });
  // A valuation in another currency is not compared.
  const other = th.report([{ symbol: 'NVDA', weight: 1, last: 180, currency: 'SGD' }], [t1], NOW);
  assert.strictEqual(other.rows[0]!.vsValuation, null);
});
