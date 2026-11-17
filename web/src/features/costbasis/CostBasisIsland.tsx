// FEAT-015 §3 Cost-basis review: flags costs that look like placeholders or
// import artefacts. Flags change nothing; only a cost the owner types is
// written, through the ledger, as one undoable step.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCostReview } from '../../api/queries.ts';
import { api } from '../../api/client.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import { confirmDialog } from '../../ui/dialog.tsx';
import { fmt } from '../../ui/format.ts';
import type { CostReview, CostReviewRow } from '../../../../shared/costbasis.ts';

const post = (url: string, body: unknown) => api<CostReview>(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

function Row({ r, base, onErr }: { r: CostReviewRow; base: string; onErr: (m: string) => void }) {
  const client = useQueryClient();
  const [open, setOpen] = useState(false), [cost, setCost] = useState(''), [busy, setBusy] = useState(false);
  const put = (d: CostReview) => client.setQueryData(['costbasis', base], d);
  const mark = async (status: string) => {
    setBusy(true); onErr('');
    try { put(await post('/api/costbasis/mark', { account: r.accountId, symbol: r.symbol, status })); } catch (e) { onErr((e as Error).message); } finally { setBusy(false); }
  };
  const apply = async () => {
    const v = Number(cost);
    if (!(v > 0)) { onErr('Enter a positive average cost'); return; }
    const ok = await confirmDialog({ title: `Set ${r.symbol} average cost to ${fmt(v, 4)} ${r.currency}?`,
      body: `${r.account}: from ${fmt(r.avgCost, 4)}. Every open lot's price is scaled by the same factor; quantities and dates are kept. UNDO reverses it.`, ok: 'Set cost' });
    if (!ok) return;
    setBusy(true); onErr('');
    try { put(await post('/api/costbasis/set', { account: r.accountId, symbol: r.symbol, avgCost: v })); setCost(''); setOpen(false); await window.FinSight.bus.write('ledger-edit'); }
    catch (e) { onErr((e as Error).message); } finally { setBusy(false); }
  };
  const bad = r.lotChecks?.filter((c) => c.inRange === false) ?? [];
  return <>
    <tr className={r.flags.length ? 'gr-near' : ''}>
      <td><button className="linkish" aria-expanded={open} onClick={() => setOpen(!open)}>{r.symbol}</button><div className="dim small">{r.account}</div></td>
      <td className="r">{fmt(r.avgCost, 4)} <span className="dim">{r.currency}</span></td>
      <td>{r.flags.length ? r.flags.map((f) => <div key={f.flag} className="small">{f.reason}</div>) : <span className="dim">no flags</span>}</td>
      <td className="r">{r.mark ? <span className={r.mark.status === 'confirmed' ? 'up' : 'warn'}>{r.mark.status}</span> : <span className="dim">—</span>}</td>
    </tr>
    {open && <tr><td colSpan={4}><div className="cb-detail">
      {bad.map((c, i) => <div key={i} className="small warn">Lot {c.t ? new Date(c.t).toISOString().slice(0, 10) : '?'} at {fmt(c.px, 4)}: that week traded {fmt(c.weekLow, 4)}–{fmt(c.weekHigh, 4)}.</div>)}
      <div className="gr-actions">
        <button className="mini-btn" disabled={busy} onClick={() => mark('confirmed')}>CONFIRM COST</button>
        <button className="mini-btn" disabled={busy} onClick={() => mark('placeholder')}>MARK PLACEHOLDER</button>
        {r.mark && <button className="mini-btn" disabled={busy} onClick={() => mark('clear')}>CLEAR MARK</button>}
        <span className="grow" />
        {r.editable ? <>
          <input aria-label={`New average cost for ${r.symbol}`} className="gr-pct" inputMode="decimal" placeholder="avg cost" value={cost} onChange={(e) => setCost(e.target.value)} />
          <button className="mini-btn" disabled={busy || !cost} onClick={apply}>SET COST</button>
        </> : <span className="dim small">{r.editBlock}</span>}
      </div>
    </div></td></tr>}
  </>;
}

export default function CostBasisIsland() {
  useEffect(() => { const el = document.getElementById('costbasis'); if (el) { el.tabIndex = 0; el.setAttribute('aria-label', 'Cost basis review'); } }, []);
  const q = useCostReview(), d = q.data, client = useQueryClient();
  const base = window.FinSight?.store.getState().base ?? 'SGD';
  const [all, setAll] = useState(false), [err, setErr] = useState(''), [checking, setChecking] = useState(false);
  const check = async () => {
    setChecking(true); setErr('');
    try { client.setQueryData(['costbasis', base], await api<CostReview>(`/api/costbasis?base=${encodeURIComponent(base)}&check=1`)); }
    catch (e) { setErr((e as Error).message); } finally { setChecking(false); }
  };
  const c = d?.counts;
  const head = <PanelHeadSlot island="costbasis">{c && <span className={c.flagged ? 'warn' : ''}>{c.flagged} OF {c.positions} FLAGGED</span>}</PanelHeadSlot>;
  if (q.isError) return <>{head}<span className="down">{q.error.message}</span></>;
  if (!d) return <>{head}<span className="muted">Loading…</span></>;
  const rows = all ? d.rows : d.rows.filter((r) => r.flags.length);
  return <>{head}
    <div className="gr-actions">
      <button className={'mini-btn' + (all ? '' : ' active')} aria-pressed={!all} onClick={() => setAll(false)}>FLAGGED</button>
      <button className={'mini-btn' + (all ? ' active' : '')} aria-pressed={all} onClick={() => setAll(true)}>ALL</button>
      <span className="grow" />
      <button className="mini-btn" disabled={checking} onClick={check}>{checking ? 'CHECKING…' : d.checked ? 'RECHECK PRICES' : 'CHECK PRICES'}</button>
    </div>
    {err && <div className="down" role="alert">{err}</div>}
    {!rows.length ? <div className="muted">{d.rows.length ? 'Nothing flagged.' : 'No holdings.'}</div> :
    <table className="tbl cb-tbl"><thead><tr><th>HOLDING</th><th className="r">AVG COST</th><th>WHY</th><th className="r">MARK</th></tr></thead>
      <tbody>{rows.map((r) => <Row key={r.accountId + r.symbol} r={r} base={base} onErr={setErr} />)}</tbody></table>}
    <div className="fxr-note">{d.notes.join(' ')}{d.checked ? '' : ' Price ranges not checked yet.'}</div>
  </>;
}
