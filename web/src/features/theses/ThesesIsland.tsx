// FEAT-017 §2 Thesis tracker: the owner's written case per holding, its
// disproving conditions and review dates. FinSight never writes a verdict.
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTheses } from '../../api/queries.ts';
import { api } from '../../api/client.ts';
import { PanelHeadSlot } from '../../ui/PanelHeadSlot.tsx';
import { confirmDialog } from '../../ui/dialog.tsx';
import { fmt } from '../../ui/format.ts';
import { ROLES, TRIGGER_KINDS, VERDICTS, VERDICT_TEXT } from '../../../../shared/theses.ts';
import type { Role, Thesis, ThesisReport, ThesisRow, TriggerKind, Verdict } from '../../../../shared/theses.ts';

const VERDICT_CLASS: Record<Verdict, string> = { intact: 'up', weakened: 'warn', broken: 'down', insufficient: 'dim' };
const post = (path: string, body: unknown) => api<ThesisReport>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

interface Draft { symbol: string; role: Role; mechanism: string; triggers: { text: string; kind: TriggerKind; urgent: boolean }[];
  low: string; high: string; currency: string; vnote: string; maxWeightPct: string; reviewEveryDays: string; nextReview: string }
const draftFrom = (r: ThesisRow): Draft => {
  const t = r.thesis;
  return { symbol: r.symbol, role: t?.role ?? 'unclassified', mechanism: t?.mechanism ?? '', triggers: t?.triggers.length ? t.triggers.map((x) => ({ ...x })) : [{ text: '', kind: 'business', urgent: false }],
    low: t?.valuation?.low?.toString() ?? '', high: t?.valuation?.high?.toString() ?? '', currency: t?.valuation?.currency ?? r.currency ?? '', vnote: t?.valuation?.note ?? '',
    maxWeightPct: t?.maxWeightPct?.toString() ?? '', reviewEveryDays: String(t?.reviewEveryDays ?? 90), nextReview: t?.nextReview ?? '' };
};

function Editor({ row, base, onDone }: { row: ThesisRow; base: string; onDone: () => void }) {
  const client = useQueryClient();
  const [d, setD] = useState<Draft>(() => draftFrom(row));
  const [err, setErr] = useState(''), [busy, setBusy] = useState(false);
  const set = (p: Partial<Draft>) => setD((x) => ({ ...x, ...p }));
  const setTrig = (i: number, p: Partial<Draft['triggers'][number]>) => setD((x) => ({ ...x, triggers: x.triggers.map((t, j) => j === i ? { ...t, ...p } : t) }));
  const save = async () => {
    setBusy(true); setErr('');
    try {
      const thesis = { symbol: d.symbol, role: d.role, mechanism: d.mechanism, triggers: d.triggers.filter((t) => t.text.trim()),
        valuation: { low: d.low, high: d.high, currency: d.currency, note: d.vnote }, maxWeightPct: d.maxWeightPct, reviewEveryDays: d.reviewEveryDays,
        nextReview: d.nextReview || undefined };
      client.setQueryData(['theses', base], await post('/api/theses/save', { thesis }));
      onDone();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return <div className="th-edit" role="group" aria-label={`Thesis for ${d.symbol}`}>
    <div className="th-grid">
      <label>ROLE<select value={d.role} onChange={(e) => set({ role: e.target.value as Role })}>{ROLES.map((r) => <option key={r} value={r}>{r}</option>)}</select></label>
      <label>REVIEW EVERY (DAYS)<input inputMode="numeric" value={d.reviewEveryDays} onChange={(e) => set({ reviewEveryDays: e.target.value })} /></label>
      <label>NEXT REVIEW<input type="date" value={d.nextReview} onChange={(e) => set({ nextReview: e.target.value })} /></label>
      <label>MAX WEIGHT %<input inputMode="decimal" placeholder="optional" value={d.maxWeightPct} onChange={(e) => set({ maxWeightPct: e.target.value })} /></label>
    </div>
    <label className="th-wide">HOW IT CREATES VALUE<textarea rows={3} value={d.mechanism} onChange={(e) => set({ mechanism: e.target.value })} placeholder="The mechanism, key operating measures and primary sources" /></label>
    <div className="th-grid">
      <label>FAIR VALUE LOW<input inputMode="decimal" value={d.low} onChange={(e) => set({ low: e.target.value })} /></label>
      <label>FAIR VALUE HIGH<input inputMode="decimal" value={d.high} onChange={(e) => set({ high: e.target.value })} /></label>
      <label>CURRENCY<input value={d.currency} maxLength={5} onChange={(e) => set({ currency: e.target.value.toUpperCase() })} /></label>
      <label>VALUATION BASIS<input value={d.vnote} placeholder="method, assumptions, date" onChange={(e) => set({ vnote: e.target.value })} /></label>
    </div>
    <div className="fxr-sub">WHAT WOULD DISPROVE IT</div>
    {d.triggers.map((t, i) => <div className="th-trig" key={i}>
      <input aria-label={`Condition ${i + 1}`} value={t.text} placeholder="Observable condition and threshold" onChange={(e) => setTrig(i, { text: e.target.value })} />
      <select aria-label={`Condition ${i + 1} type`} value={t.kind} onChange={(e) => setTrig(i, { kind: e.target.value as TriggerKind })}>{TRIGGER_KINDS.map((k) => <option key={k} value={k}>{k}</option>)}</select>
      <label className="th-chk"><input type="checkbox" checked={t.urgent} onChange={(e) => setTrig(i, { urgent: e.target.checked })} />urgent</label>
      <button className="mini-btn" aria-label={`Remove condition ${i + 1}`} onClick={() => setD((x) => ({ ...x, triggers: x.triggers.filter((_, j) => j !== i) }))}>✕</button>
    </div>)}
    <div className="gr-actions">
      <button className="mini-btn" onClick={() => setD((x) => ({ ...x, triggers: [...x.triggers, { text: '', kind: 'business', urgent: false }] }))}>+ CONDITION</button>
      <span className="grow" />
      {err && <span className="down" role="alert">{err}</span>}
      <button className="mini-btn" onClick={onDone} disabled={busy}>CANCEL</button>
      <button className="mini-btn" onClick={save} disabled={busy}>SAVE</button>
    </div>
  </div>;
}

function CheckForm({ t, base, onDone }: { t: Thesis; base: string; onDone: () => void }) {
  const client = useQueryClient();
  const [verdict, setVerdict] = useState<Verdict>('intact'), [note, setNote] = useState(''), [err, setErr] = useState('');
  const save = async () => {
    try { client.setQueryData(['theses', base], await post('/api/theses/check', { symbol: t.symbol, check: { verdict, note } })); onDone(); }
    catch (e) { setErr((e as Error).message); }
  };
  return <div className="th-trig">
    <select aria-label="Review verdict" value={verdict} onChange={(e) => setVerdict(e.target.value as Verdict)}>{VERDICTS.map((v) => <option key={v} value={v}>{VERDICT_TEXT[v]}</option>)}</select>
    <input aria-label="Review note" value={note} placeholder="Evidence checked today" onChange={(e) => setNote(e.target.value)} />
    {err && <span className="down" role="alert">{err}</span>}
    <button className="mini-btn" onClick={onDone}>CANCEL</button><button className="mini-btn" onClick={save}>RECORD</button>
  </div>;
}

function Detail({ r, base, onEdit }: { r: ThesisRow; base: string; onEdit: () => void }) {
  const client = useQueryClient();
  const [checking, setChecking] = useState(false);
  const t = r.thesis!;
  const del = async () => {
    if (!await confirmDialog({ title: `Delete the ${t.symbol} thesis?`, body: 'Its review history is deleted too. This cannot be undone.', ok: 'DELETE', danger: true })) return;
    client.setQueryData(['theses', base], await post('/api/theses/delete', { symbol: t.symbol }));
  };
  const v = t.valuation;
  return <div className="th-detail">
    {t.mechanism && <p>{t.mechanism}</p>}
    {v && <div className="dim">Fair value {v.low != null ? fmt(v.low, 2) : '?'}–{v.high != null ? fmt(v.high, 2) : '?'} {v.currency ?? ''}{v.note ? ` · ${v.note}` : ''}{r.last != null ? ` · last ${fmt(r.last, 2)} ${r.currency}` : ''}</div>}
    {!!t.triggers.length && <ul className="th-list">{t.triggers.map((g, i) => <li key={i}><span className={g.urgent ? 'down' : 'dim'}>{g.urgent ? 'URGENT' : 'CORROBORATE'} · {g.kind}</span> {g.text}</li>)}</ul>}
    {!!t.checks.length && <div className="th-hist">{t.checks.slice(0, 5).map((c, i) => <div key={i}><span className="dim">{c.date}</span> <span className={VERDICT_CLASS[c.verdict]}>{VERDICT_TEXT[c.verdict]}</span>{c.note ? ` — ${c.note}` : ''}</div>)}</div>}
    {checking ? <CheckForm t={t} base={base} onDone={() => setChecking(false)} /> :
      <div className="gr-actions"><button className="mini-btn" onClick={() => setChecking(true)}>RECORD REVIEW</button><button className="mini-btn" onClick={onEdit}>EDIT</button><span className="grow" /><button className="mini-btn" onClick={del}>DELETE</button></div>}
  </div>;
}

export default function ThesesIsland() {
  useEffect(() => { const el = document.getElementById('theses'); if (el) { el.tabIndex = 0; el.setAttribute('aria-label', 'Thesis tracker'); } }, []);
  const q = useTheses(), d = q.data;
  const base = window.FinSight.store.getState().base;
  const [open, setOpen] = useState<string | null>(null), [editing, setEditing] = useState<string | null>(null);
  const c = d?.counts;
  const head = <PanelHeadSlot island="theses">{c && <span className={c.overdue || c.broken ? 'warn' : ''}>{c.withThesis}/{c.held} WRITTEN{c.overdue ? ` · ${c.overdue} OVERDUE` : ''}{c.broken ? ` · ${c.broken} BROKEN` : ''}</span>}</PanelHeadSlot>;
  if (q.isError) return <>{head}<span className="down">{q.error.message}</span></>;
  if (!d) return <>{head}<span className="muted">Loading…</span></>;
  if (!d.rows.length) return <>{head}<span className="muted">No holdings yet. Theses can be written once you hold something.</span></>;
  const due = (n: number | null) => n == null ? '—' : n < 0 ? `${-n}d overdue` : n === 0 ? 'today' : `in ${n}d`;
  const editRow = editing ? d.rows.find((r) => r.symbol === editing) : null;
  if (editRow) return <>{head}<div className="fxr-sub">{editRow.thesis ? 'EDIT' : 'WRITE'} THESIS · {editRow.symbol}</div><Editor row={editRow} base={base} onDone={() => setEditing(null)} /></>;
  return <>{head}
    <table className="tbl th-tbl"><thead><tr><th>SYM</th><th>ROLE</th><th className="r">WT%</th><th className="r">REVIEW</th><th>LAST CHECK</th><th></th></tr></thead><tbody>
      {d.rows.map((r) => { const t = r.thesis, last = t?.checks[0]; const isOpen = open === r.symbol; return [
        <tr key={r.symbol} className={r.dueInDays != null && r.dueInDays < 0 ? 'gr-breach' : ''}>
          <td className="sym">{t ? <button className="linkish" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.symbol)}>{r.symbol}</button> : r.symbol}{!r.held && <span className="dim"> sold</span>}</td>
          <td>{t ? t.role : <span className="dim">no thesis</span>}</td>
          <td className={'r ' + (r.overMaxWeight ? 'down' : '')} title={t?.maxWeightPct ? `max ${t.maxWeightPct}%` : undefined}>{r.weightPct != null ? fmt(r.weightPct, 1) : '—'}{r.overMaxWeight && ' ▲'}</td>
          <td className={'r ' + (r.dueInDays != null && r.dueInDays < 0 ? 'down' : '')}>{due(r.dueInDays)}</td>
          <td>{last ? <><span className={VERDICT_CLASS[last.verdict]}>{VERDICT_TEXT[last.verdict]}</span> <span className="dim">{last.date}</span></> : t ? <span className="dim">none</span> : ''}{r.vsValuation && r.vsValuation !== 'within' && <span className="dim"> · price {r.vsValuation} FV</span>}</td>
          <td className="r"><button className="mini-btn" onClick={() => setEditing(r.symbol)}>{t ? 'EDIT' : 'WRITE'}</button></td>
        </tr>,
        isOpen && t ? <tr key={r.symbol + ':d'}><td colSpan={6}><Detail r={r} base={base} onEdit={() => setEditing(r.symbol)} /></td></tr> : null,
      ]; })}
    </tbody></table>
    <div className="fxr-note">Your own written cases (policy §6). A missing thesis or an overdue review is a prompt to do the work, not a reason to sell. Weights are of whole-book net worth.</div>
  </>;
}
