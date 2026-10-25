import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { api } from '../../api/client.ts';
import { lockTitle, pinProblem } from './lock.ts';

// The PIN lock screen's form (F9). Legacy startup still decides when to lock
// (checkAuth, showLock, a 401) and writes store.lock; a fresh lock clears and
// focuses the fields, a re-entrant 401 keeps the PIN being typed. Unlocking
// goes through FinSight.auth, whose event resumes the legacy boot/polling.
const store = () => window.FinSight.store;
export default function LockIsland() {
  useEffect(() => { const host = document.getElementById('lock-screen'); host?.setAttribute('role', 'region'); host?.setAttribute('aria-label', 'FinSight lock screen'); }, []);
  const lock = useStore(store(), (s) => s.lock);
  const [pin, setPin] = useState(''), [pin2, setPin2] = useState('');
  const pinRef = useRef<HTMLInputElement>(null), pin2Ref = useRef<HTMLInputElement>(null);
  const say = (msg: string) => store().setState({ lock: { ...store().getState().lock, msg } });
  useEffect(() => {
    if (!lock.fresh) return;
    setPin(''); setPin2('');
    const t = setTimeout(() => pinRef.current?.focus(), 60);
    return () => clearTimeout(t);
  }, [lock.fresh]);

  async function submit() {
    const p = pin.trim(), problem = pinProblem(lock.mode, p, pin2.trim());
    if (problem) return say(problem);
    try {
      await api(lock.mode === 'create' ? '/api/auth/setup' : '/api/auth/login',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pin: p }) });
      window.FinSight.auth.unlock();
    } catch (e) { say((e as Error).message); setPin(''); pinRef.current?.focus(); }
  }
  const offline = lock.mode === 'offline', create = lock.mode === 'create';
  return (
    <>
      <div id="lock-title" role="heading" aria-level={1} className="lock-title">{lockTitle(lock.mode)}</div>
      <input id="lock-pin" aria-label={create ? 'Create PIN' : 'PIN'} ref={pinRef} className={'lock-input' + (offline ? ' hidden' : '')} type="password" inputMode="numeric" autoComplete="off" maxLength={12} placeholder="● ● ● ●"
        value={pin} onChange={(e) => setPin(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { if (create) pin2Ref.current?.focus(); else void submit(); } }} />
      <input id="lock-pin2" aria-label="Confirm PIN" ref={pin2Ref} className={'lock-input' + (create ? '' : ' hidden')} type="password" inputMode="numeric" autoComplete="off" maxLength={12} placeholder="Confirm PIN"
        value={pin2} onChange={(e) => setPin2(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
      <button id="lock-go" className={'lock-btn' + (offline ? ' hidden' : '')} onClick={() => void submit()}>{create ? 'SET PIN' : 'UNLOCK'}</button>
      <div id="lock-msg" role="status" className="lock-msg">{lock.msg}</div>
    </>
  );
}
