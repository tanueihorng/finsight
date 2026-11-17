// BOOKRACE-001: a portfolio mutation must write the book it started in, even if
// the REAL/PAPER selection changes while it awaits quotes or FX. The fake
// Yahoo fetch is gated so the switch lands deterministically mid-mutation.
import { setSymbol, reset, dataDir } from './helpers.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import * as pf from '../lib/portfolio.ts';
import { chooseBook, withBook } from '../lib/book.ts';
import { loadPortfolio, undoInfo } from '../lib/store.ts';

/** Hold the next chart fetch for `symbol` until release() is called. */
function gate(symbol: string) {
  const real = globalThis.fetch;
  let release!: () => void, reached!: () => void;
  const opened = new Promise<void>((r) => { release = r; });
  const atGate = new Promise<void>((r) => { reached = r; });
  let used = false;
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    if (!used && String(url).includes('/v8/finance/chart/' + encodeURIComponent(symbol))) { used = true; reached(); await opened; }
    return real(url as string, init);
  }) as typeof fetch;
  return { atGate, release, restore: () => { globalThis.fetch = real; } };
}
const held = (book: 'real' | 'paper') => withBook(book, () => loadPortfolio().accounts.flatMap((a) => a.positions.map((p) => p.symbol)));

test('a buy started in REAL lands in REAL when PAPER is chosen mid-flight', async (t) => {
  reset(); chooseBook('real');
  setSymbol('AAPL', { currency: 'USD', price: 100 });
  const g = gate('AAPL'); t.after(() => { g.restore(); chooseBook('real'); });
  const buying = pf.buy('AAPL', 3, 100, null, undefined, 'SGD');
  await g.atGate;           // the buy has loaded the REAL book and is awaiting its quote
  chooseBook('paper');      // the user flips the terminal to PAPER
  g.release();
  await buying;
  assert.deepEqual(held('real'), ['AAPL']);
  assert.deepEqual(held('paper'), [], 'nothing leaks into the PAPER book');
  assert.equal(fs.existsSync(path.join(dataDir, 'paper', 'undo.json')), false, 'the undo step belongs to REAL');
  assert.equal(withBook('real', () => undoInfo()).available, 1);
});

test('a mutation queued behind the lock keeps the book it was started in', async (t) => {
  reset(); chooseBook('real');
  setSymbol('AAPL', { currency: 'USD', price: 100 }); setSymbol('MSFT', { currency: 'USD', price: 50 });
  const g = gate('AAPL'); t.after(() => { g.restore(); chooseBook('real'); });
  const first = pf.buy('AAPL', 1, 100, null, undefined, 'SGD');
  await g.atGate;
  const second = pf.buy('MSFT', 2, 50, null, undefined, 'SGD'); // started in REAL, waits for the lock
  chooseBook('paper');
  g.release();
  await Promise.all([first, second]);
  assert.deepEqual(held('real').sort(), ['AAPL', 'MSFT']);
  assert.deepEqual(held('paper'), []);
});

// HTTP: a REAL edit that passed the PAPER read-only check must not land in PAPER
// when the book is switched while its body is still arriving.
import http from 'node:http';
import { startServer, setup, json } from './serverproc.ts';

test('HTTP: a REAL buy whose body arrives after a switch to PAPER still writes REAL', async (t) => {
  const s = await startServer(); t.after(() => s.stop());
  const c = await setup(s);
  const body = JSON.stringify({ symbol: 'NVDA', quantity: 2, price: 100 });
  const half = Math.floor(body.length / 2);
  let resolveRes!: (v: { status: number; text: string }) => void;
  const done = new Promise<{ status: number; text: string }>((r) => { resolveRes = r; });
  const req = http.request({ host: '127.0.0.1', port: s.port, method: 'POST', path: '/api/portfolio/buy',
    headers: { host: `127.0.0.1:${s.port}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body), cookie: c } }, (res) => {
    let text = ''; res.on('data', (d) => { text += d; }); res.on('end', () => resolveRes({ status: res.statusCode!, text }));
  });
  await new Promise<void>((r) => req.write(body.slice(0, half), () => r())); // headers + half the body are on the wire
  await s.req('GET', '/api/health'); // one full round trip after them: the server is now waiting for the rest
  assert.equal((await s.req('POST', '/api/book', json(c, { book: 'paper' }))).json.book, 'paper');
  req.end(body.slice(half));
  const r = await done;
  assert.equal(r.status, 200, r.text);
  assert.equal((await s.req('GET', '/api/portfolio', json(c))).json.positions.length, 0, 'PAPER untouched');
  await s.req('POST', '/api/book', json(c, { book: 'real' }));
  assert.deepEqual((await s.req('GET', '/api/portfolio', json(c))).json.positions.map((p: { symbol: string }) => p.symbol), ['NVDA']);
});
