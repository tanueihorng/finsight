import { useStore } from 'zustand';
import { accountLabel } from './topbar.ts';
import { newAccountPrompt, switchAccount } from './actions.ts';

// ACCT selector (F8). Startup resolution of the active account (and
// accountReady) stays in legacy loadAccounts until X1; this renders and switches.
export default function AccountIsland() {
  const account = useStore(window.FinSight.store, (s) => s.account);
  const ready = useStore(window.FinSight.store, (s) => s.accountReady);
  const accounts = useStore(window.FinSight.store, (s) => s.accounts);
  return (
    <>
      ACCT{' '}
      <select id="account-sel" value={ready ? account : ''} onChange={(e) => {
        const v = e.target.value;
        if (v === '__new') return void newAccountPrompt();
        if (v === '__manage') return window.FinSight.store.setState({ accountsOpen: true });
        void switchAccount(v);
      }}>
        {ready && <>
          <option value="ALL">All Accounts</option>
          {accounts.map((a) => <option key={a.id} value={a.id}>{accountLabel(a)}</option>)}
          <option value="__new">＋ New account…</option>
          <option value="__manage">⚙ Manage…</option>
        </>}
      </select>
    </>
  );
}
