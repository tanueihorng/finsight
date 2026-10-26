import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { useModalFocus } from './modalFocus.ts';
import styles from './overlay.module.css';

// In-app confirm and text prompts, replacing window.confirm / window.prompt.
// One at a time: asking while another is open answers the older one with
// "cancel" first. confirmDialog resolves true/false, promptDialog the text
// or null.
type Ask = {
  kind: 'confirm' | 'prompt'; title: string; body?: string; ok: string; danger?: boolean;
  value?: string; placeholder?: string; resolve: (v: string | null) => void;
};
export const dialogs = createStore<{ ask: Ask | null }>()(() => ({ ask: null }));

function open(a: Omit<Ask, 'resolve'>): Promise<string | null> {
  dialogs.getState().ask?.resolve(null);
  return new Promise((resolve) => dialogs.setState({ ask: { ...a, resolve } }));
}
export const confirmDialog = (o: { title: string; body?: string; ok?: string; danger?: boolean }) =>
  open({ kind: 'confirm', ok: 'OK', ...o }).then((v) => v != null);
export const promptDialog = (o: { title: string; body?: string; ok?: string; value?: string; placeholder?: string }) =>
  open({ kind: 'prompt', ok: 'OK', ...o });

export default function DialogIsland() {
  const ask = useStore(dialogs, (s) => s.ask);
  const [text, setText] = useState('');
  const box = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null), ok = useRef<HTMLButtonElement>(null);
  useEffect(() => { setText(ask?.value ?? ''); }, [ask]);
  const answer = (v: string | null) => { const a = dialogs.getState().ask; if (!a) return; dialogs.setState({ ask: null }); a.resolve(v); };
  // A destructive confirm starts on Cancel, so a stray Enter doesn't delete.
  useModalFocus(!!ask, () => answer(null), box, { initialFocus: () => ask?.kind === 'prompt' ? input.current : ask?.danger ? null : ok.current });
  if (!ask) return null;
  return (
    <div className={styles.scrim} onClick={(e) => { if (e.target === e.currentTarget) answer(null); }}>
      <div id="app-dialog" ref={box} className={styles.dialog} role={ask.kind === 'confirm' ? 'alertdialog' : 'dialog'} aria-modal="true"
        aria-labelledby="app-dialog-title" aria-describedby={ask.body ? 'app-dialog-body' : undefined} tabIndex={-1}>
        <form onSubmit={(e) => { e.preventDefault(); answer(ask.kind === 'prompt' ? text : ''); }}>
          <h2 id="app-dialog-title" className={styles.dlgTitle}>{ask.title}</h2>
          {ask.body && <p id="app-dialog-body" className={styles.dlgBody}>{ask.body}</p>}
          {ask.kind === 'prompt' && <input id="app-dialog-input" ref={input} className={styles.field} aria-label={ask.title} value={text}
            placeholder={ask.placeholder} autoComplete="off" onChange={(e) => setText(e.target.value)} />}
          <div className={styles.dlgFoot}>
            <button type="button" id="app-dialog-cancel" className={styles.btn} onClick={() => answer(null)}>Cancel</button>
            <button type="submit" id="app-dialog-ok" ref={ok} className={`${styles.btn} ${ask.danger ? styles.danger : styles.primary}`}>{ask.ok}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
