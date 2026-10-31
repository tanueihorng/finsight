import { useSyncExternalStore } from 'react';
import { createStore } from 'zustand/vanilla';
import { api } from '../../api/client.ts';

// REAL / PAPER book (FEAT-012). The server owns the choice (DATA_DIR/book.json)
// so every tab and Kestrel agree; this mirrors it, marks <html data-book> for
// styling, and switches by asking the server and reloading the page, so no
// query keeps data from the other book.
export type Book = 'real' | 'paper';
export const isBook = (b: unknown): b is Book => b === 'real' || b === 'paper';
export const book = createStore<{ book: Book; known: boolean }>()(() => ({ book: 'real', known: false }));
export function applyBook(b: Book) {
  book.setState({ book: b, known: true });
  document.documentElement.dataset.book = b;
}
// /api/auth/status answers before the PIN, so the lock screen already knows.
export async function loadBook(): Promise<Book> {
  try {
    const s = await (await fetch('/api/auth/status', { credentials: 'same-origin' })).json() as { book?: unknown };
    applyBook(isBook(s.book) ? s.book : 'real');
  } catch { applyBook('real'); }
  return book.getState().book;
}
export async function switchBook(b: Book, reload: () => void = () => window.location.reload()) {
  if (b === book.getState().book) return;
  await api<{ book: Book }>('/api/book', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ book: b }) });
  applyBook(b);
  reload();
}
const subscribe = (fn: () => void) => book.subscribe(fn);
export const useBook = () => useSyncExternalStore(subscribe, () => book.getState().book);
