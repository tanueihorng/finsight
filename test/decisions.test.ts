import './helpers.ts'; // isolated data dir before lib/ loads
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { dataDir } from './setup.ts';
import * as dec from '../lib/decisions.ts';

const LOG = `# Decision log

Append-only.

## D-20260926-001 — First review

- **What changed:** Started.
- User decision: Mandate requested.
- Execution: Files created; no trade.

## D-20261001-002 — Options A–F

- **Action needed:** None executed.
- User decision: pending on options A–F. Execution: none.

## Template for subsequent entries

### D-YYYYMMDD-NNN — Decision title

- User decision and date: pending / accepted / modified / rejected:

## D-20261013-001 — Accepted, not yet done

- User decision: Accepted 2026-10-14: cap single stocks at 10%.
- Execution confirmation, date and actual costs: unexecuted unless confirmed

## D-20261001-002 — Same id reused

- Note without status lines.
`;

test('decisions: parses entries, skips the template, tags and flags', () => {
  const { entries, issues } = dec.parse(LOG);
  assert.deepStrictEqual(entries.map((e) => e.id), ['D-20261013-001', 'D-20261001-002', 'D-20261001-002', 'D-20260926-001']);
  const [acc, reused, opts, first] = entries;
  assert.strictEqual(acc!.decisionTag, 'decided');
  assert.strictEqual(acc!.executionTag, 'none');
  assert.strictEqual(acc!.decidedNotExecuted, true);
  assert.strictEqual(opts!.decision, 'pending on options A–F.');
  assert.strictEqual(opts!.execution, 'none.');
  assert.strictEqual(opts!.decisionTag, 'pending');
  assert.strictEqual(opts!.decidedNotExecuted, false);
  assert.strictEqual(first!.executionTag, 'recorded');
  assert.strictEqual(first!.date, '2026-09-26');
  assert.strictEqual(reused!.title, 'Same id reused');
  assert.strictEqual(reused!.decisionTag, 'unknown');
  assert.ok(issues.some((i) => /D-20261001-002 is used by 2/.test(i)));
  assert.ok(issues.some((i) => /no "User decision"/.test(i)));
});

test('decisions: report reads RECORDS_DIR and never exposes the folder path', () => {
  const dir = path.join(dataDir, 'records-test');
  process.env.RECORDS_DIR = dir;
  try {
    assert.strictEqual(dec.report().source.found, false);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'DECISION_LOG.md'), LOG);
    const r = dec.report();
    assert.strictEqual(r.source.found, true);
    assert.strictEqual(r.source.file, 'DECISION_LOG.md');
    assert.deepStrictEqual(r.counts, { total: 4, pending: 1, decided: 2, decidedNotExecuted: 1 });
    assert.ok(!JSON.stringify(r).includes(dir));
  } finally { delete process.env.RECORDS_DIR; }
});
