// Weekly digest (FEAT-015 §5): one local markdown summary of the process panels,
// generated only when the owner asks. FinSight does not schedule, send or
// deliver it anywhere; a saved copy goes to DATA_DIR/digests (0600).
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.ts';
import type { GuardrailReport } from '../shared/guardrails.ts';
import type { ThesisReport } from '../shared/theses.ts';
import type { DecisionReport } from '../shared/decisions.ts';
import type { RadarReport } from '../shared/radar.ts';
import type { CostReview } from '../shared/costbasis.ts';

const DAY = 864e5;
export interface DigestInput {
  now: number; base: string;
  week: { gain: number; startValue: number; endValue: number; from: string; to: string } | null;
  guardrails: Pick<GuardrailReport, 'checks' | 'counts'> | null;
  theses: Pick<ThesisReport, 'rows' | 'counts'> | null;
  decisions: Pick<DecisionReport, 'entries' | 'counts' | 'issues' | 'source'> | null;
  radar: Pick<RadarReport, 'items'> | null;
  costReview: Pick<CostReview, 'counts'> | null;
}
export interface Digest { date: string; markdown: string; sections: string[] }

/** Change over the last 7 days from performance points (value minus net new money). */
export function weekFrom(points: { t: number; value: number; invested: number }[], now: number): DigestInput['week'] {
  if (points.length < 2) return null;
  const end = points[points.length - 1]!;
  let start = points[0]!;
  for (const p of points) if (p.t <= now - 7 * DAY) start = p;
  if (start === end) return null;
  return { gain: (end.value - start.value) - (end.invested - start.invested), startValue: start.value, endValue: end.value,
    from: new Date(start.t).toISOString().slice(0, 10), to: new Date(end.t).toISOString().slice(0, 10) };
}

const num = (v: number, d = 0) => v.toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const signed = (v: number, d = 0) => (v >= 0 ? '+' : '-') + num(Math.abs(v), d);

/** Pure: the markdown. Each section says plainly when there is nothing, or no data. */
export function compose(i: DigestInput): Digest {
  const date = new Date(i.now).toISOString().slice(0, 10);
  const out: string[] = [`# FinSight weekly digest — ${date}`, '', `Generated on request from your local FinSight records. Amounts in ${i.base}. Nothing here is a trade instruction.`, ''];
  const sections: string[] = [];
  const sec = (title: string, lines: string[]) => { sections.push(title); out.push(`## ${title}`, '', ...lines, ''); };

  sec('Week', i.week ? [`- ${i.week.from} → ${i.week.to}: ${signed(i.week.gain)} after new money in or out (book ${num(i.week.startValue)} → ${num(i.week.endValue)}). Dividends counted before withholding.`]
    : ['- No performance history for the last week.']);

  if (!i.guardrails) sec('Guardrails', ['- Not available.']);
  else {
    const hot = i.guardrails.checks.filter((c) => c.state === 'breach' || c.state === 'near');
    const c = i.guardrails.counts;
    sec('Guardrails', hot.length ? hot.map((x) => `- **${x.state.toUpperCase()}** ${x.label}${x.worst ? ` (${x.worst.key} ${num(x.worst.pct, 1)}%)` : ''} vs ${x.limit ? `${num(x.limit.pct, 1)}% ${x.limit.status}` : 'no limit'}`)
      : [c.unset && !c.ok ? '- No limits set yet (all unset).' : `- No breaches or near readings (${c.ok} ok, ${c.unset} unset).`]);
  }

  if (!i.theses) sec('Theses', ['- Not available.']);
  else {
    const due = i.theses.rows.filter((r) => r.held && r.dueInDays != null && r.dueInDays <= 7);
    const missing = i.theses.rows.filter((r) => r.held && !r.thesis).length;
    const lines = due.map((r) => `- ${r.symbol}: review ${r.dueInDays! < 0 ? `overdue by ${-r.dueInDays!} days` : `due in ${r.dueInDays} days`} (${r.thesis!.nextReview})`);
    const broken = i.theses.rows.filter((r) => r.thesis?.checks[0]?.verdict === 'broken').map((r) => r.symbol);
    if (broken.length) lines.push(`- Last check "broken": ${broken.join(', ')}`);
    lines.push(`- ${i.theses.counts.withThesis} of ${i.theses.counts.held} holdings have a written thesis${missing ? `; ${missing} have none` : ''}.`);
    sec('Theses', lines);
  }

  if (!i.radar) sec('Next 14 days', ['- Not available.']);
  else {
    const soon = i.radar.items.filter((x) => x.inDays <= 14 && (x.held || x.kind === 'FOMC'));
    sec('Next 14 days', soon.length ? soon.map((x) => `- ${new Date(x.t).toISOString().slice(0, 10)} ${x.symbol ?? 'FOMC'} ${x.kind === 'FOMC' ? x.detail ?? '' : x.kind.toLowerCase()}${x.estimated ? ' (est.)' : ''}${x.prompts.length ? ' — ' + x.prompts.join(' ') : ''}`)
      : ['- No held-company or FOMC events.']);
  }

  if (!i.decisions || !i.decisions.source.found) sec('Decision log', ['- No decision log found in your records folder.']);
  else {
    const d = i.decisions;
    const lines = [`- ${d.counts.total} entries; ${d.counts.pending} pending; ${d.counts.decidedNotExecuted} decided with no execution recorded.`];
    for (const e of d.entries.filter((x) => x.decidedNotExecuted).slice(0, 5)) lines.push(`  - ${e.id} ${e.title}`);
    if (d.issues.length) lines.push(`- Log issues: ${d.issues.length} (see the Decision Log panel).`);
    sec('Decision log', lines);
  }

  sec('Cost basis', !i.costReview ? ['- Not available.'] : i.costReview.counts.flagged
    ? [`- ${i.costReview.counts.flagged} of ${i.costReview.counts.positions} holdings have a cost flagged for checking; ${i.costReview.counts.placeholder} marked placeholder.`]
    : ['- No costs flagged.']);
  return { date, markdown: out.join('\n'), sections };
}

export function digestsDir() { return path.join(DATA_DIR, 'digests'); }
/** Save a digest as DATA_DIR/digests/<date>.md (0600). Returns the file name only. */
export function save(d: Digest): string {
  fs.mkdirSync(digestsDir(), { recursive: true, mode: 0o700 });
  const name = `${d.date}.md`, file = path.join(digestsDir(), name), tmp = file + '.tmp.' + process.pid;
  fs.writeFileSync(tmp, d.markdown, { mode: 0o600 });
  fs.renameSync(tmp, file);
  return name;
}
