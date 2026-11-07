// FEAT-014 Policy guardrails: live exposures against the user's own limits.
// Nothing here is an instruction to trade: a breach asks for a review.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useGuardrails } from '../../api/queries.ts';
import { api } from '../../api/client.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import { fmt, money } from '../../ui/format.ts';
import { KINDS } from '../../../../shared/guardrails.ts';
import type { Check, GuardrailReport, Kind, LimitStatus } from '../../../../shared/guardrails.ts';

const STATE_TEXT: Record<Check['state'], string> = { unset: 'UNSET', ok: 'OK', near: 'NEAR', breach: 'BREACH', 'no-data': 'NO DATA' };
const STATE_CLASS: Record<Check['state'], string> = { unset: 'dim', ok: 'up', near: 'warn', breach: 'down', 'no-data': 'dim' };
const FIXED: Kind[] = ['positionMax', 'currencyMax', 'accountMax', 'cashMin', 'cashMax'];

interface Row { kind: Kind; symbol: string; pct: string; status: LimitStatus; note: string }
const rowsFrom = (d: GuardrailReport): Row[] => d.checks.filter((c) => c.limit).map((c) => ({
  kind: c.kind, symbol: c.symbol ?? '', pct: String(c.limit!.pct), status: c.limit!.status, note: c.limit!.note ?? '' }));

function Editor({ d, onDone }: { d: GuardrailReport; onDone: () => void }) {
  const client = useQueryClient();
  const [rows, setRows] = useState<Row[]>(() => rowsFrom(d));
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const fixed = (k: Kind) => rows.find((r) => r.kind === k);
  const setFixed = (k: Kind, patch: Partial<Row>) => setRows((rs) => {
    const cur = rs.find((r) => r.kind === k);
    if (!cur) return [...rs, { kind: k, symbol: '', pct: '', status: 'proposed', note: '', ...patch }];
    return rs.map((r) => r === cur ? { ...r, ...patch } : r);
  });
  const named = rows.filter((r) => r.kind === 'symbolMax');
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const limits = rows.filter((r) => r.pct.trim() !== '').map((r) => ({ kind: r.kind, symbol: r.symbol || undefined, pct: Number(r.pct), status: r.status, note: r.note || undefined }));
      const next = await api<GuardrailReport>('/api/guardrails/limits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ limits }) });
      client.setQueryData(['guardrails', d.base], next);
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  const statusSel = (r: Row | undefined, on: (s: LimitStatus) => void, label: string) =>
    <select aria-label={label} value={r?.status ?? 'proposed'} onChange={(e) => on(e.target.value as LimitStatus)}><option value="proposed">proposed</option><option value="accepted">accepted</option></select>;
  return <div className="gr-edit">
    <div className="fxr-note">Enter only limits you have decided or want to try. Blank = unset. Mark <b>accepted</b> only for limits in your accepted policy.</div>
    <table className="tbl"><thead><tr><th>LIMIT</th><th className="r">%</th><th>STATUS</th></tr></thead><tbody>
      {FIXED.map((k) => { const r = fixed(k); return <tr key={k}>
        <td>{KINDS[k].label} <span className="dim">{KINDS[k].unit}</span></td>
        <td className="r"><input aria-label={`${KINDS[k].label} percent`} className="gr-pct" inputMode="decimal" value={r?.pct ?? ''} onChange={(e) => setFixed(k, { pct: e.target.value })} /></td>
        <td>{statusSel(r, (s) => setFixed(k, { status: s }), `${KINDS[k].label} status`)}</td></tr>; })}
      {named.map((r, i) => <tr key={'n' + i}>
        <td><input aria-label="Named holding symbol" className="gr-sym" placeholder="SYMBOL" value={r.symbol} onChange={(e) => setRows((rs) => rs.map((x) => x === r ? { ...x, symbol: e.target.value.toUpperCase() } : x))} /> <button className="mini-btn" aria-label={`Remove ${r.symbol || 'named'} limit`} onClick={() => setRows((rs) => rs.filter((x) => x !== r))}>✕</button></td>
        <td className="r"><input aria-label={`${r.symbol || 'Named holding'} percent`} className="gr-pct" inputMode="decimal" value={r.pct} onChange={(e) => setRows((rs) => rs.map((x) => x === r ? { ...x, pct: e.target.value } : x))} /></td>
        <td>{statusSel(r, (s) => setRows((rs) => rs.map((x) => x === r ? { ...x, status: s } : x)), `${r.symbol || 'Named holding'} status`)}</td></tr>)}
    </tbody></table>
    <div className="gr-actions">
      <button className="mini-btn" onClick={() => setRows((rs) => [...rs, { kind: 'symbolMax', symbol: '', pct: '', status: 'proposed', note: '' }])}>+ NAMED HOLDING</button>
      <span className="grow" />
      {err && <span className="down" role="alert">{err}</span>}
      <button className="mini-btn" onClick={onDone} disabled={busy}>CANCEL</button>
      <button className="mini-btn" onClick={save} disabled={busy}>SAVE</button>
    </div>
  </div>;
}

export default function GuardrailsIsland() {
  useEffect(() => { const el = document.getElementById('guardrails'); if (el) { el.tabIndex = 0; el.setAttribute('aria-label', 'Policy guardrails'); } }, []);
  const q = useGuardrails(), d = q.data;
  const [editing, setEditing] = useState(false);
  const c = d?.counts;
  const summary = !c ? '' : c.breach ? `${c.breach} BREACH` : c.near ? `${c.near} NEAR` : c.ok ? `${c.ok} OK` : 'LIMITS UNSET';
  const head = <PanelHeadSlot island="guardrails"><span className={c?.breach ? 'down' : c?.near ? 'warn' : ''}>{summary}</span> {d && !editing && <button className="mini-btn" onClick={() => setEditing(true)}>EDIT LIMITS</button>}</PanelHeadSlot>;
  if (q.isError) return <>{head}<span className="down">{q.error.message}</span></>;
  if (!d) return <>{head}<span className="muted">Loading…</span></>;
  if (editing) return <>{head}<Editor d={d} onDone={() => setEditing(false)} /></>;
  const pct = (v: number | undefined) => v == null ? '—' : fmt(v, 1) + '%';
  return <>{head}
    <table className="tbl gr-tbl"><thead><tr><th>CHECK</th><th className="r">NOW</th><th className="r">LIMIT</th><th className="r">STATE</th></tr></thead><tbody>
      {d.checks.map((ch) => <tr key={ch.kind + (ch.symbol ?? '')} className={'gr-' + ch.state}>
        <td>{ch.label}{ch.worst && ch.kind !== 'cashMin' && ch.kind !== 'cashMax' && ch.kind !== 'symbolMax' && <span className="dim"> · {ch.worst.key}</span>}
          {ch.over.length > 1 && <div className="dim small">also {ch.over.filter((o) => o.key !== ch.worst?.key).map((o) => `${o.key} ${pct(o.pct)}`).join(', ')}</div>}</td>
        <td className="r">{ch.worst ? <span title={money(d.base, ch.worst.value, 0)}>{pct(ch.worst.pct)}</span> : '—'}</td>
        <td className="r">{ch.limit ? <>{ch.kind === 'cashMin' ? '≥ ' : '≤ '}{pct(ch.limit.pct)} <span className={ch.limit.status === 'accepted' ? '' : 'dim'}>{ch.limit.status === 'accepted' ? 'accepted' : 'proposed'}</span></> : <span className="dim">unset</span>}</td>
        <td className={'r ' + STATE_CLASS[ch.state]}>{STATE_TEXT[ch.state]}</td>
      </tr>)}
    </tbody></table>
    <div className="fxr-note">Weights are of whole-book net worth ({money(d.base, d.netWorth, 0)}), all accounts. A breach or near reading is a prompt to review, not an instruction to trade. {d.notes.join(' ')}</div>
  </>;
}
