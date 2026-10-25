import { useState } from 'react';
import { useStore } from 'zustand';
import type { Accounts } from '../../../../shared/types.ts';
import { accountDetail, afterRemove } from './topbar.ts';
import { post } from './actions.ts';

// MANAGE ACCOUNTS modal (F8): add (with an optional type), rename, delete.
const store = () => window.FinSight.store;
type Status = { m: string; k: '' | 'ok' | 'err' };
export default function AccountsModalIsland() {
  const open = useStore(store(), (s) => s.accountsOpen);
  const accounts = useStore(store(), (s) => s.accounts);
  const [name, setName] = useState(''), [type, setType] = useState('');
  const [status, setStatus] = useState<Status>({ m: '', k: '' });
  const close = () => store().setState({ accountsOpen: false });
  const fail = (e: unknown) => setStatus({ m: (e as Error).message, k: 'err' });

  async function add() {
    const n = name.trim(); if (!n) return;
    try {
      await post<Accounts>('/api/accounts/add', { name: n, type: type.trim() });
      setName(''); setType(''); setStatus({ m: `Added "${n}".`, k: 'ok' });
      await window.FinSight.bus.write('account-add');
    } catch (e) { fail(e); }
  }
  async function rename(id: string, current: string) {
    const n = prompt('Rename account:', current); if (n == null) return;
    try { await post('/api/accounts/rename', { id, name: n }); await window.FinSight.bus.write('account-rename'); } catch (e) { fail(e); }
  }
  async function remove(id: string, current: string) {
    if (!confirm(`Delete account "${current}" and all its holdings?`)) return;
    try {
      const d = await post<Accounts>('/api/accounts/remove', { id });
      const next = afterRemove(store().getState().account, id, d.activeId);
      if (next !== store().getState().account) { store().setState({ account: next }); try { localStorage.setItem('finsight-account', next); } catch { /* storage blocked */ } }
      await window.FinSight.bus.write('account-remove');
    } catch (e) { fail(e); }
  }

  return (
    <div id="accounts-modal" className={open ? 'modal' : 'modal hidden'} onClick={(e) => { if (e.target === e.currentTarget) close(); }}>
      <div className="modal-box">
        <div className="modal-head">
          <span className="panel-title">MANAGE ACCOUNTS</span>
          <button id="accounts-close" className="x-btn" onClick={close}>✕</button>
        </div>
        <div className="modal-body">
          <p className="muted small">Each account is a separate portfolio (e.g. IBKR, Crypto, SGX). Switch them from the
            {' '}<b>ACCT</b> dropdown; pick <b>All Accounts</b> for a combined view.</p>
          <div id="accounts-list" className="cards-list">
            {accounts.map((a) => (
              <div key={a.id} className="card-edit-row">
                <label>{a.name} <span className="muted small">{accountDetail(a)}</span></label>
                <span className="ce-move">
                  <button className="acct-rename" data-id={a.id} onClick={() => void rename(a.id, a.name)}>Rename</button>
                  <button className="acct-del" data-id={a.id} onClick={() => void remove(a.id, a.name)}>Delete</button>
                </span>
              </div>
            ))}
          </div>
          <form id="account-add-form" className="add-form" style={{ gridTemplateColumns: '1.4fr 1fr auto' }} autoComplete="off"
            onSubmit={(e) => { e.preventDefault(); void add(); }}>
            <input id="account-new-name" placeholder="New account name (e.g. Crypto)" value={name} onChange={(e) => setName(e.target.value)} />
            <input id="account-new-type" placeholder="Type (optional, e.g. Crypto)" value={type} onChange={(e) => setType(e.target.value)} />
            <button type="submit" className="mini-btn solid">ADD</button>
          </form>
          <div id="accounts-status" className={'cmd-status ' + status.k}>{status.m}</div>
        </div>
        <div className="modal-foot"><span className="muted small">Deleting an account removes its holdings.</span>
          <button id="accounts-done" className="mini-btn solid" onClick={close}>DONE</button></div>
      </div>
    </div>
  );
}
