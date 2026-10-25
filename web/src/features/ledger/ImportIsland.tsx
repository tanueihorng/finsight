import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { api } from '../../api/client.ts';
import { useModalFocus } from '../../ui/modalFocus.ts';
import type { ImportResult, Portfolio } from '../../../../shared/types.ts';
import { importStatusText } from './ledger.ts';

// CSV import modal (D4). Opened by store.importOpen (the IMPORT button and the
// setup wizard's import choice). CLEAR ALL resets the active account.
const store = () => window.FinSight.store;
type Status = { m: string; k: '' | 'ok' | 'err' };
const qs = () => { const { base, account } = store().getState(); return `?base=${encodeURIComponent(base)}&account=${encodeURIComponent(account || '')}`; };

export default function ImportIsland() {
  const open = useStore(store(), (s) => s.importOpen);
  const [text, setText] = useState('');
  const [replace, setReplace] = useState(false);
  const [status, setStatus] = useState<Status>({ m: '', k: '' });
  const textRef = useRef<HTMLTextAreaElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => { if (open) textRef.current?.focus(); }, [open]);
  useEffect(() => () => clearTimeout(closeTimer.current), []);
  const close = () => store().setState({ importOpen: false });
  useModalFocus(open, close, boxRef, { initialFocus: () => textRef.current });

  async function doImport() {
    const csv = text.trim();
    if (!csv) return setStatus({ m: 'Paste CSV or choose a file first.', k: 'err' });
    if (store().getState().account === 'ALL') return setStatus({ m: 'Switch to a specific account first (ACCT, top-right).', k: 'err' });
    setStatus({ m: 'Importing… (fetching a quote per symbol)', k: '' });
    try {
      const res = await api<Portfolio & { imported: ImportResult }>('/api/portfolio/import' + qs(),
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ csv, replace }) });
      const r = res.imported;
      setStatus({ m: importStatusText(r), k: r.added ? 'ok' : 'err' });
      await window.FinSight.bus.write('import');
      if (r.added) closeTimer.current = setTimeout(close, 1400);
    } catch (e) { setStatus({ m: 'Import failed: ' + (e as Error).message, k: 'err' }); }
  }
  async function clearAll() {
    if (!confirm('Clear ALL positions and transaction history?\n(Watchlist and alerts are kept.)')) return;
    try {
      await api('/api/portfolio/reset' + qs(), { method: 'POST' });
      store().setState({ selected: null }); await window.FinSight.bus.write('reset');
      setStatus({ m: 'Portfolio cleared.', k: 'ok' });
    } catch (e) { setStatus({ m: (e as Error).message, k: 'err' }); }
  }

  return (
    <div id="import-modal" className={open ? 'modal' : 'modal hidden'} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal-box" ref={boxRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Import holdings · CSV">
        <div className="modal-head">
          <span className="panel-title">IMPORT HOLDINGS · CSV</span>
          <button id="import-close" aria-label="Close dialog" className="x-btn" onClick={close}>✕</button>
        </div>
        <div className="modal-body">
          <p className="muted small">Paste CSV or choose a file. Expected columns (header row optional):
            {' '}<b>symbol, quantity, avg_price</b>, and optionally <b>date</b> (YYYY-MM-DD) to record the real
            purchase-time FX rate. Column names are matched loosely (ticker/qty/shares/cost/bought all work).
            <br />You can also drop in a broker export — <b>Interactive Brokers</b> Activity Statement,
            {' '}<b>moomoo</b>, or <b>Tiger</b> positions CSV — it finds your holdings automatically (and adds the
            right suffix for SG/HK tickers).</p>
          <textarea id="import-text" aria-label="Holdings CSV" ref={textRef} spellCheck={false} value={text} onChange={(e) => setText(e.target.value)}
            placeholder={'symbol,quantity,avg_price,date\nAAPL,10,195.50,2024-01-15\nMSFT,5,380,2023-11-02\n0700.HK,100,400,2024-06-20'} />
          <div className="import-row">
            <input type="file" id="import-file" aria-label="CSV file" accept=".csv,.txt" onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }} />
            <label className="chk"><input type="checkbox" id="import-replace" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace existing positions</label>
          </div>
          <div id="import-status" className={'cmd-status ' + status.k}>{status.m}</div>
        </div>
        <div className="modal-foot">
          <button id="import-clear" className="mini-btn" onClick={() => void clearAll()}>CLEAR ALL POSITIONS</button>
          <button id="import-do" className="mini-btn solid" onClick={() => void doImport()}>IMPORT</button>
        </div>
      </div>
    </div>
  );
}
