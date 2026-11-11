import { useSyncExternalStore } from 'react';
import { createStore } from 'zustand/vanilla';
import { api, bookGuard } from '../../api/client.ts';

// REAL / PAPER book (FEAT-012). The server owns the choice (DATA_DIR/book.json)
// so every tab and Kestrel agree; this mirrors it, marks <html data-book> for
// styling, and switches by asking the server and reloading the page, so no
// query keeps data from the other book. A tab follows a switch made elsewhere
// the same way: pushed over the event stream, rechecked on focus and reconnect,
// and whenever a response comes back from a different book.
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
/** Match the server's choice, reloading if this tab shows the other book. A failed check changes nothing. */
let syncing: Promise<void> | null = null;
export function syncBook(reload: () => void = () => window.location.reload()): Promise<void> {
  return syncing ??= (async () => {
    try {
      const s = await (await fetch('/api/auth/status', { credentials: 'same-origin' })).json() as { book?: unknown };
      const here = book.getState();
      if (isBook(s.book) && here.known && s.book !== here.book) { applyBook(s.book); reload(); }
    } catch { /* offline: the next focus or reconnect checks again */ }
    finally { syncing = null; }
  })();
}
bookGuard.shown = () => (book.getState().known ? book.getState().book : null);
bookGuard.served = () => { void syncBook(); };

// One event stream per tab (browsers allow six connections per origin), shared
// by the book switch and the paper desk.
export type ServerEvent = { kind?: string };
const listeners = new Set<(e: ServerEvent) => void>();
export function onServerEvent(fn: (e: ServerEvent) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
let stream: EventSource | null = null;
function closeStream() { stream?.close(); stream = null; }
function openStream() {
  if (typeof EventSource !== 'function' || window.FinSight.auth?.unlocked === false) return;
  if (stream && stream.readyState !== EventSource.CLOSED) return;
  stream = new EventSource('/api/paper/stream');
  stream.onmessage = (m) => {
    let e: ServerEvent = {};
    try { e = JSON.parse(m.data) as ServerEvent; } catch { return; }
    // 'hello' opens every connection, so a reconnect catches a switch it missed.
    if (e.kind === 'hello' || e.kind === 'book-choice') { void syncBook(); return; }
    for (const fn of listeners) fn(e);
  };
}
export function watchBook(): () => void {
  const check = () => { if (document.visibilityState !== 'hidden') void syncBook(); };
  const unlocked = () => { openStream(); void syncBook(); };
  openStream();
  window.addEventListener('focus', check); window.addEventListener('online', check);
  document.addEventListener('visibilitychange', check);
  window.addEventListener('finsight:unlocked', unlocked); window.addEventListener('finsight:locked', closeStream);
  return () => {
    closeStream();
    window.removeEventListener('focus', check); window.removeEventListener('online', check);
    document.removeEventListener('visibilitychange', check);
    window.removeEventListener('finsight:unlocked', unlocked); window.removeEventListener('finsight:locked', closeStream);
  };
}
const subscribe = (fn: () => void) => book.subscribe(fn);
export const useBook = () => useSyncExternalStore(subscribe, () => book.getState().book);
