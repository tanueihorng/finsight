import { dataDir } from './helpers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compose, weekFrom, save, type DigestInput } from '../lib/digest.ts';

const NOW = Date.UTC(2026, 10, 7, 4), DAY = 864e5;
const empty: DigestInput = { now: NOW, base: 'SGD', week: null, guardrails: null, theses: null, decisions: null, radar: null, costReview: null };

test('digest: week change nets out new money', () => {
  const pts = [10, 8, 7, 1, 0].map((d, k) => ({ t: NOW - d * DAY, value: 1000 + k * 100, invested: k === 4 ? 1200 : 1000 }));
  const w = weekFrom(pts, NOW)!;
  assert.equal(w.from, '2026-10-31'); // the 7-day-old point
  assert.equal(w.gain, (1400 - 1200) - (1200 - 1000)); // +200 value, 200 of it new money
  assert.equal(weekFrom([], NOW), null);
});

test('digest: every section states absence instead of inventing content', () => {
  const d = compose(empty);
  assert.deepEqual(d.sections, ['Week', 'Guardrails', 'Theses', 'Next 14 days', 'Decision log', 'Cost basis']);
  assert.match(d.markdown, /No performance history/);
  assert.match(d.markdown, /No decision log found/);
  assert.match(d.markdown, /Nothing here is a trade instruction/);
});

test('digest: populated sections and private save', () => {
  const d = compose({ ...empty,
    week: { gain: -50, startValue: 1000, endValue: 950, from: '2026-10-31', to: '2026-11-07' },
    guardrails: { counts: { breach: 1, near: 0, ok: 0, unset: 4 }, checks: [{ kind: 'positionMax', label: 'Largest single holding', state: 'breach', worst: { key: 'AAA', pct: 30, value: 1 }, limit: { pct: 25, status: 'proposed' } } as any] },
    theses: { counts: { held: 2, withThesis: 1, overdue: 1, broken: 0 }, rows: [{ symbol: 'AAA', held: true, dueInDays: -3, thesis: { nextReview: '2026-11-04', checks: [] } } as any, { symbol: 'BBB', held: true, dueInDays: null, thesis: null } as any] },
    decisions: { source: { file: 'DECISION_LOG.md', found: true, modifiedAt: 1 }, counts: { total: 2, pending: 1, decided: 1, decidedNotExecuted: 1 }, issues: [], entries: [{ id: 'D-20261101-001', title: 'Trim', decidedNotExecuted: true } as any] },
    radar: { items: [{ t: NOW + 3 * DAY, inDays: 3, kind: 'EARNINGS', symbol: 'AAA', estimated: true, held: true, weightPct: 30, prompts: ['No written thesis before the report.'], level: 'review' }] },
    costReview: { counts: { positions: 2, flagged: 1, confirmed: 0, placeholder: 1 } } });
  assert.match(d.markdown, /-50 after new money/);
  assert.match(d.markdown, /\*\*BREACH\*\* Largest single holding \(AAA 30.0%\) vs 25.0% proposed/);
  assert.match(d.markdown, /AAA: review overdue by 3 days/);
  assert.match(d.markdown, /1 of 2 holdings have a written thesis; 1 have none/);
  assert.match(d.markdown, /2026-11-10 AAA earnings \(est\.\) — No written thesis/);
  assert.match(d.markdown, /D-20261101-001 Trim/);
  assert.match(d.markdown, /1 of 2 holdings have a cost flagged/);
  const name = save(d);
  assert.equal(name, '2026-11-07.md');
  const f = path.join(dataDir, 'digests', name);
  assert.equal(fs.readFileSync(f, 'utf8'), d.markdown);
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
});
