// FEAT-014 §3 Decision log: a read-only view of DECISION_LOG.md that keeps
// proposals, user decisions and executions apart. FinSight never edits the log.
import { useEffect, useState } from 'react';
import { useDecisions } from '../../api/queries.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import type { DecisionEntry } from '../../../../shared/decisions.ts';

type Filter = 'all' | 'pending' | 'dne';
const DEC_CLASS = { pending: 'warn', decided: '', unknown: 'dim' } as const;
const EXE_CLASS = { none: 'dim', recorded: 'up', unknown: 'dim' } as const;

export default function DecisionsIsland() {
  useEffect(() => { const el = document.getElementById('decisions'); if (el) { el.tabIndex = 0; el.setAttribute('aria-label', 'Decision log'); } }, []);
  const q = useDecisions(), d = q.data;
  const [filter, setFilter] = useState<Filter>('all'), [open, setOpen] = useState<number | null>(null);
  const c = d?.counts;
  const head = <PanelHeadSlot island="decisions">{c && <span>{c.total} ENTRIES · {c.pending} PENDING{c.decidedNotExecuted ? ` · ${c.decidedNotExecuted} NOT EXECUTED` : ''}</span>}</PanelHeadSlot>;
  if (q.isError) return <>{head}<span className="down">{q.error.message}</span></>;
  if (!d) return <>{head}<span className="muted">Loading…</span></>;
  if (!d.source.found) return <>{head}<span className="muted">No DECISION_LOG.md in your records folder. Set <b>recordsDir</b> in the agent's config.json (or RECORDS_DIR) to the folder that holds it.</span></>;
  const pick = (e: DecisionEntry) => filter === 'all' || (filter === 'pending' ? e.decisionTag === 'pending' : e.decidedNotExecuted);
  const rows = d.entries.map((e, i) => [e, i] as const).filter(([e]) => pick(e));
  const btn = (f: Filter, label: string) => <button className={'mini-btn' + (filter === f ? ' active' : '')} aria-pressed={filter === f} onClick={() => setFilter(f)}>{label}</button>;
  return <>{head}
    <div className="gr-actions dc-filter">{btn('all', 'ALL')}{btn('pending', 'PENDING')}{btn('dne', 'DECIDED, NOT EXECUTED')}</div>
    {!rows.length ? <div className="muted">Nothing matches.</div> :
    <table className="tbl dc-tbl"><thead><tr><th>DATE</th><th>ENTRY</th><th>USER DECISION</th><th>EXECUTION</th></tr></thead><tbody>
      {rows.map(([e, i]) => [
        <tr key={i} className={e.decidedNotExecuted ? 'gr-near' : ''}>
          <td className="dim">{e.date}</td>
          <td><button className="linkish" aria-expanded={open === i} onClick={() => setOpen(open === i ? null : i)}>{e.id}</button><div>{e.title}</div></td>
          <td className={DEC_CLASS[e.decisionTag]}>{e.decision ?? 'not stated'}</td>
          <td className={EXE_CLASS[e.executionTag]}>{e.execution ?? 'not stated'}</td>
        </tr>,
        open === i ? <tr key={i + ':b'}><td colSpan={4}><pre className="dc-body">{e.body}</pre></td></tr> : null,
      ])}
    </tbody></table>}
    {!!d.issues.length && <div className="fxr-note warn">Log issues: {d.issues.join(' ')}</div>}
    <div className="fxr-note">Read-only view of DECISION_LOG.md{d.source.modifiedAt ? `, saved ${new Date(d.source.modifiedAt).toLocaleString()}` : ''}. Decision and execution text is shown as written; "decided, not executed" only means a decision line that is not "pending" next to an execution line of "none". Price movement is not a decision.</div>
  </>;
}
