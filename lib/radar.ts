// Event radar (FEAT-015 §4): upcoming earnings, ex-dividend dates and FOMC
// decisions joined with what the owner's own records say about each holding:
// weight, thesis review state, last verdict, max weight and guardrails. It
// prompts preparation; it never suggests a trade.
import { upcomingEvents } from './dividends.ts';
import { FOMC_SCHEDULE } from './macro.ts';
import type { EventItem } from '../shared/types.ts';
import type { ThesisRow } from '../shared/theses.ts';
import type { Check } from '../shared/guardrails.ts';
import type { RadarItem, RadarReport } from '../shared/radar.ts';
export type { RadarItem, RadarReport };

const DAY = 864e5;
export interface RadarInput {
  now: number; horizonDays: number;
  events: EventItem[]; eventsOk: boolean;
  fomc: { end: string; sep: boolean }[];
  weights: Record<string, number>; // whole-book % by symbol
  theses: ThesisRow[];
  guardrails: Check[];
}

export function radar(i: RadarInput): RadarReport {
  const until = i.now + i.horizonDays * DAY;
  const thesis = new Map(i.theses.map((r) => [r.symbol.toUpperCase(), r]));
  const guard = new Map<string, Check[]>();
  for (const c of i.guardrails) {
    if (c.state !== 'breach' && c.state !== 'near') continue;
    const sym = c.kind === 'symbolMax' ? c.symbol : c.kind === 'positionMax' ? c.worst?.key : undefined;
    if (sym) guard.set(sym.toUpperCase(), [...(guard.get(sym.toUpperCase()) ?? []), c]);
  }
  const items: RadarItem[] = [];
  for (const e of i.events) {
    if (e.t < i.now - DAY || e.t > until) continue;
    const S = e.symbol.toUpperCase(), w = i.weights[S] ?? null;
    const prompts: string[] = [];
    let level: RadarItem['level'] = 'info';
    const tr = thesis.get(S), th = tr?.thesis;
    if (e.kind === 'EARNINGS' && e.held) {
      if (!th) prompts.push('No written thesis before the report.');
      else {
        const due = tr!.dueInDays;
        const eventDay = Math.floor((e.t - i.now) / DAY);
        if (due != null && due < 0) prompts.push(`Thesis review overdue by ${-due} days.`);
        else if (due != null && due <= eventDay + 7) prompts.push(`Thesis review due ${th.nextReview}, around the report.`);
        const last = th.checks[0];
        if (last && (last.verdict === 'weakened' || last.verdict === 'broken')) prompts.push(`Last check (${last.date}): ${last.verdict}.`);
        const urgent = th.triggers.filter((x) => x.urgent).length;
        if (urgent) prompts.push(`${urgent} urgent invalidation condition${urgent > 1 ? 's' : ''} to check against the results.`);
      }
      level = prompts.length ? 'review' : 'info';
    }
    if (e.held) {
      if (tr?.overMaxWeight) { prompts.push(`Above your intended max weight (${th!.maxWeightPct}%).`); level = 'review'; }
      for (const c of guard.get(S) ?? []) { prompts.push(`Guardrail ${c.label}: ${c.state}${c.limit?.status === 'accepted' ? '' : ' (proposed limit)'}.`); level = 'review'; }
    }
    items.push({ t: e.t, inDays: Math.max(0, Math.ceil((e.t - i.now) / DAY)), kind: e.kind, symbol: S, estimated: e.estimated, held: e.held, weightPct: w,
      prompts, level, ...(e.kind === 'EX-DIV' && e.amount != null ? { detail: `about ${e.amount} per share` } : {}) });
  }
  for (const m of i.fomc) {
    const t = Date.parse(m.end + 'T18:30:00Z'); // ~14:00 ET
    if (t < i.now - DAY / 2 || t > until) continue;
    items.push({ t, inDays: Math.max(0, Math.ceil((t - i.now) / DAY)), kind: 'FOMC', symbol: null, estimated: false, held: false, weightPct: null,
      prompts: [], level: 'info', detail: m.sep ? 'rate decision with projections (dot plot)' : 'rate decision' });
  }
  items.sort((a, b) => a.t - b.t);
  const through = i.fomc.length ? i.fomc[i.fomc.length - 1]!.end : null;
  const notes = ['Dates come from Yahoo Finance; "est." dates are projected and can move. A prompt is a reminder to prepare from your own records, not a reason to trade.'];
  if (!i.eventsOk) notes.push('Company dates could not be fetched just now; only FOMC dates are shown.');
  if (through && Date.parse(through) < until) notes.push(`FinSight's FOMC list ends at ${through}; later meetings are not shown until it is refreshed.`);
  return { asOf: i.now, horizonDays: i.horizonDays, items,
    counts: { review: items.filter((x) => x.level === 'review').length, earningsHeld: items.filter((x) => x.kind === 'EARNINGS' && x.held).length },
    sources: { events: i.eventsOk, fomcScheduleThrough: through }, notes };
}

export async function radarReport(ctx: Omit<RadarInput, 'now' | 'events' | 'eventsOk' | 'fomc' | 'horizonDays'>, horizonDays = 30): Promise<RadarReport> {
  const ev = await upcomingEvents('ALL').catch(() => ({ events: [], ok: false }));
  return radar({ ...ctx, now: Date.now(), horizonDays, events: ev.events, eventsOk: ev.ok, fomc: FOMC_SCHEDULE });
}
