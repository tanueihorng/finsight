import { confirmDialog } from '../../ui/dialog.tsx';
import { useModalFocus } from '../../ui/modalFocus.ts';
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useStore } from 'zustand';
import { api } from '../../api/client.ts';
import { useLedger, useRealized } from '../../api/queries.ts';
import { downloadCsv, toCsv } from '../../ui/csv.ts';
import { fmt, money, moneySigned, signClass } from '../../ui/format.ts';
import type { LedgerRow, Realized } from '../../../../shared/types.ts';
import { filterLedger, heldLabel, isoDate, realizedCsvRows, shortDate, typeClass } from './ledger.ts';

// Ledger modal (D4): every trade (fix a buy's date/price/quantity, delete a
// buy) and realized gains by year. Opened by store.ledgerOpen (the LEDGER
// button, the LEDGER/TRADES commands). The tab and filter persist while the page is open.
const store = () => window.FinSight.store;
type Tab = 'trades' | 'realized';
type Status = { m: string; k: '' | 'ok' | 'err' };
const qs = () => { const { base, account } = store().getState(); return `?base=${encodeURIComponent(base)}&account=${encodeURIComponent(account || '')}`; };
const post = (path: string, body: unknown) => api(path + qs(), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const qtyText = (q: number) => fmt(q, q % 1 ? 4 : 0);

function TradeRow({ r, base, showAcct, editing, onAct }: { r: LedgerRow; base: string; showAcct: boolean; editing: boolean; onAct: (act: string, r: LedgerRow, e: MouseEvent) => void }) {
  const cls = typeClass(r.type);
  if (editing) {
    return (
      <tr data-id={r.id}><td><input type="date" aria-label="Trade date" className="le-date" defaultValue={r.time ? isoDate(r.time) : ''} /></td><td className={cls}>{r.type}</td><td className="sym">{r.symbol}</td>
        <td className="r"><input type="number" step="any" aria-label="Trade quantity" className="le-qty" defaultValue={r.quantity ?? ''} /></td><td className="r"><input type="number" step="any" aria-label="Trade price" className="le-px" defaultValue={r.price ?? ''} /></td>
        <td></td><td></td><td><div className="lg-act"><button className="mini-btn solid" data-act="save" onClick={(e) => onAct('save', r, e)}>SAVE</button><button className="mini-btn" data-act="cancel" onClick={(e) => onAct('cancel', r, e)}>✕</button></div></td></tr>
    );
  }
  return (
    <tr data-id={r.id}>
      <td>{r.time ? shortDate(r.time) : ''}{showAcct && <div className="dim small">{r.account}</div>}</td><td className={cls}>{r.type}</td><td className="sym">{r.symbol}</td>
      <td className="r">{r.quantity != null ? qtyText(r.quantity) : ''}</td>
      <td className="r">{r.price != null && <>{fmt(r.price)} <span className="dim">{r.currency || ''}</span></>}</td>
      <td className="r">{r.valueBase != null ? money(base, r.valueBase, 0) : ''}</td>
      <td className="r">{r.realized != null && <><span className={signClass(r.realized)}>{moneySigned(base, r.realized)}</span>
        {r.realizedFx != null && Math.abs(r.realizedFx) > 0.005 && <div className="dim small">FX {moneySigned(base, r.realizedFx)}</div>}</>}</td>
      <td>{r.editable && <div className="lg-act">
        <button className="x-btn" data-act="edit" title="Fix date / price / quantity" onClick={(e) => onAct('edit', r, e)}>✎</button>
        <button className="x-btn del" data-act="delete" title="Delete this buy" onClick={(e) => onAct('delete', r, e)}>✕</button>
      </div>}</td>
    </tr>
  );
}

function RealizedView({ d }: { d: Realized }) {
  const base = d.base || store().getState().base;
  return (
    <>
      <div className="rz-head"><span className="muted small">Cost uses the FX rate you actually paid; proceeds use the rate on the sale date. Singapore doesn't tax capital gains — this is for your records.</span>
        <button id="rz-export" className="mini-btn" onClick={() => downloadCsv('realized-gains.csv', toCsv(realizedCsvRows(d)))}>EXPORT CSV</button></div>
      <table className="tbl rz-years"><thead><tr><th>YEAR</th><th className="r">SALES</th><th className="r">PROCEEDS</th><th className="r">COST</th><th className="r">STOCK</th><th className="r">FX</th><th className="r">REALIZED</th><th className="r">DIVIDENDS NET</th></tr></thead>
        <tbody>{d.years.length ? d.years.map((y) => (
          <tr key={y.year}><td><b>{y.year}</b></td><td className="r">{y.trades}</td><td className="r">{money(base, y.proceeds, 0)}</td><td className="r">{money(base, y.cost, 0)}</td>
            <td className={`r ${signClass(y.stock)}`}>{moneySigned(base, y.stock, 0)}</td><td className={`r ${signClass(y.fx)}`}>{moneySigned(base, y.fx, 0)}</td>
            <td className={`r ${signClass(y.total)}`}><b>{moneySigned(base, y.total, 0)}</b></td>
            <td className="r">{y.divNet ? money(base, y.divNet, 0) : '—'}{y.divTax ? <div className="dim small">−{money(base, y.divTax, 0)} tax</div> : null}</td></tr>
        )) : <tr><td colSpan={8} className="empty">No closed trades or dividends yet.</td></tr>}</tbody></table>
      {d.rows.length > 0 && <>
        <div className="fxr-sub">CLOSED TRADES</div>
        <div className="table-wrap"><table className="tbl rz-years"><thead><tr><th>SOLD</th><th>SYM</th><th className="r">QTY</th><th className="r">PROCEEDS</th><th className="r">COST</th><th className="r">STOCK</th><th className="r">FX</th><th className="r">TOTAL</th><th className="r">HELD</th></tr></thead>
          <tbody>{d.rows.map((r) => (
            <tr key={r.id}><td>{shortDate(r.time)}</td><td className="sym">{r.symbol}</td><td className="r">{qtyText(r.quantity)}</td>
              <td className="r">{money(base, r.proceeds, 0)}</td><td className="r">{money(base, r.cost, 0)}</td>
              <td className={`r ${signClass(r.stock)}`}>{r.stock != null ? moneySigned(base, r.stock, 0) : '—'}</td><td className={`r ${signClass(r.fx)}`}>{r.fx != null ? moneySigned(base, r.fx, 0) : '—'}</td>
              <td className={`r ${signClass(r.total)}`}>{moneySigned(base, r.total, 0)}</td><td className="r">{heldLabel(r.heldDays)}</td></tr>
          ))}</tbody></table></div>
      </>}
    </>
  );
}

export default function LedgerIsland() {
  const open = useStore(store(), (s) => s.ledgerOpen);
  const account = useStore(store(), (s) => s.account);
  const base = useStore(store(), (s) => s.base);
  const [tab, setTab] = useState<Tab>('trades');
  const [filter, setFilter] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [status, setStatus] = useState<Status>({ m: '', k: '' });
  const ledger = useLedger(open && tab === 'trades');
  const realized = useRealized(open && tab === 'realized');

  useEffect(() => { if (open) setStatus({ m: '', k: '' }); }, [open]); // legacy cleared it on every open
  const close = () => { store().setState({ ledgerOpen: false }); setEditing(null); };
  const boxRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, close, boxRef);
  const switchTab = (t: Tab) => { setTab(t); setStatus({ m: '', k: '' }); };
  async function onAct(act: string, r: LedgerRow, e: MouseEvent) {
    if (act === 'edit') { setEditing(r.id ?? null); return; }
    if (act === 'cancel') { setEditing(null); return; }
    try {
      if (act === 'save') {
        const tr = (e.currentTarget as HTMLElement).closest('tr')!;
        const val = (sel: string) => tr.querySelector<HTMLInputElement>(sel)!.value;
        const body = { id: r.id, date: val('.le-date'), quantity: val('.le-qty'), price: val('.le-px') };
        setStatus({ m: 'Saving… (fetching that day\'s FX)', k: '' });
        await post('/api/ledger/edit', body);
        setStatus({ m: `Updated ${r.symbol} buy. UNDO reverts it.`, k: 'ok' });
      } else {
        if (!await confirmDialog({ title: `Delete this buy of ${r.quantity} ${r.symbol}?`, body: 'Its lot is removed from the position. UNDO can restore it.', ok: 'Delete buy', danger: true })) return;
        await post('/api/ledger/delete', { id: r.id });
        setStatus({ m: `Deleted ${r.symbol} buy. UNDO restores it.`, k: 'ok' });
      }
      setEditing(null);
      await window.FinSight.bus.write(act === 'save' ? 'ledger-edit' : 'ledger-delete');
    } catch (err) { setStatus({ m: (err as Error).message, k: 'err' }); }
  }

  const err = tab === 'trades' ? ledger.error : realized.error;
  const shown = status.m ? status : tab === 'trades' && err ? { m: err.message, k: 'err' as const } : status;
  const rows = filterLedger(ledger.data?.rows ?? [], filter);
  return (
    <div id="ledger-modal" className={open ? 'modal' : 'modal hidden'} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal-box wide" ref={boxRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Trades and realized gains">
        <div className="modal-head">
          <div className="ranges" id="ledger-tabs" role="tablist" aria-label="Ledger view" onKeyDown={(e) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
            e.preventDefault(); const next = e.key === 'Home' ? 'trades' : e.key === 'End' ? 'realized' : tab === 'trades' ? 'realized' : 'trades';
            switchTab(next); document.getElementById(`ledger-tab-${next}`)?.focus();
          }}>
            <button id="ledger-tab-trades" role="tab" tabIndex={tab === 'trades' ? 0 : -1} aria-selected={tab === 'trades'} aria-controls="ledger-trades" data-tab="trades" className={tab === 'trades' ? 'active' : ''} onClick={() => switchTab('trades')}>TRADES</button>
            <button id="ledger-tab-realized" role="tab" tabIndex={tab === 'realized' ? 0 : -1} aria-selected={tab === 'realized'} aria-controls="ledger-realized" data-tab="realized" className={tab === 'realized' ? 'active' : ''} onClick={() => switchTab('realized')}>REALIZED GAINS</button>
          </div>
          <div className="head-btns">
            <button id="ledger-undo" className="mini-btn" title="Undo the last change" onClick={() => void window.FinSight.actions?.undo()}>↶ UNDO</button>
            <button id="ledger-close" aria-label="Close ledger" className="x-btn" onClick={close}>✕</button>
          </div>
        </div>
        <div className="modal-body">
          <div id="ledger-trades" role="tabpanel" aria-labelledby="ledger-tab-trades" className={tab === 'trades' ? undefined : 'hidden'}>
            <div className="ledger-tools">
              <input id="ledger-filter" placeholder="Filter by symbol or type…" autoComplete="off" value={filter} onChange={(e) => setFilter(e.target.value)} />
              <span className="muted small">✎ fix a buy's date / price / quantity (a date re-fetches that day's FX). Sales can be reversed with UNDO.</span>
            </div>
            <div className="table-wrap"><table className="tbl ledger-tbl"><thead><tr>
              <th>DATE</th><th>TYPE</th><th>SYMBOL</th><th className="r">QTY</th><th className="r">PRICE</th><th className="r">VALUE</th><th className="r">REALIZED</th><th><span className="sr-only">Actions</span></th>
            </tr></thead><tbody id="ledger-body">
              {rows.length ? rows.map((r, i) => <TradeRow key={r.id ?? i} r={r} base={base} showAcct={account === 'ALL'} editing={editing != null && editing === r.id} onAct={(a, row, e) => void onAct(a, row, e)} />)
                : ledger.data ? <tr><td colSpan={8} className="empty">No transactions.</td></tr> : null}
            </tbody></table></div>
          </div>
          <div id="ledger-realized" role="tabpanel" aria-labelledby="ledger-tab-realized" className={tab === 'realized' ? undefined : 'hidden'}>
            {tab === 'realized' && (realized.error ? <span className="down">{realized.error.message}</span>
              : realized.data ? <RealizedView d={realized.data} /> : <span className="muted">Loading…</span>)}
          </div>
          <div id="ledger-status" className={'cmd-status ' + shown.k}>{shown.m}</div>
        </div>
      </div>
    </div>
  );
}
