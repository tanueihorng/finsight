import test from 'node:test';
import assert from 'node:assert/strict';
import { radar, type RadarInput } from '../lib/radar.ts';
import type { ThesisRow, Thesis } from '../shared/theses.ts';

const NOW = Date.UTC(2026, 10, 7, 4);
const DAY = 864e5;
const thesis = (symbol: string, extra: Partial<Thesis> = {}): Thesis => ({ symbol, role: 'core', mechanism: 'm', triggers: [{ text: 't', kind: 'business', urgent: true }],
  reviewEveryDays: 90, nextReview: '2026-11-10', checks: [{ date: '2026-08-01', verdict: 'weakened' }], createdAt: 1, updatedAt: 1, ...extra });
const row = (symbol: string, th: Thesis | null, dueInDays: number | null, overMaxWeight = false): ThesisRow =>
  ({ symbol, held: true, weightPct: 10, last: 1, currency: 'USD', thesis: th, dueInDays, vsValuation: null, overMaxWeight });

const base: RadarInput = {
  now: NOW, horizonDays: 30, eventsOk: true,
  events: [
    { symbol: 'AAA', kind: 'EARNINGS', t: NOW + 5 * DAY, estimated: false, held: true },
    { symbol: 'BBB', kind: 'EARNINGS', t: NOW + 6 * DAY, estimated: true, held: true },
    { symbol: 'WAT', kind: 'EARNINGS', t: NOW + 7 * DAY, estimated: false, held: false },
    { symbol: 'CCC', kind: 'EX-DIV', t: NOW + 2 * DAY, estimated: true, amount: 0.5, held: true },
    { symbol: 'FAR', kind: 'EARNINGS', t: NOW + 60 * DAY, estimated: false, held: true },
  ],
  fomc: [{ end: '2026-12-09', sep: true }],
  weights: { AAA: 22, BBB: 5, CCC: 3 },
  theses: [row('AAA', thesis('AAA', { maxWeightPct: 20 }), 3, true), row('CCC', null, null)],
  guardrails: [{ kind: 'positionMax', label: 'Largest single holding', unit: '', state: 'breach', worst: { key: 'AAA', pct: 22, value: 1 }, over: [], limit: { kind: 'positionMax', pct: 20, status: 'proposed', updatedAt: 1 } } as any],
};

test('radar: joins earnings with thesis state, weight and guardrails', () => {
  const r = radar(base);
  assert.deepEqual(r.items.map((x) => x.symbol ?? x.kind), ['CCC', 'AAA', 'BBB', 'WAT']); // FOMC (Dec 9) is outside 30 days; FAR too
  const a = r.items.find((x) => x.symbol === 'AAA')!;
  assert.equal(a.level, 'review');
  assert.equal(a.weightPct, 22);
  assert.ok(a.prompts.some((p) => p.includes('due 2026-11-10')));
  assert.ok(a.prompts.some((p) => p.includes('weakened')));
  assert.ok(a.prompts.some((p) => p.includes('urgent')));
  assert.ok(a.prompts.some((p) => p.includes('max weight')));
  assert.ok(a.prompts.some((p) => p.includes('breach (proposed limit)')));
  assert.deepEqual(r.items.find((x) => x.symbol === 'BBB')!.prompts, ['No written thesis before the report.']);
  assert.equal(r.items.find((x) => x.symbol === 'WAT')!.level, 'info'); // watchlist only
  assert.equal(r.items.find((x) => x.symbol === 'CCC')!.detail, 'about 0.5 per share');
  assert.equal(r.counts.review, 2);
  assert.equal(r.counts.earningsHeld, 2);
});

test('radar: FOMC inside the window, schedule end and fetch failure are disclosed', () => {
  const r = radar({ ...base, horizonDays: 45, events: [], eventsOk: false });
  assert.deepEqual(r.items.map((x) => x.kind), ['FOMC']);
  assert.match(r.items[0]!.detail!, /dot plot/);
  assert.ok(r.notes.some((n) => n.includes('could not be fetched')));
  assert.ok(r.notes.some((n) => n.includes('ends at 2026-12-09')));
});
