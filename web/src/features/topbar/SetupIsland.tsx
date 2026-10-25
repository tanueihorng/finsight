import { useModalFocus } from '../../ui/modalFocus.ts';
import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { setStatus } from '../../legacy/app.ts';
import { CURRENCIES } from './topbar.ts';
import { profile, saveProfile } from './profile.ts';

// WELCOME / setup modal (F8). Opens by itself on first launch once the
// account is resolved (where legacy boot opened it), and from ◐ Profile.
const store = () => window.FinSight.store;
export default function SetupIsland() {
  const open = useStore(store(), (s) => s.setupOpen);
  const ready = useStore(store(), (s) => s.accountReady);
  const [name, setName] = useState(''), [base, setBase] = useState('SGD');
  const nameRef = useRef<HTMLInputElement>(null);
  useEffect(() => { if (ready && !profile.getState().setupDone) store().setState({ setupOpen: true }); }, [ready]);
  useEffect(() => {
    if (!open) return;
    setName(profile.getState().name || ''); setBase(store().getState().base);
    nameRef.current?.focus();
  }, [open]);
  const close = () => store().setState({ setupOpen: false });
  const boxRef = useRef<HTMLDivElement>(null);
  useModalFocus(open, close, boxRef, { initialFocus: () => nameRef.current });
  const commit = () => {
    const next = { ...profile.getState(), name: name.trim(), base, setupDone: true };
    saveProfile(next);
    if (next.base && next.base !== store().getState().base) {
      store().setState({ base: next.base }); try { localStorage.setItem('finsight-base', next.base); } catch { /* storage blocked */ }
      void window.FinSight.bus.invalidate('portfolio');
    }
    return next;
  };
  const choose = (action: string) => {
    const p = commit(); close();
    if (action === 'import') store().setState({ importOpen: true });
    else if (action === 'manual') store().setState({ addFormOpen: true });
    setStatus(p.name ? `Welcome, ${p.name}.` : 'Terminal ready.', 'ok');
  };

  return (
    <div id="setup-modal" className={open ? 'modal' : 'modal hidden'}>
      <div className="modal-box" ref={boxRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Set up your terminal">
        <div className="modal-head">
          <span className="panel-title">WELCOME · SET UP YOUR TERMINAL</span>
          <button id="setup-skip" className="x-btn" title="Skip" onClick={() => { saveProfile({ ...profile.getState(), setupDone: true }); close(); }}>✕</button>
        </div>
        <div className="modal-body">
          <p className="muted small">Set up your profile, then choose how to add your holdings. Everything stays on your machine — nothing is uploaded.</p>
          <div className="setup-grid">
            <label className="setup-field"><span>YOUR NAME</span><input id="setup-name" ref={nameRef} placeholder="e.g. Tan" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} /></label>
            <label className="setup-field"><span>BASE CURRENCY</span>
              <select id="setup-base" value={base} onChange={(e) => setBase(e.target.value)}>
                {CURRENCIES.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
          </div>
          <div className="setup-label muted small">HOW DO YOU WANT TO ADD YOUR HOLDINGS?</div>
          <div className="setup-choices">
            <button className="setup-choice" data-action="import" onClick={() => choose('import')}>
              <div className="sc-title">📥 Import from CSV</div>
              <div className="sc-desc">Paste or upload a spreadsheet (symbol, quantity, avg price, optional date).</div>
            </button>
            <button className="setup-choice" data-action="manual" onClick={() => choose('manual')}>
              <div className="sc-title">➕ Add manually</div>
              <div className="sc-desc">Type each position with quantity &amp; average price — full control.</div>
            </button>
            <button className="setup-choice" data-action="empty" onClick={() => choose('empty')}>
              <div className="sc-title">▦ Start empty</div>
              <div className="sc-desc">Go straight to the terminal and add positions later.</div>
            </button>
          </div>
        </div>
        <div className="modal-foot">
          <span className="muted small">Reopen any time from the <b>Profile</b> button.</span>
          <button id="setup-save" className="mini-btn solid" onClick={() => { commit(); close(); }}>SAVE &amp; CONTINUE</button>
        </div>
      </div>
    </div>
  );
}
