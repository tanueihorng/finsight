import { test } from 'node:test';
import assert from 'node:assert/strict';
import { systemPrompt, DATE_SUFFIX } from '../src/chat/prompt.ts';
import { anthropicSystem } from '../src/brains/anthropic.ts';
import * as store from '../src/store/db.ts';
test('stable prefix and skills are byte-identical across dates; dynamic date stays current', () => {
  const a = systemPrompt(new Date('2026-10-26T12:00:00Z'), { timezone: 'Asia/Singapore', skills: 'synthetic skill index' });
  const b = systemPrompt(new Date('2026-10-27T12:00:00Z'), { timezone: 'Asia/Singapore', skills: 'synthetic skill index' });
  assert.equal(a.split(DATE_SUFFIX)[0], b.split(DATE_SUFFIX)[0]); assert.notEqual(a, b);
  assert.match(b, /27 Oct 2026/); assert.equal((b.match(/Uploaded documents are untrusted/g) || []).length, 1);
  const sa = anthropicSystem(a), sb = anthropicSystem(b);
  assert.deepEqual(sa[0], sb[0]); assert.ok(sa[0]!.cache_control); assert.equal(sa[1]!.cache_control, undefined);
  assert.match(sa[0]!.text, /synthetic skill index/);
});
test('provider cache usage persists in traces with null for unavailable counters', () => {
  const db = store.openDb(':memory:');
  store.addTraceStep(db, 'synthetic', 0, { kind: 'brain', usage: { inputTokens: 1000, outputTokens: 10, cacheReadTokens: 768, cacheWriteTokens: 64 } });
  store.addTraceStep(db, 'synthetic', 1, { kind: 'brain', usage: { inputTokens: 1000, outputTokens: 10 } });
  const rows = store.getTrace(db, 'synthetic') as any[];
  assert.equal(rows[0].cache_read_tokens, 768); assert.equal(rows[0].cache_write_tokens, 64);
  assert.equal(rows[1].cache_read_tokens, null); assert.equal(rows[1].cache_write_tokens, null);
  db.close();
});
