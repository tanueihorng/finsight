import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { api } from '../../api/client.ts';
import { lockTitle, pinProblem } from './lock.ts';
import { Clock, Stage, Tape, type BootLine } from './Stage.tsx';
import { profile } from '../topbar/profile.ts';
import { applyBook, book, loadBook, type Book } from '../paper/book.ts';

// The PIN lock screen's form (F9). Legacy startup still decides when to lock
// (checkAuth, showLock, a 401) and writes store.lock; a fresh lock clears and
// focuses the fields, a re-entrant 401 keeps the PIN being typed. Unlocking
// goes through FinSight.auth, whose event resumes the legacy boot/polling.
// The form sits on the landing "opening bell" stage (Stage.tsx).
const store = () => window.FinSight.store;
export default function LockIsland() {
  useEffect(() => { const host = document.getElementById('lock-screen'); host?.setAttribute('role', 'region'); host?.setAttribute('aria-label', 'FinSight lock screen'); }, []);
  const lock = useStore(store(), (s) => s.lock);
  const [pin, setPin] = useState(''), [pin2, setPin2] = useState('');
  // REAL or PAPER (FEAT-011): which book the terminal opens in.
  const known = useStore(book, (b) => b.book);
  const [choice, setChoice] = useState<Book>(known);
  useEffect(() => { void loadBook().then(setChoice); }, []);
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
      const json = { 'Content-Type': 'application/json' };
      await api(lock.mode === 'create' ? '/api/auth/setup' : '/api/auth/login', { method: 'POST', headers: json, body: JSON.stringify({ pin: p, book: choice }) });
      if (lock.mode === 'create' && choice === 'paper') await api('/api/book', { method: 'POST', headers: json, body: JSON.stringify({ book: 'paper' }) });
      // The page was built for the other book: reload into the chosen one.
      if (choice !== known) { applyBook(choice); return window.location.reload(); }
      window.FinSight.auth.unlock();
    } catch (e) { say((e as Error).message); setPin(''); pinRef.current?.focus(); }
  }
  const offline = lock.mode === 'offline', create = lock.mode === 'create';
  const first = (profile.getState().name || '').trim().split(/\s+/)[0];
  const hello = offline ? 'Server offline.' : create ? 'Open your terminal.' : first ? <>Welcome back, <b>{first}</b>.</> : 'Welcome back.';
  const boot: BootLine[] = offline
    ? [{ text: 'looking for the finsight server' }, { text: 'retrying' }]
    : [
        { text: 'vault found · this machine only', ok: true },
        { text: 'feeds: yahoo · fred · world bank · no api keys', ok: true },
        { text: 'telemetry: none · cloud sync: none', ok: true },
        { text: create ? 'awaiting new pin' : first ? `awaiting pin · operator ${first.toLowerCase()}` : 'awaiting pin' },
      ];
  return (
    <div className="sx-shell">
      <div className="sx-head">
        <span className="sx-brand"><span className="sx-dot" aria-hidden="true" /><img className="logo-img lock-logo-img" src="/icon.png" alt="" aria-hidden="true" />FINSIGHT <span className="dim">//</span> <span className="amber">OPENING BELL</span></span>
        <span className="sx-meta" aria-hidden="true">{offline ? 'OFFLINE' : 'LOCAL'} · <Clock /></span>
      </div>
      <div className="sx-main">
        <Stage boot={boot} />
        <div className="lock-box sx-card">
          <span className="sx-kicker">ACCESS · LOCAL VAULT</span>
          <span className="sx-hello" aria-hidden="true">{hello}</span>
          <div id="lock-title" role="heading" aria-level={1} className="lock-title">{lockTitle(lock.mode)}</div>
          {!offline && (
            <div className="lock-book" role="group" aria-label="Open in">
              <button type="button" id="lock-book-real" aria-pressed={choice === 'real'} onClick={() => setChoice('real')}>REAL PORTFOLIO</button>
              <button type="button" id="lock-book-paper" className="paper" aria-pressed={choice === 'paper'} onClick={() => setChoice('paper')}>PAPER TRADING</button>
            </div>
          )}
          <input id="lock-pin" aria-label={create ? 'Create PIN' : 'PIN'} ref={pinRef} className={'lock-input' + (offline ? ' hidden' : '')} type="password" inputMode="numeric" autoComplete="off" maxLength={12} placeholder="● ● ● ●"
            value={pin} onChange={(e) => setPin(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { if (create) pin2Ref.current?.focus(); else void submit(); } }} />
          <input id="lock-pin2" aria-label="Confirm PIN" ref={pin2Ref} className={'lock-input' + (create ? '' : ' hidden')} type="password" inputMode="numeric" autoComplete="off" maxLength={12} placeholder="Confirm PIN"
            value={pin2} onChange={(e) => setPin2(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }} />
          <button id="lock-go" className={'lock-btn' + (offline ? ' hidden' : '')} onClick={() => void submit()}>{create ? 'SET PIN' : 'UNLOCK'}</button>
          <div id="lock-msg" role="status" className="lock-msg">{lock.msg}</div>
          <div className="lock-hint muted small">Locked behind your PIN. Data stays on this computer only.</div>
        </div>
      </div>
      <Tape />
    </div>
  );
}
