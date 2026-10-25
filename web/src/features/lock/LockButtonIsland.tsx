import { api } from '../../api/client.ts';

// 🔒 in the topbar (F9): log out, then lock. The auth event shows the lock
// screen and stops polling (legacy showLock).
export default function LockButtonIsland() {
  const lockNow = async () => {
    try { await api('/api/auth/logout', { method: 'POST' }); } catch { /* lock anyway */ }
    window.FinSight.auth.lock();
  };
  return <button id="lock-btn" className="topbar-btn" title="Lock now" onClick={() => void lockNow()}>🔒</button>;
}
