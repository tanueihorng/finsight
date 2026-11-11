// Which book the terminal shows (FEAT-012): REAL (DATA_DIR/portfolio.json, the
// user's own portfolio) or PAPER (DATA_DIR/paper/portfolio.json, a mirror of
// the Alpaca paper account). The choice lives in DATA_DIR/book.json and is
// global, so every tab and the local agent see the same book. Code that must
// touch a specific book regardless of the choice (the paper sync) wraps itself
// in withBook().
import fs from 'node:fs';
import path from 'node:path';
import { AsyncLocalStorage } from 'node:async_hooks';
import { EventEmitter } from 'node:events';
import { DATA_DIR } from './config.ts';

export type Book = 'real' | 'paper';
export const BOOKS: readonly Book[] = ['real', 'paper'];
export const isBook = (b: unknown): b is Book => b === 'real' || b === 'paper';

const FILE = path.join(DATA_DIR, 'book.json');
const als = new AsyncLocalStorage<Book>();

function readChoice(): Book {
  try { const b = JSON.parse(fs.readFileSync(FILE, 'utf8')).book; return isBook(b) ? b : 'real'; } catch { return 'real'; }
}
let chosen: Book = readChoice();
/** Emits 'change' with the new book, so open terminals can follow. */
export const bookChanges = new EventEmitter();

/** The book the user chose (what the terminal and the agent see). */
export const chosenBook = (): Book => chosen;
export function chooseBook(b: unknown): Book {
  if (!isBook(b)) throw new Error('Mode must be real or paper');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${FILE}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ book: b, at: Date.now() }), { mode: 0o600 });
  fs.renameSync(tmp, FILE);
  const changed = b !== chosen;
  chosen = b;
  if (changed) bookChanges.emit('change', b);
  return b;
}
/** The book the current code path reads and writes. */
export const activeBook = (): Book => als.getStore() ?? chosen;
export const withBook = <T>(b: Book, fn: () => T): T => als.run(b, fn);
export const bookDir = (b: Book = activeBook()): string => (b === 'paper' ? path.join(DATA_DIR, 'paper') : DATA_DIR);
