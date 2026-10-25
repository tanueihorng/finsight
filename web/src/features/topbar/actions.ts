import { api } from '../../api/client.ts';
import { setStatus } from '../../legacy/app.ts';
import type { Accounts } from '../../../../shared/types.ts';

// Account and base switches (F8). The store re-keys every query; the legacy
// loadPortfolio (chart watch feed, FX note) refreshes through its bus key.
const store = () => window.FinSight.store;
const save = (key: string, v: string) => { try { localStorage.setItem(key, v); } catch { /* storage blocked */ } };
export const post = <T,>(path: string, body: unknown) => api<T>(path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

export async function switchAccount(id: string) {
  store().setState({ account: id }); save('finsight-account', id);
  await window.FinSight.bus.invalidate('portfolio');
}
export async function switchBase(base: string) {
  store().setState({ base }); save('finsight-base', base);
  setStatus(`Base currency → ${base}. Converting…`, 'ok');
  await window.FinSight.bus.invalidate('portfolio');
}
// "＋ New account…" in the selector: create, select, then refresh.
export async function newAccountPrompt() {
  const name = (prompt('New account name (e.g. Crypto, SGX, IBKR):') || '').trim();
  if (!name) return;
  try {
    const d = await post<Accounts>('/api/accounts/add', { name });
    store().setState({ account: d.newId! }); save('finsight-account', d.newId!);
    await window.FinSight.bus.write('account-add');
    await window.FinSight.bus.invalidate('portfolio');
    setStatus(`Account "${name}" created.`, 'ok');
  } catch (e) { setStatus('Create failed: ' + (e as Error).message, 'err'); }
}
