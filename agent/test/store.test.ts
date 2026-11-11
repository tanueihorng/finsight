import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import './helpers.ts';
import Database from 'better-sqlite3';
import * as store from '../src/store/db.ts';

test('migrations apply once; db file is private (0600)', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'db-')), 'a.db');
  const db = store.openDb(f); db.close();
  const db2 = store.openDb(f);
  assert.equal((db2.prepare('SELECT COUNT(*) n FROM schema_migrations').get() as any).n, 6);
  assert.equal(fs.statSync(f).mode & 0o777, 0o600);
});

test('optimistic thread versions: stale writer gets CONFLICT', () => {
  const db = store.openDb(':memory:');
  const t = store.createThread(db);
  assert.equal(store.bumpThreadVersion(db, t.id, 0), 1);
  assert.throws(() => store.bumpThreadVersion(db, t.id, 0), (e: any) => e.code === 'CONFLICT' && e.status === 409);
  assert.equal(store.bumpThreadVersion(db, t.id, 1), 2);
});

test('idempotent turn creation returns the same turn for the same key', () => {
  const db = store.openDb(':memory:');
  const t = store.createThread(db);
  const a = store.createTurn(db, t.id, 'x', 'key-123456789');
  const b = store.createTurn(db, t.id, 'x', 'key-123456789');
  assert.equal(a.existing, false); assert.equal(b.existing, true); assert.equal(a.id, b.id);
});

test('messages are append-only with gapless seq; FTS finds them', () => {
  const db = store.openDb(':memory:');
  const t = store.createThread(db);
  store.appendMessage(db, t.id, 'user', [{ type: 'text', text: 'What about semiconductors exposure?' }]);
  store.appendMessage(db, t.id, 'assistant', [{ type: 'text', text: 'Semis are 45%.' }]);
  assert.deepEqual(store.listMessages(db, t.id).map((m) => m.seq), [1, 2]);
  assert.equal(store.searchMessages(db, 'semiconductors')[0]?.threadId, t.id);
  assert.deepEqual(store.searchMessages(db, '"*^():'), []); // FTS syntax is neutralised
});

test('crash recovery marks running turns interrupted', () => {
  const db = store.openDb(':memory:');
  const t = store.createThread(db);
  store.createTurn(db, t.id, 'x');
  assert.equal(store.recoverTurns(db), 1);
  assert.equal(store.recoverTurns(db), 0);
});

test('cost ledger sums by day', () => {
  const db = store.openDb(':memory:');
  store.addCost(db, { brain: 'a', kind: 'tokens', units: 10, usd: 0.01 });
  store.addCost(db, { brain: 'a', kind: 'tokens', units: 10, usd: 0.02 });
  assert.equal(Math.round(store.spendSince(db, store.startOfToday()) * 100) / 100, 0.03);
});

test('cache honours TTL', async () => {
  const db = store.openDb(':memory:');
  store.cacheSet(db, 'k', { a: 1 }, 20);
  assert.deepEqual(store.cacheGet(db, 'k'), { a: 1 });
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(store.cacheGet(db, 'k'), null);
});

test('a database already on the usage migration keeps its cost data and gains the quant tables', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'db-quant-upgrade-')), 'a.db');
  const old = store.openDb(f);
  old.exec('DROP TABLE quant_run_series; DROP TABLE quant_series; DROP TABLE quant_runs; DELETE FROM schema_migrations WHERE version >= 5');
  store.addCost(old, { brain: 'synthetic', kind: 'tokens', units: 10, usd: 0.5, usage: { inputTokens: 7, outputTokens: 1 } });
  old.close();
  const upgraded = store.openDb(f);
  const cost = upgraded.prepare('SELECT usd, input_tokens i FROM cost_ledger').get() as { usd: number; i: number };
  assert.deepEqual([cost.usd, cost.i], [0.5, 7]);
  assert.deepEqual((upgraded.prepare('SELECT version FROM schema_migrations ORDER BY version').all() as { version: number }[]).map((r) => r.version), [1, 2, 3, 4, 5, 6]);
  assert.ok((upgraded.prepare('PRAGMA table_info(quant_runs)').all() as { name: string }[]).some((c) => c.name === 'robustness_json'));
  assert.ok(fs.existsSync(f + '.bak-v4'));
  upgraded.close();
});

test('migration backup includes committed WAL data and preserves v1 rollback before adding views', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'db-upgrade-')), 'a.db');
  const old = store.openDb(f);
  old.exec('DROP TABLE quant_run_series; DROP TABLE quant_series; DROP TABLE quant_runs; DROP TABLE ui_views; ALTER TABLE trace_steps DROP COLUMN cache_read_tokens; ALTER TABLE trace_steps DROP COLUMN cache_write_tokens; ALTER TABLE cost_ledger DROP COLUMN input_tokens; ALTER TABLE cost_ledger DROP COLUMN output_tokens; ALTER TABLE cost_ledger DROP COLUMN cache_read_tokens; ALTER TABLE cost_ledger DROP COLUMN cache_write_tokens; DELETE FROM schema_migrations WHERE version >= 2');
  const t = store.createThread(old, 'Committed WAL row');
  assert.ok(fs.statSync(f + '-wal').size > 0);
  const upgraded = store.openDb(f);
  assert.equal(store.getThread(upgraded, t.id)?.title, 'Committed WAL row');
  assert.deepEqual(store.listUiViews(upgraded, t.id), []);
  const backup = new Database(f + '.bak-v1', { readonly: true });
  assert.equal((backup.prepare('SELECT title FROM threads WHERE id = ?').get(t.id) as {title: string}).title, 'Committed WAL row');
  assert.equal((backup.prepare('SELECT MAX(version) v FROM schema_migrations').get() as {v: number}).v, 1);
  backup.close(); upgraded.close(); old.close();
});
