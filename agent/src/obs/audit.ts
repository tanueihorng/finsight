// Interaction log: every API request, model request/response, tool call and
// result, FinSight call, MCP call and error, one JSON line each, in daily
// files under <home>/logs/. Lines carry ids (turnId, threadId, reqId) so one
// answer can be traced end to end. Redacted before writing; large fields are
// capped; files older than the retention window are deleted at startup.
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { redact } from '../log.ts';

/** Correlation ids (turnId, threadId) carried across async calls, so nested calls are tagged automatically. */
export const auditContext = new AsyncLocalStorage<Record<string, string>>();

const MAX_FIELD = 100_000;

function cap(v: unknown): unknown {
  if (typeof v === 'string') return v.length > MAX_FIELD ? v.slice(0, MAX_FIELD) + `…[+${v.length - MAX_FIELD} chars]` : v;
  if (v && typeof v === 'object') {
    const s = JSON.stringify(v);
    if (s.length > MAX_FIELD) return { truncated: true, chars: s.length, head: s.slice(0, MAX_FIELD) };
  }
  return v;
}

export class AuditLog {
  dir: string; retentionDays: number;
  private day = ''; private fd: number | null = null;
  constructor(dir: string, retentionDays = 14) {
    this.dir = dir; this.retentionDays = retentionDays;
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    this.prune();
  }
  private file(day: string) { return path.join(this.dir, `${day}.jsonl`); }
  write(kind: string, fields: Record<string, unknown> = {}): void {
    try {
      const now = new Date();
      const day = now.toISOString().slice(0, 10);
      if (day !== this.day || this.fd == null) {
        if (this.fd != null) fs.closeSync(this.fd);
        this.fd = fs.openSync(this.file(day), 'a', 0o600); this.day = day;
      }
      const rec: Record<string, unknown> = { ts: now.toISOString(), kind };
      for (const [k, v] of Object.entries(fields)) rec[k] = cap(v);
      fs.writeSync(this.fd, redact(JSON.stringify(rec)) + '\n');
    } catch { /* logging must never break the app */ }
  }
  prune(): void {
    const cutoff = Date.now() - this.retentionDays * 864e5;
    for (const f of fs.readdirSync(this.dir)) {
      const m = f.match(/^(\d{4}-\d{2}-\d{2})\.jsonl$/);
      if (m && Date.parse(m[1]!) < cutoff) { try { fs.unlinkSync(path.join(this.dir, f)); } catch { /* ignore */ } }
    }
  }
  /** Read back lines (newest file last), optionally filtered. */
  read(filter: { turnId?: string; kind?: string; days?: number; limit?: number } = {}): Record<string, unknown>[] {
    const files = fs.readdirSync(this.dir).filter((f) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(f)).sort().slice(-(filter.days ?? 2));
    const out: Record<string, unknown>[] = [];
    for (const f of files) {
      for (const line of fs.readFileSync(path.join(this.dir, f), 'utf8').split('\n')) {
        if (!line) continue;
        let r: Record<string, unknown>; try { r = JSON.parse(line); } catch { continue; }
        if (filter.turnId && r.turnId !== filter.turnId) continue;
        if (filter.kind && !String(r.kind).startsWith(filter.kind)) continue;
        out.push(r);
      }
    }
    return out.slice(-(filter.limit ?? 500));
  }
}

let current: AuditLog | null = null;
export function setAudit(a: AuditLog | null): void { current = a; }
export function audit(kind: string, fields: Record<string, unknown> = {}): void {
  if (!current) return;
  const ctx = auditContext.getStore();
  current.write(kind, ctx ? { ...ctx, ...fields } : fields);
}
export function getAudit(): AuditLog | null { return current; }
