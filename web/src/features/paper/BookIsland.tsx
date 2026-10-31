import { useEffect, useState } from 'react';
import { showToast } from '../../ui/toast.tsx';
import { loadBook, switchBook, useBook, type Book } from './book.ts';
import s from './Paper.module.css';

// REAL | PAPER switch in the top bar (FEAT-011). Switching reloads the page in
// the other book; the choice is the server's, so other tabs and Kestrel follow.
export default function BookIsland() {
  const current = useBook();
  const [busy, setBusy] = useState(false);
  useEffect(() => { void loadBook(); }, []);
  const go = async (b: Book) => {
    if (busy || b === current) return;
    setBusy(true);
    try { await switchBook(b); } catch (e) { showToast((e as Error).message, { kind: 'err' }); setBusy(false); }
  };
  return (
    <span className={s.book} role="group" aria-label="Portfolio mode">
      {(['real', 'paper'] as const).map((b) => (
        <button key={b} id={`book-${b}`} type="button" className={`${s.bookBtn} ${current === b ? (b === 'paper' ? s.bookPaperOn : s.bookOn) : ''}`}
          aria-pressed={current === b} disabled={busy} onClick={() => void go(b)}
          title={b === 'real' ? 'Your real portfolio' : 'Paper trading on your Alpaca paper account (fake money)'}>
          {b === 'real' ? 'REAL' : 'PAPER'}
        </button>
      ))}
    </span>
  );
}
