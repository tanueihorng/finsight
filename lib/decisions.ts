// Decision log view (FEAT-014 §3): a read-only parse of the owner's
// DECISION_LOG.md. FinSight never writes the log. The user-decision and
// execution lines are shown as written; the tags are only a coarse reading of
// their first words so the panel can sort and flag "decided, not executed".
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.ts';
import type { DecisionEntry, DecisionReport, DecisionTag, ExecutionTag } from '../shared/decisions.ts';
export type { DecisionEntry, DecisionReport };

/** RECORDS_DIR, else recordsDir from the agent's config (the same folder Kestrel reads), else DATA_DIR/records. */
export function recordsDir(): string {
  if (process.env.RECORDS_DIR) return path.resolve(process.env.RECORDS_DIR);
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'agent', 'config.json'), 'utf8'));
    if (typeof cfg?.recordsDir === 'string' && cfg.recordsDir) return path.resolve(cfg.recordsDir);
  } catch { /* no agent config */ }
  return path.join(DATA_DIR, 'records');
}

const HEAD_RE = /^#{2,3}\s+(D-(\d{4})(\d{2})(\d{2})-\d{3})\s*[—–-]+\s*(.+?)\s*$/;
const strip = (s: string) => s.replace(/\*\*/g, '').trim();

/** The text after "User decision…:" / "Execution…:", which may share one line. */
function field(body: string, re: RegExp): string | null {
  for (const line of body.split('\n')) {
    const m = strip(line.replace(/^\s*-\s*/, '')).match(re);
    if (m) return m[1]!.trim().replace(/\s+Execution[^:]*:.*$/i, '').trim() || null;
  }
  return null;
}
export function decisionTag(s: string | null): DecisionTag {
  if (!s) return 'unknown';
  return /^pending\b/i.test(s) ? 'pending' : 'decided';
}
export function executionTag(s: string | null): ExecutionTag {
  if (!s) return 'unknown';
  return /^(none|unexecuted|not executed|no trade)\b/i.test(s) ? 'none' : 'recorded';
}

/** Pure: parse the markdown. Placeholder ids (the template) are skipped. */
export function parse(md: string): { entries: DecisionEntry[]; issues: string[] } {
  const lines = md.split('\n');
  const entries: DecisionEntry[] = [], issues: string[] = [];
  let cur: { id: string; date: string; title: string; start: number } | null = null;
  const close = (end: number) => {
    if (!cur) return;
    const body = lines.slice(cur.start, end).join('\n').trim();
    const decision = field(body, /^User decision[^:]*:\s*(.*)$/i);
    const execution = field(body, /^(?:.*?\.\s+)?Execution[^:]*:\s*(.*)$/i);
    const dt = decisionTag(decision), et = executionTag(execution);
    entries.push({ id: cur.id, date: cur.date, title: cur.title, decision, execution, decisionTag: dt, executionTag: et,
      decidedNotExecuted: dt === 'decided' && et === 'none', body });
    cur = null;
  };
  lines.forEach((line, i) => {
    if (/^#{1,3}\s/.test(line)) {
      close(i);
      const m = line.match(HEAD_RE);
      if (m) {
        const date = `${m[2]}-${m[3]}-${m[4]}`;
        if (Number.isNaN(Date.parse(date))) { issues.push(`Line ${i + 1}: ${m[1]} has an invalid date.`); return; }
        cur = { id: m[1]!, date, title: strip(m[5]!), start: i + 1 };
      }
    }
  });
  close(lines.length);
  const seen = new Map<string, number>();
  for (const e of entries) seen.set(e.id, (seen.get(e.id) ?? 0) + 1);
  for (const [id, n] of seen) if (n > 1) issues.push(`${id} is used by ${n} entries; a correction should give one a new id.`);
  for (const e of entries) {
    if (!e.decision) issues.push(`${e.id}: no "User decision" line.`);
    if (!e.execution) issues.push(`${e.id}: no "Execution" line.`);
  }
  // Newest first; the log is append-only, so file order breaks ties.
  const order = new Map(entries.map((e, i) => [e, i]));
  entries.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '') || order.get(b)! - order.get(a)!);
  return { entries, issues };
}

export function report(): DecisionReport {
  const file = path.join(recordsDir(), 'DECISION_LOG.md');
  let md: string, modifiedAt: number | null = null;
  try { md = fs.readFileSync(file, 'utf8'); modifiedAt = fs.statSync(file).mtimeMs; }
  catch { return { source: { file: 'DECISION_LOG.md', found: false, modifiedAt: null }, entries: [], counts: { total: 0, pending: 0, decided: 0, decidedNotExecuted: 0 }, issues: [] }; }
  const { entries, issues } = parse(md);
  return {
    // The file name only: the folder path is personal and not needed by the browser.
    source: { file: 'DECISION_LOG.md', found: true, modifiedAt },
    entries, issues,
    counts: { total: entries.length, pending: entries.filter((e) => e.decisionTag === 'pending').length,
      decided: entries.filter((e) => e.decisionTag === 'decided').length, decidedNotExecuted: entries.filter((e) => e.decidedNotExecuted).length },
  };
}
