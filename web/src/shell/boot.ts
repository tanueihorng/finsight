import { earlyAuthStatus, loadAccountsList } from '../api/early.ts';
import { installKeyboardLayout } from './layout.ts';
import { setFooter } from '../legacy/app.ts';
import type { Accounts } from '../../../shared/types.ts';

// Startup and lock orchestration (TypeScript since X1, from public/app.js
// S33/S34): check the session, show the lock screen or boot, resolve the
// account (accountReady gates every query), and on returning to the tab
// refresh what went stale. Query owns polling; it pauses while locked or hidden.
const store = () => window.FinSight.store;
const body = () => document.body.classList;

export async function loadAccounts() {
  try {
    const d = await loadAccountsList();
    const accounts = d.accounts || [];
    const exists = (id: string | null) => id === 'ALL' || accounts.some((a) => a.id === id);
    let account = store().getState().account;
    if (!exists(account)) { const saved = localStorage.getItem('finsight-account'); account = exists(saved) ? saved! : d.activeId; }
    try { localStorage.setItem('finsight-account', account); } catch { /* storage blocked */ }
    store().setState({ account, accounts, accountReady: true });
  } catch { /* retried by the next 'accounts' refresh or unlock */ }
}
let booted = false;
async function boot() {
  await loadAccounts();
  // the setup island opens the first-launch wizard once accountReady is set (F8)
  setFooter(`READY · base ${store().getState().base} · live data refreshing every 15s`);
}
export function showLock(mode: 'enter' | 'create') {
  const wasLocked = body().contains('locked');
  body().add('locked');
  window.FinSight.auth.lock();
  // Only a fresh lock clears the fields: a re-entrant 401 mustn't wipe a PIN being typed.
  const l = store().getState().lock;
  store().setState({ lock: { mode, msg: wasLocked ? l.msg : '', fresh: wasLocked ? l.fresh : l.fresh + 1 } });
}
function showApp() {
  body().remove('locked');
  window.FinSight.auth.unlock();
  if (!booted) { booted = true; void boot(); }
}
// Server unreachable: say so, and keep retrying so the app comes back by itself.
let offlineTimer: ReturnType<typeof setTimeout> | undefined;
function showOffline() {
  body().add('locked');
  window.FinSight.auth.lock();
  store().setState({ lock: { ...store().getState().lock, mode: 'offline', msg: 'Start it with  node server.js  (or start.command). Retrying…' } });
  clearTimeout(offlineTimer);
  offlineTimer = setTimeout(() => void checkAuth(), 5000);
}
export async function checkAuth() {
  let st: { authed?: boolean; pinSet?: boolean };
  try {
    st = await (earlyAuthStatus() ?? fetch('/api/auth/status').then((r) => {
      if (!r.ok) throw new Error();
      return r.json();
    }));
  } catch { return showOffline(); }
  if (st.authed) showApp();
  else { store().setState({ lock: { ...store().getState().lock, msg: '' } }); showLock(st.pinSet ? 'enter' : 'create'); }
}

let started = false;
export function startShell() {
  if (started) return; started = true;
  installKeyboardLayout();
  window.addEventListener('finsight:locked', () => { if (!body().contains('locked')) showLock('enter'); });
  window.addEventListener('finsight:unlocked', () => { if (body().contains('locked')) showApp(); });
  window.FinSight.bus.on('accounts', () => loadAccounts());
  // A network error (server stopped) re-checks once, which shows the offline screen.
  let netCheckPending = false;
  window.addEventListener('finsight:network-error', () => {
    if (netCheckPending) return; netCheckPending = true;
    setTimeout(() => { netCheckPending = false; void checkAuth(); }, 1500);
  });
  // Back in view after a while: refresh what went stale (polling itself pauses while hidden).
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    if (body().contains('locked') || Date.now() - hiddenAt <= 10_000) return;
    const bus = window.FinSight.bus;
    for (const key of ['portfolio', 'markets', 'watchlist', 'alerts', 'quote']) void bus.invalidate(key);
    if (Date.now() - hiddenAt > 15 * 60_000) for (const key of ['worldbank', 'fred', 'calendar', 'events']) void bus.invalidate(key);
  });
  void checkAuth();
}
