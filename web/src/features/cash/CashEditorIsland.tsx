import { useEffect, useReducer, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { api } from '../../api/client.ts';
import type { Accounts, Portfolio } from '../../../../shared/types.ts';
import { planCashSave, type CashDraft } from './cash.ts';

// Cash editor modal (D3): every account × currency in one place, auto-saved
// ~0.7 s after typing stops (Enter or leaving a field saves at once). Opened by
// store.cashEditorOpen, which the legacy CASH button, the NET WORTH/CASH cards
// and the wealth panel's cash button set through openCashEditor().
const store = () => window.FinSight.store;
const enc = encodeURIComponent;
type Status = { m: string; k: '' | 'ok' | 'err' };

async function loadDrafts(): Promise<CashDraft[]> {
  const { base, account } = store().getState();
  const { accounts } = await api<Accounts>('/api/accounts');
  const ids = account === 'ALL' ? accounts.map((a) => a.id) : [account];
  return Promise.all(ids.map(async (id) => {
    const d = await api<Portfolio>(`/api/portfolio?base=${enc(base)}&account=${enc(id)}`);
    return { id, name: accounts.find((a) => a.id === id)?.name || id,
      orig: Object.fromEntries((d.cash || []).map((c) => [c.ccy, c.amount])),
      rows: (d.cash || []).map((c) => ({ ccy: c.ccy, amount: String(c.amount) })) };
  }));
}

export default function CashEditorIsland() {
  const open = useStore(store(), (s) => s.cashEditorOpen);
  // Drafts are edited in place (like legacy) and saves update orig as they land.
  const drafts = useRef<CashDraft[]>([]);
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  const [status, setStatus] = useState<Status>({ m: '', k: '' });
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const saving = useRef<Promise<void> | null>(null);
  const focusNew = useRef(false);
  const editorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    drafts.current = []; rerender(); setStatus({ m: 'Loading…', k: '' });
    loadDrafts().then((d) => { if (live) { drafts.current = d; rerender(); setStatus({ m: '', k: '' }); } },
      (e: Error) => { if (live) setStatus({ m: 'Could not load cash: ' + e.message, k: 'err' }); });
    return () => { live = false; };
  }, [open]);
  useEffect(() => {
    if (!focusNew.current) return;
    focusNew.current = false;
    const ins = editorRef.current?.querySelectorAll<HTMLInputElement>('.cash-amt');
    ins?.[ins.length - 1]?.focus();
  });
  useEffect(() => () => clearTimeout(timer.current), []);

  async function save() {
    clearTimeout(timer.current);
    if (saving.current) await saving.current; // never run two saves at once
    const run = (async () => {
      const plan = planCashSave(drafts.current);
      if ('error' in plan) { setStatus({ m: plan.error, k: 'err' }); return; }
      if (!plan.calls.length) { setStatus({ m: 'All changes saved ✓', k: 'ok' }); return; }
      setStatus({ m: 'Saving…', k: '' });
      const { base } = store().getState();
      try {
        for (const c of plan.calls) {
          await api(`/api/cash?base=${enc(base)}&account=${enc(c.draft.id)}`,
            { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ccy: c.ccy, amount: c.amount }) });
          if (c.amount === 0) delete c.draft.orig[c.ccy]; else c.draft.orig[c.ccy] = c.amount;
        }
        setStatus({ m: 'Saved ✓ · net worth updated', k: 'ok' });
        await window.FinSight.bus.write('cash'); // refreshes net worth ('wealth') too
      } catch (e) { setStatus({ m: 'Save failed: ' + (e as Error).message, k: 'err' }); }
    })();
    saving.current = run;
    try { await run; } finally { saving.current = null; }
  }
  const queue = (delay = 700) => { clearTimeout(timer.current); timer.current = setTimeout(() => void save(), delay); };
  const close = async () => { await save(); store().setState({ cashEditorOpen: false }); };
  const edit = (ai: number, ri: number, field: 'ccy' | 'amount', value: string) => {
    const r = drafts.current[ai]!.rows[ri]!;
    if (field === 'ccy') r.ccy = value.toUpperCase(); else r.amount = value;
    rerender(); setStatus({ m: 'Editing…', k: '' }); queue();
  };

  return (
    <div id="cash-modal" className={open ? 'modal' : 'modal hidden'}>
      <div className="modal-box">
        <div className="modal-head">
          <span className="panel-title">CASH &nbsp;·&nbsp; EDIT BALANCES</span>
          <button id="cash-close" className="x-btn" title="Close" onClick={() => void close()}>✕</button>
        </div>
        <div className="modal-body">
          <p className="muted small">Click an amount and type the new balance. It <b>saves automatically</b>, and net worth, the breakdown chart and FX exposure update straight away. Set an amount to 0 or press ✕ to remove it.</p>
          <div id="cash-editor" ref={editorRef} onKeyDown={(e) => { if (e.key === 'Enter') void save(); }}>
            {drafts.current.map((a, ai) => (
              <div className="cash-acct" key={a.id}>
                <div className="cash-acct-name">{a.name}</div>
                {a.rows.map((r, ri) => (
                  <div className="cash-row" key={ri}>
                    <input className="cash-ccy" data-a={ai} data-r={ri} value={r.ccy} maxLength={3} placeholder="CCY"
                      onChange={(e) => edit(ai, ri, 'ccy', e.target.value)} onBlur={() => queue(0)} />
                    <input className="cash-amt" data-a={ai} data-r={ri} value={r.amount} inputMode="decimal" placeholder="0.00"
                      onChange={(e) => edit(ai, ri, 'amount', e.target.value)} onBlur={() => queue(0)} />
                    <button className="x-btn" data-del-a={ai} data-del-r={ri} title="Remove"
                      onClick={() => { a.rows.splice(ri, 1); rerender(); queue(0); }}>✕</button>
                  </div>
                ))}
                <button className="mini-btn cash-add" data-add={ai}
                  onClick={() => { a.rows.push({ ccy: store().getState().base, amount: '' }); focusNew.current = true; rerender(); }}>+ CURRENCY</button>
              </div>
            ))}
          </div>
        </div>
        <div className="modal-foot">
          <span id="cash-status" className={'cmd-status ' + status.k}>{status.m}</span>
          <div className="head-btns">
            <button id="cash-cancel" className="mini-btn hidden" onClick={() => void close()}>CANCEL</button>
            <button id="cash-save" className="mini-btn solid" onClick={() => void close()}>DONE</button>
          </div>
        </div>
      </div>
    </div>
  );
}
