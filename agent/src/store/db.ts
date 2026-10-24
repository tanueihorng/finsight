// SQLite store. One process, one connection: better-sqlite3 is synchronous, so
// every write is serialised by construction (the "single writer" of the spec).
// WAL mode lets the reader side (SSE replay, listings) run without blocking.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import type { Block, Msg, Role, Usage } from '../types.ts';
import { AgentError } from '../types.ts';

export type DB = Database.Database;

const MIGRATIONS: string[] = [
  `CREATE TABLE threads (
     id TEXT PRIMARY KEY, title TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 0,
     default_brain TEXT, archived INTEGER NOT NULL DEFAULT 0, summary TEXT, summary_upto_seq INTEGER,
     created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
   CREATE TABLE messages (
     id TEXT PRIMARY KEY, thread_id TEXT NOT NULL REFERENCES threads(id), seq INTEGER NOT NULL,
     role TEXT NOT NULL, content_json TEXT NOT NULL, provider_extra TEXT, brain TEXT, turn_id TEXT,
     parent_id TEXT, created_at INTEGER NOT NULL, UNIQUE(thread_id, seq));
   CREATE TABLE turns (
     id TEXT PRIMARY KEY, thread_id TEXT NOT NULL, status TEXT NOT NULL, brain TEXT NOT NULL,
     idempotency_key TEXT UNIQUE, started_at INTEGER NOT NULL, finished_at INTEGER, stop_reason TEXT, error TEXT);
   CREATE TABLE events (
     id INTEGER PRIMARY KEY AUTOINCREMENT, thread_id TEXT NOT NULL, type TEXT NOT NULL,
     payload_json TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE INDEX events_thread ON events(thread_id, id);
   CREATE TABLE trace_steps (
     turn_id TEXT NOT NULL, step INTEGER NOT NULL, kind TEXT NOT NULL, name TEXT, args_json TEXT,
     result_summary TEXT, ok INTEGER, input_tokens INTEGER, output_tokens INTEGER, cost_usd REAL,
     ms INTEGER, created_at INTEGER NOT NULL, PRIMARY KEY(turn_id, step));
   CREATE TABLE cost_ledger (
     id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, brain TEXT NOT NULL, kind TEXT NOT NULL,
     units REAL NOT NULL, usd REAL NOT NULL, price_version TEXT, turn_id TEXT, thread_id TEXT);
   CREATE INDEX cost_ts ON cost_ledger(ts);
   CREATE TABLE cache (key TEXT PRIMARY KEY, value_json TEXT NOT NULL, expires_at INTEGER NOT NULL);
   CREATE TABLE proposals (
     id TEXT PRIMARY KEY, kind TEXT NOT NULL, target TEXT, body TEXT NOT NULL, source_turn TEXT,
     status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL, decided_at INTEGER);
   CREATE VIRTUAL TABLE fts_messages USING fts5(text, thread_id UNINDEXED, message_id UNINDEXED);`,
];

export function openDb(file: string): DB {
  if (file !== ':memory:') {
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  }
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at INTEGER NOT NULL)');
  const current = (db.prepare('SELECT MAX(version) v FROM schema_migrations').get() as { v: number | null }).v ?? 0;
  if (current < MIGRATIONS.length && file !== ':memory:' && fs.existsSync(file) && current > 0) {
    fs.copyFileSync(file, `${file}.bak-v${current}`); // backup before migrating an existing DB
  }
  for (let v = current + 1; v <= MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v - 1]!);
      db.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(v, Date.now());
    })();
  }
  if (file !== ':memory:') { try { fs.chmodSync(file, 0o600); } catch { /* best effort */ } }
  return db;
}

export const newId = (prefix: string): string => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;

// ---------------------------------------------------------------- threads
export type Thread = { id: string; title: string; version: number; defaultBrain: string | null; archived: boolean; createdAt: number; updatedAt: number };
const toThread = (r: any): Thread => ({ id: r.id, title: r.title, version: r.version, defaultBrain: r.default_brain, archived: !!r.archived, createdAt: r.created_at, updatedAt: r.updated_at });

export function createThread(db: DB, title = 'New chat', brain: string | null = null): Thread {
  const now = Date.now(), id = newId('th');
  db.prepare('INSERT INTO threads(id, title, default_brain, created_at, updated_at) VALUES (?,?,?,?,?)').run(id, title, brain, now, now);
  return getThread(db, id)!;
}
export function getThread(db: DB, id: string): Thread | null {
  const r = db.prepare('SELECT * FROM threads WHERE id = ?').get(id);
  return r ? toThread(r) : null;
}
export function listThreads(db: DB, includeArchived = false): Thread[] {
  return db.prepare(`SELECT * FROM threads ${includeArchived ? '' : 'WHERE archived = 0'} ORDER BY updated_at DESC LIMIT 200`).all().map(toThread);
}
export function updateThread(db: DB, id: string, patch: { title?: string; archived?: boolean; defaultBrain?: string }): Thread {
  const t = getThread(db, id); if (!t) throw new AgentError('NOT_FOUND', 'Thread not found', 404);
  db.prepare('UPDATE threads SET title = ?, archived = ?, default_brain = ?, updated_at = ? WHERE id = ?')
    .run(patch.title ?? t.title, patch.archived === undefined ? (t.archived ? 1 : 0) : (patch.archived ? 1 : 0), patch.defaultBrain ?? t.defaultBrain, Date.now(), id);
  return getThread(db, id)!;
}
export function deleteThread(db: DB, id: string): void {
  db.transaction(() => {
    for (const sql of ['DELETE FROM fts_messages WHERE thread_id = ?', 'DELETE FROM events WHERE thread_id = ?', 'DELETE FROM messages WHERE thread_id = ?', 'DELETE FROM turns WHERE thread_id = ?', 'DELETE FROM threads WHERE id = ?']) db.prepare(sql).run(id);
  })();
}
/** Optimistic concurrency: bump the version only if the caller saw the latest one. */
export function bumpThreadVersion(db: DB, id: string, expected: number | undefined): number {
  const r = expected === undefined
    ? db.prepare('UPDATE threads SET version = version + 1, updated_at = ? WHERE id = ? RETURNING version').get(Date.now(), id)
    : db.prepare('UPDATE threads SET version = version + 1, updated_at = ? WHERE id = ? AND version = ? RETURNING version').get(Date.now(), id, expected);
  if (!r) {
    if (!getThread(db, id)) throw new AgentError('NOT_FOUND', 'Thread not found', 404);
    throw new AgentError('CONFLICT', 'Thread changed since you loaded it. Reload and resend.', 409);
  }
  return (r as { version: number }).version;
}

// ---------------------------------------------------------------- messages
export type StoredMsg = Msg & { id: string; seq: number; brain: string | null; turnId: string | null; createdAt: number };

export function appendMessage(db: DB, threadId: string, role: Role, blocks: Block[], opts: { brain?: string | null; turnId?: string | null; providerExtra?: Msg['providerExtra'] } = {}): StoredMsg {
  const id = newId('msg'), now = Date.now();
  const seq = db.transaction(() => {
    const s = ((db.prepare('SELECT MAX(seq) s FROM messages WHERE thread_id = ?').get(threadId) as { s: number | null }).s ?? 0) + 1;
    db.prepare('INSERT INTO messages(id, thread_id, seq, role, content_json, provider_extra, brain, turn_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)')
      .run(id, threadId, s, role, JSON.stringify(blocks), opts.providerExtra ? JSON.stringify(opts.providerExtra) : null, opts.brain ?? null, opts.turnId ?? null, now);
    const text = blocks.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('\n');
    if (text && role !== 'tool') db.prepare('INSERT INTO fts_messages(text, thread_id, message_id) VALUES (?,?,?)').run(text, threadId, id);
    return s;
  })();
  return { id, seq, role, blocks, brain: opts.brain ?? null, turnId: opts.turnId ?? null, createdAt: now, providerExtra: opts.providerExtra };
}
export function listMessages(db: DB, threadId: string): StoredMsg[] {
  return db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY seq').all(threadId).map((r: any) => ({
    id: r.id, seq: r.seq, role: r.role, blocks: JSON.parse(r.content_json), brain: r.brain, turnId: r.turn_id, createdAt: r.created_at,
    providerExtra: r.provider_extra ? JSON.parse(r.provider_extra) : undefined,
  }));
}
export function searchMessages(db: DB, query: string, limit = 8): { threadId: string; messageId: string; snippet: string }[] {
  const q = query.replace(/["*^():]/g, ' ').trim().split(/\s+/).filter(Boolean).map((w) => `"${w}"`).join(' OR ');
  if (!q) return [];
  return db.prepare(`SELECT thread_id, message_id, snippet(fts_messages, 0, '[', ']', '…', 24) s FROM fts_messages WHERE fts_messages MATCH ? ORDER BY bm25(fts_messages) LIMIT ?`)
    .all(q, limit).map((r: any) => ({ threadId: r.thread_id, messageId: r.message_id, snippet: r.s }));
}

// ---------------------------------------------------------------- turns
export function findTurnByKey(db: DB, key: string): string | null {
  return (db.prepare('SELECT id FROM turns WHERE idempotency_key = ?').get(key) as { id: string } | undefined)?.id ?? null;
}
export function createTurn(db: DB, threadId: string, brain: string, idempotencyKey?: string): { id: string; existing: boolean } {
  if (idempotencyKey) {
    const ex = db.prepare('SELECT id FROM turns WHERE idempotency_key = ?').get(idempotencyKey) as { id: string } | undefined;
    if (ex) return { id: ex.id, existing: true };
  }
  const id = newId('turn');
  try {
    db.prepare('INSERT INTO turns(id, thread_id, status, brain, idempotency_key, started_at) VALUES (?,?,?,?,?,?)').run(id, threadId, 'running', brain, idempotencyKey ?? null, Date.now());
  } catch (e) {
    // Lost a race on the unique key: the other request created it first.
    const ex = idempotencyKey && db.prepare('SELECT id FROM turns WHERE idempotency_key = ?').get(idempotencyKey) as { id: string } | undefined;
    if (ex) return { id: ex.id, existing: true };
    throw e;
  }
  return { id, existing: false };
}
export function finishTurn(db: DB, id: string, status: 'succeeded' | 'stopped' | 'failed' | 'interrupted', stopReason?: string, error?: string): void {
  db.prepare('UPDATE turns SET status = ?, finished_at = ?, stop_reason = ?, error = ? WHERE id = ?').run(status, Date.now(), stopReason ?? null, error ?? null, id);
}
/** Turns left 'running' by a crash are marked interrupted at startup. */
export function recoverTurns(db: DB): number {
  return db.prepare("UPDATE turns SET status = 'interrupted', finished_at = ? WHERE status = 'running'").run(Date.now()).changes;
}

// ---------------------------------------------------------------- events (SSE log)
export type Evt = { id: number; threadId: string; type: string; payload: unknown; createdAt: number };
export function appendEvent(db: DB, threadId: string, type: string, payload: unknown): Evt {
  const now = Date.now();
  const r = db.prepare('INSERT INTO events(thread_id, type, payload_json, created_at) VALUES (?,?,?,?)').run(threadId, type, JSON.stringify(payload ?? {}), now);
  return { id: Number(r.lastInsertRowid), threadId, type, payload, createdAt: now };
}
export function eventsAfter(db: DB, threadId: string, afterId: number, limit = 2000): Evt[] {
  return db.prepare('SELECT * FROM events WHERE thread_id = ? AND id > ? ORDER BY id LIMIT ?').all(threadId, afterId, limit)
    .map((r: any) => ({ id: r.id, threadId: r.thread_id, type: r.type, payload: JSON.parse(r.payload_json), createdAt: r.created_at }));
}
export function pruneEvents(db: DB, olderThanMs = 30 * 864e5): number {
  return db.prepare('DELETE FROM events WHERE created_at < ?').run(Date.now() - olderThanMs).changes;
}

// ---------------------------------------------------------------- traces
export function addTraceStep(db: DB, turnId: string, step: number, s: { kind: string; name?: string; args?: unknown; resultSummary?: string; ok?: boolean; usage?: Usage; costUsd?: number; ms?: number }): void {
  db.prepare('INSERT OR REPLACE INTO trace_steps(turn_id, step, kind, name, args_json, result_summary, ok, input_tokens, output_tokens, cost_usd, ms, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)')
    .run(turnId, step, s.kind, s.name ?? null, s.args === undefined ? null : JSON.stringify(s.args), s.resultSummary ?? null, s.ok === undefined ? null : (s.ok ? 1 : 0),
      s.usage?.inputTokens ?? null, s.usage?.outputTokens ?? null, s.costUsd ?? null, s.ms ?? null, Date.now());
}
export function getTrace(db: DB, turnId: string): unknown[] {
  return db.prepare('SELECT * FROM trace_steps WHERE turn_id = ? ORDER BY step').all(turnId);
}

// ---------------------------------------------------------------- cost ledger
export function addCost(db: DB, e: { brain: string; kind: string; units: number; usd: number; priceVersion?: string; turnId?: string; threadId?: string }): void {
  db.prepare('INSERT INTO cost_ledger(ts, brain, kind, units, usd, price_version, turn_id, thread_id) VALUES (?,?,?,?,?,?,?,?)')
    .run(Date.now(), e.brain, e.kind, e.units, e.usd, e.priceVersion ?? null, e.turnId ?? null, e.threadId ?? null);
}
export function spendSince(db: DB, sinceMs: number): number {
  return (db.prepare('SELECT COALESCE(SUM(usd), 0) s FROM cost_ledger WHERE ts >= ?').get(sinceMs) as { s: number }).s;
}
export function spendReport(db: DB, sinceMs: number): { brain: string; kind: string; units: number; usd: number }[] {
  return db.prepare('SELECT brain, kind, SUM(units) units, SUM(usd) usd FROM cost_ledger WHERE ts >= ? GROUP BY brain, kind ORDER BY usd DESC').all(sinceMs) as any[];
}
export const startOfToday = (): number => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };

// ---------------------------------------------------------------- cache
export function cacheGet<T>(db: DB, key: string): T | null {
  const r = db.prepare('SELECT value_json, expires_at FROM cache WHERE key = ?').get(key) as { value_json: string; expires_at: number } | undefined;
  if (!r) return null;
  if (r.expires_at < Date.now()) { db.prepare('DELETE FROM cache WHERE key = ?').run(key); return null; }
  return JSON.parse(r.value_json) as T;
}
export function cacheSet(db: DB, key: string, value: unknown, ttlMs: number): void {
  db.prepare('INSERT OR REPLACE INTO cache(key, value_json, expires_at) VALUES (?,?,?)').run(key, JSON.stringify(value), Date.now() + ttlMs);
}

// ---------------------------------------------------------------- proposals (stored only; applying is user-initiated, later release)
export function addProposal(db: DB, p: { kind: string; target?: string; body: string; sourceTurn?: string }): string {
  const id = newId('prop');
  db.prepare('INSERT INTO proposals(id, kind, target, body, source_turn, created_at) VALUES (?,?,?,?,?,?)').run(id, p.kind, p.target ?? null, p.body, p.sourceTurn ?? null, Date.now());
  return id;
}
export function listProposals(db: DB, status = 'pending'): unknown[] {
  return db.prepare('SELECT * FROM proposals WHERE status = ? ORDER BY created_at DESC').all(status);
}
export function decideProposal(db: DB, id: string, status: 'accepted' | 'rejected'): boolean {
  return db.prepare("UPDATE proposals SET status = ?, decided_at = ? WHERE id = ? AND status = 'pending'").run(status, Date.now(), id).changes === 1;
}
