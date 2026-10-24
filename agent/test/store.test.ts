import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import './helpers.ts';
import * as store from '../src/store/db.ts';

test('migrations apply once; db file is private (0600)', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'db-')), 'a.db');
  const db = store.openDb(f); db.close();
  const db2 = store.openDb(f);
  assert.equal((db2.prepare('SELECT COUNT(*) n FROM schema_migrations').get() as any).n, 1);
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
