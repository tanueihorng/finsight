import { useEffect, useState } from 'react';
import { useStore } from 'zustand';
import { createStore } from 'zustand/vanilla';
import { api } from '../api/client.ts';
import { setStatus } from '../legacy/app.ts';
import styles from './overlay.module.css';

// One toast at a time, bottom left. A toast with undoLabel offers Undo, which
// only undoes when the server's last undoable write still has that label, so
// a later change (another tab, the command bar) is never undone by mistake.
type Toast = { id: number; text: string; kind: 'ok' | 'err'; undoLabel?: string };
export const toasts = createStore<{ toast: Toast | null }>()(() => ({ toast: null }));
let seq = 0;
export function showToast(text: string, opts: { kind?: 'ok' | 'err'; undoLabel?: string } = {}) {
  toasts.setState({ toast: { id: ++seq, text, kind: opts.kind ?? 'ok', undoLabel: opts.undoLabel } });
}
const dismiss = (id: number) => { if (toasts.getState().toast?.id === id) toasts.setState({ toast: null }); };

async function undo(t: Toast) {
  dismiss(t.id);
  try {
    const u = await api<{ last?: { label: string } | null }>('/api/undo');
    if (u.last?.label !== t.undoLabel) return showToast('Something else changed since. Use ↶ UNDO to step back.', { kind: 'err' });
    await window.FinSight.actions?.undo();
    showToast(`Undid: ${t.undoLabel}`);
  } catch (e) { setStatus('UNDO: ' + (e as Error).message, 'err'); }
}

export default function ToastIsland() {
  const t = useStore(toasts, (s) => s.toast);
  const [hover, setHover] = useState(false);
  useEffect(() => setHover(false), [t?.id]); // a toast removed under the pointer never sees mouseleave
  // Long enough to reach Undo; the pointer over the toast holds it open.
  useEffect(() => { if (!t || hover) return; const h = setTimeout(() => dismiss(t.id), t.undoLabel ? 10_000 : 4000); return () => clearTimeout(h); }, [t, hover]);
  return (
    <div className={styles.toastDock} role="status" aria-live="polite">
      {t && <div key={t.id} id="app-toast" className={`${styles.toast} ${t.kind === 'err' ? styles.toastErr : ''}`}
        onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        <span className={styles.toastDot} aria-hidden="true" />
        <span>{t.text}</span>
        {t.undoLabel && <button id="app-toast-undo" className={styles.toastUndo} onClick={() => void undo(t)}>Undo</button>}
        <button className={styles.toastX} aria-label="Dismiss" onClick={() => dismiss(t.id)}>✕</button>
      </div>}
    </div>
  );
}
