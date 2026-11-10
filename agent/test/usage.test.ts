import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { usageReport } from '../src/api/usage.ts';
import { BrainManifest, costOf } from '../src/brains/types.ts';
import Database from 'better-sqlite3';
import os from 'node:os';
import path from 'node:path';
import { addCost, openDb, turnSpend } from '../src/store/db.ts';

const manifest = (id: string) => BrainManifest.parse(JSON.parse(fs.readFileSync(new URL(`../plugins/brains/${id}/manifest.json`, import.meta.url), 'utf8')));
const usage = { inputTokens: 1_000_000, outputTokens: 1_000_000, cacheReadTokens: 0 };

test('published per-token prices match the manifests', () => {
  const expected: Record<string, number[]> = { sonnet: [2, 10, 0.1], haiku: [0.1, 0.5, 0.01], 'gpt-6-luna': [0.1, 0.5, 0.01], 'gpt-6-sol': [2, 10, 0.2], 'deepseek-flash': [0.3, 1.2, 0.006], 'deepseek-pro': [1.32, 3.96, 0.044] };
  for (const [id, [input, output, cached]] of Object.entries(expected)) {
    const p = manifest(id).pricing;
    assert.deepEqual([p.inputPerM, p.outputPerM, p.cacheReadPerM], [input, output, cached], id);
  }
});

test('DeepSeek charges full price only in weekday peak hours (UTC)', () => {
  const m = manifest('deepseek-flash'), full = 1.5;
  const at = (iso: string) => costOf(m, usage, 0, Date.parse(iso));
  assert.equal(at('2026-11-10T02:30:00Z'), full);            // Tuesday, 01:00-04:00
  assert.equal(at('2026-11-10T09:59:00Z'), full);            // Tuesday, 06:00-10:00
  assert.equal(at('2026-11-10T04:00:00Z'), full / 2);        // gap between the two windows
  assert.equal(at('2026-11-10T10:00:00Z'), full / 2);        // end is exclusive
  assert.equal(at('2026-11-14T02:30:00Z'), full / 2);        // Saturday
  assert.equal(costOf(manifest('sonnet'), usage, 0, Date.parse('2026-11-14T02:30:00Z')), 12); // others have no off-peak
});

test('GPT-6 Sol long prompts use the 2x input and 1.5x output tier', () => {
  const m = manifest('gpt-6-sol');
  assert.equal(costOf(m, { inputTokens: 272_000, outputTokens: 0 }), 272_000 * 2 / 1e6);
  assert.equal(costOf(m, { inputTokens: 272_001, outputTokens: 1000 }), (272_001 * 4 + 1000 * 15) / 1e6);
});

test('a reply\'s cost includes its paid search; the report separates models from search', () => {
  const db = openDb(':memory:');
  addCost(db, { brain: 'sonnet', kind: 'tokens', units: 1100, usd: 0.01, turnId: 't1', usage: { inputTokens: 1000, outputTokens: 100, cacheReadTokens: 400 } });
  addCost(db, { brain: 'tavily-search', kind: 'search', units: 1, usd: 0.008, turnId: 't1' });
  addCost(db, { brain: 'deepseek-flash', kind: 'ui_qualification', units: 500, usd: 0.001 });
  assert.ok(Math.abs(turnSpend(db, 't1') - 0.018) < 1e-12);
  const r = usageReport(db, new Map([['sonnet', { manifest: manifest('sonnet'), available: true, create: () => { throw Error('unused'); } }]]), 'day');
  assert.equal(r.period, 'day'); assert.equal(r.totals.webRequests, 1); assert.equal(r.totals.tokens, 1600);
  assert.equal(r.totals.webUsd, 0.008); assert.ok(Math.abs(r.totals.usd - 0.019) < 1e-12);
  assert.deepEqual(r.web, [{ provider: 'tavily', label: 'Tavily', kind: 'search', requests: 1, usd: 0.008 }]);
  const sonnet = r.models.find((m) => m.id === 'sonnet')!;
  assert.deepEqual([sonnet.label, sonnet.inputTokens, sonnet.cacheReadTokens, sonnet.outputTokens, sonnet.unsplitTokens], ['Claude Sonnet 5.5', 1000, 400, 100, 0]);
  assert.equal(r.models.find((m) => m.id === 'deepseek-flash')!.unsplitTokens, 500);
  assert.equal(usageReport(db, new Map(), 'nonsense').period, 'month');
});

test('the migration fills token splits on existing ledger rows from their traces', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kestrel-usage-')), file = path.join(dir, 'agent.db');
  try {
    openDb(file).close();
    const old = new Database(file);
    old.exec('ALTER TABLE cost_ledger DROP COLUMN input_tokens; ALTER TABLE cost_ledger DROP COLUMN output_tokens; ALTER TABLE cost_ledger DROP COLUMN cache_read_tokens; ALTER TABLE cost_ledger DROP COLUMN cache_write_tokens; DELETE FROM schema_migrations WHERE version >= 4;');
    old.prepare("INSERT INTO cost_ledger(ts, brain, kind, units, usd, turn_id) VALUES (1, 'b', 'tokens', 120, 0.5, 't')").run();
    old.prepare("INSERT INTO cost_ledger(ts, brain, kind, units, usd, turn_id) VALUES (1, 'b', 'ui_qualification', 9, 0.1, NULL)").run();
    old.pragma('foreign_keys = OFF');
    old.prepare("INSERT INTO trace_steps(turn_id, step, kind, name, input_tokens, output_tokens, cost_usd, created_at, cache_read_tokens) VALUES ('t', 0, 'brain', 'b', 100, 20, 0.5, 1, 40)").run();
    old.close();
    const db = openDb(file);
    const [row, untraced] = db.prepare('SELECT input_tokens i, output_tokens o, cache_read_tokens r FROM cost_ledger ORDER BY id').all() as { i: number | null; o: number | null; r: number | null }[];
    db.close();
    assert.deepEqual({ ...row }, { i: 100, o: 20, r: 40 });
    assert.deepEqual({ ...untraced }, { i: null, o: null, r: null });
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
