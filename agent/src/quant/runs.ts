// Saved portfolio backtests (FEAT-014 milestone 2). Each run keeps the exact bars
// it used, compressed and shared between runs by content hash.
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import type { DB } from '../store/db.ts';
import { newId } from '../store/db.ts';
import { AgentError } from '../types.ts';
import { fingerprint } from './data.ts';
import type { Bar } from './data.ts';

export const MAX_SAVED_RUNS = 100;

export type SavedRun = { id: string; createdAt: number; strategyKey: string; series: Record<string, Bar[]>; result: Record<string, any>; robustness: Record<string, any> | null };

export const digest = (value: unknown): string => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function saveRun(db: DB, run: Omit<SavedRun, 'id' | 'createdAt' | 'robustness'>): string {
  const id = newId('qr');
  db.transaction(() => {
    db.prepare('INSERT INTO quant_runs(id, created_at, strategy_key, result_json) VALUES (?,?,?,?)').run(id, Date.now(), run.strategyKey, JSON.stringify(run.result));
    for (const [symbol, bars] of Object.entries(run.series)) {
      const hash = digest(bars);
      db.prepare('INSERT OR IGNORE INTO quant_series(sha256, bars_gz) VALUES (?,?)').run(hash, zlib.gzipSync(JSON.stringify(bars)));
      db.prepare('INSERT INTO quant_run_series(run_id, symbol, sha256) VALUES (?,?,?)').run(id, symbol, hash);
    }
    db.prepare('DELETE FROM quant_runs WHERE id NOT IN (SELECT id FROM quant_runs ORDER BY created_at DESC, rowid DESC LIMIT ?)').run(MAX_SAVED_RUNS);
    db.exec('DELETE FROM quant_series WHERE sha256 NOT IN (SELECT sha256 FROM quant_run_series)');
  })();
  return id;
}

const corrupt = (id: string, what: string) => new AgentError('QUANT_RUN_CORRUPT', `Saved run ${id} failed its integrity check: ${what}.`);

/** Loads a run and proves its bars are the ones it was computed on. */
export function loadRun(db: DB, id: string): SavedRun {
  const row = db.prepare('SELECT created_at, strategy_key, result_json, robustness_json FROM quant_runs WHERE id = ?').get(id) as { created_at: number; strategy_key: string; result_json: string; robustness_json: string | null } | undefined;
  if (!row) throw new AgentError('NOT_FOUND', `No saved quant run ${id}`);
  const links = db.prepare('SELECT l.symbol, l.sha256, s.bars_gz FROM quant_run_series l JOIN quant_series s ON s.sha256 = l.sha256 WHERE l.run_id = ?').all(id) as { symbol: string; sha256: string; bars_gz: Buffer }[];
  const series: Record<string, Bar[]> = {};
  for (const link of links) {
    let bars: Bar[];
    try { bars = JSON.parse(zlib.gunzipSync(link.bars_gz).toString('utf8')); } catch { throw corrupt(id, `${link.symbol} bars are unreadable`); }
    if (digest(bars) !== link.sha256) throw corrupt(id, `${link.symbol} bars changed`);
    series[link.symbol] = bars;
  }
  const result = JSON.parse(row.result_json) as Record<string, any>;
  if (fingerprint(series) !== result.provenance.datasetSha256) throw corrupt(id, 'the stored dataset does not match the hash recorded with the result');
  return { id, createdAt: row.created_at, strategyKey: row.strategy_key, series, result, robustness: row.robustness_json ? JSON.parse(row.robustness_json) : null };
}

export function saveRobustness(db: DB, id: string, robustness: Record<string, unknown>): void {
  db.prepare('UPDATE quant_runs SET robustness_json = ? WHERE id = ?').run(JSON.stringify(robustness), id);
}

export function listRuns(db: DB, limit: number): { id: string; createdAt: number; result: Record<string, any>; robustness: Record<string, any> | null }[] {
  const rows = db.prepare('SELECT id, created_at, result_json, robustness_json FROM quant_runs ORDER BY created_at DESC, rowid DESC LIMIT ?').all(limit) as { id: string; created_at: number; result_json: string; robustness_json: string | null }[];
  return rows.map((r) => ({ id: r.id, createdAt: r.created_at, result: JSON.parse(r.result_json), robustness: r.robustness_json ? JSON.parse(r.robustness_json) : null }));
}
