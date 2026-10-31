// Paper trading (FEAT-011): REAL/PAPER book switch, Alpaca paper connect,
// orders and fills mirrored into the PAPER book, and Kestrel's orders under
// the user's approval mode and limits. Runs the real server against the
// offline fake broker (lib/fakealpaca.ts); no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, setup, json, sleep, type Server } from './serverproc.ts';
import { handleFrame, decodeFrame, backoffMs } from '../lib/paperstream.ts';
import { checkKeyShape } from '../lib/alpaca.ts';
import { normalizeOrder, toAlpacaSymbol, toBookSymbol, limitBreach } from '../lib/paper.ts';

const KEY = { keyId: 'PKTEST1234567890ABCD', secret: 'abcdefghijklmnopqrstuvwxyz0123456789ABCD' };
const token = (s: Server) => JSON.parse(fs.readFileSync(path.join(s.dataDir, 'agent-link.json'), 'utf8')).token as string;
const agent = (s: Server, body?: unknown) => ({ headers: { 'content-type': 'application/json', authorization: `Bearer ${token(s)}` }, ...(body === undefined ? {} : { body }) });
async function until<T>(fn: () => Promise<T>, ok: (v: T) => boolean, ms = 4000): Promise<T> {
  const end = Date.now() + ms; let v = await fn();
  while (!ok(v) && Date.now() < end) { await sleep(50); v = await fn(); }
  return v;
}
async function connected(): Promise<{ s: Server; c: string }> {
  const s = await startServer();
  const c = await setup(s);
  const r = await s.req('POST', '/api/paper/connect', json(c, KEY));
  assert.equal(r.status, 200, r.text);
  return { s, c };
}

test('REAL is the default; PAPER is chosen in the terminal or at login, and REAL data is untouched', async (t) => {
  const s = await startServer(); t.after(() => s.stop());
  const c = await setup(s);
  assert.equal((await s.req('GET', '/api/auth/status', json(c))).json.book, 'real');
  assert.equal((await s.req('POST', '/api/portfolio/buy', json(c, { symbol: 'NVDA', quantity: 3, price: 100 }))).status, 200);

  assert.equal((await s.req('POST', '/api/book', json(c, { book: 'paper' }))).json.book, 'paper');
  const pf = (await s.req('GET', '/api/portfolio', json(c))).json;
  assert.equal(pf.positions.length, 0, 'the PAPER book starts empty');
  const refused = await s.req('POST', '/api/portfolio/buy', json(c, { symbol: 'NVDA', quantity: 1, price: 100 }));
  assert.equal(refused.status, 409);
  assert.match(refused.json.error, /mirrors your Alpaca paper account/);
  assert.equal((await s.req('POST', '/api/watchlist/add', json(c, { symbol: 'AMD' }))).status, 200, 'watchlist still works in PAPER');

  // Login picks the book; a bad value is ignored.
  const login = await s.req('POST', '/api/auth/login', json(null, { pin: '482916', book: 'real' }));
  assert.equal(login.json.book, 'real');
  assert.equal((await s.req('GET', '/api/portfolio', json(c))).json.positions[0].symbol, 'NVDA');
  assert.equal((await s.req('POST', '/api/book', json(c, { book: 'live' }))).status, 400);
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'book.json'), 'utf8')).book, 'real');
});

test('connect accepts paper keys only and keeps them on the server', async (t) => {
  const s = await startServer(); t.after(() => s.stop());
  const c = await setup(s);
  const live = await s.req('POST', '/api/paper/connect', json(c, { keyId: 'AKLIVE1234567890ABCD', secret: KEY.secret }));
  assert.equal(live.status, 400); assert.match(live.json.error, /live-trading key/);
  assert.equal((await s.req('POST', '/api/paper/connect', json(c, { keyId: 'nope', secret: 'x' }))).status, 400);
  assert.equal((await s.req('GET', '/api/paper/state', json(c))).json.connected, false);

  assert.equal((await s.req('POST', '/api/paper/connect', json(c, KEY))).status, 200);
  const keysFile = path.join(s.dataDir, 'alpaca-paper.json');
  assert.equal(fs.statSync(keysFile).mode & 0o777, 0o600);
  const st = (await s.req('GET', '/api/paper/state', json(c))).json;
  assert.equal(st.connected, true); assert.equal(st.account.cash, 100000);
  assert.ok(!JSON.stringify(st).includes(KEY.secret) && !JSON.stringify(st).includes(KEY.keyId), 'keys never leave the server');
  assert.equal((await s.req('POST', '/api/paper/connect', agent(s, KEY))).status, 403, 'the agent cannot connect keys');
  await s.req('POST', '/api/paper/disconnect', json(c));
  assert.equal(fs.existsSync(keysFile), false);
});

test('a user order fills and is mirrored into the PAPER book; REAL never sees it', async (t) => {
  const { s, c } = await connected(); t.after(() => s.stop());
  const r = await s.req('POST', '/api/paper/orders', json(c, { symbol: 'AAPL', side: 'buy', type: 'market', qty: 10 }));
  assert.equal(r.status, 200, r.text); assert.equal(r.json.placed, true);
  await s.req('POST', '/api/book', json(c, { book: 'paper' }));
  const pf = await until(() => s.req('GET', '/api/portfolio', json(c)).then((x) => x.json), (p) => p.positions.length === 1);
  assert.equal(pf.positions[0].symbol, 'AAPL'); assert.equal(pf.positions[0].quantity, 10); assert.equal(pf.positions[0].avgCost, 231.5);
  assert.equal(pf.cash.find((x: { ccy: string }) => x.ccy === 'USD').amount, 100000 - 2315);
  const st = (await s.req('GET', '/api/paper/state', json(c))).json;
  assert.equal(st.recentOrders[0].origin, 'user'); assert.equal(st.recentOrders[0].status, 'filled');

  // Selling half realizes P&L in the book.
  await s.req('POST', '/api/paper/orders', json(c, { symbol: 'AAPL', side: 'sell', type: 'market', qty: 5 }));
  const after = await until(() => s.req('GET', '/api/portfolio', json(c)).then((x) => x.json), (p) => p.positions[0]?.quantity === 5);
  assert.equal(after.positions[0].quantity, 5);

  await s.req('POST', '/api/book', json(c, { book: 'real' }));
  assert.equal((await s.req('GET', '/api/portfolio', json(c))).json.positions.length, 0);
});

test('orders outside Alpaca paper coverage or with bad fields are refused before Alpaca', async (t) => {
  const { s, c } = await connected(); t.after(() => s.stop());
  const sg = await s.req('POST', '/api/paper/orders', json(c, { symbol: 'D05.SI', side: 'buy', qty: 1 }));
  assert.equal(sg.status, 400); assert.match(sg.json.error, /US-listed stocks and ETFs only/);
  assert.match((await s.req('POST', '/api/paper/orders', json(c, { symbol: 'AAPL', side: 'buy', qty: 1, notional: 50 }))).json.error, /not both/);
  assert.match((await s.req('POST', '/api/paper/orders', json(c, { symbol: 'AAPL', side: 'buy', type: 'limit', qty: 1 }))).json.error, /limit price/);
});

test('a resting limit order stays open and can be cancelled', async (t) => {
  const { s, c } = await connected(); t.after(() => s.stop());
  const r = await s.req('POST', '/api/paper/orders', json(c, { symbol: 'MSFT', side: 'buy', type: 'limit', qty: 2, limitPrice: 400, tif: 'gtc' }));
  assert.equal(r.json.order.status, 'new');
  let st = (await s.req('GET', '/api/paper/state', json(c))).json;
  assert.equal(st.openOrders.length, 1);
  assert.equal((await s.req('POST', '/api/paper/orders/cancel', json(c, { id: r.json.order.id }))).status, 200);
  st = (await s.req('GET', '/api/paper/state', json(c))).json;
  assert.equal(st.openOrders.length, 0); assert.equal(st.recentOrders[0].status, 'canceled');
});

test('Kestrel in "ask" mode creates a pending ticket the user approves or rejects', async (t) => {
  const { s, c } = await connected(); t.after(() => s.stop());
  assert.equal((await s.req('GET', '/api/paper/settings', agent(s))).json.approval, 'ask');
  const k = await s.req('POST', '/api/paper/orders', agent(s, { symbol: 'NVDA', side: 'buy', qty: 4, note: 'Momentum entry', threadId: 'th_test' }));
  assert.equal(k.status, 200, k.text); assert.equal(k.json.pendingApproval, true);
  const id = k.json.ticket.id;
  let st = (await s.req('GET', '/api/paper/state', json(c))).json;
  assert.equal(st.openOrders.length + st.recentOrders.length, 0, 'nothing reached Alpaca yet');
  assert.equal(st.tickets[0].status, 'pending'); assert.equal(st.tickets[0].estimate.valueUsd, 4 * 182.4);

  assert.equal((await s.req('POST', '/api/paper/tickets/decide', agent(s, { id, approve: true }))).status, 403, 'Kestrel cannot approve its own ticket');
  const ok = await s.req('POST', '/api/paper/tickets/decide', json(c, { id, approve: true }));
  assert.equal(ok.json.status, 'approved');
  st = await until(() => s.req('GET', '/api/paper/state', json(c)).then((x) => x.json), (v) => v.recentOrders.length === 1);
  assert.equal(st.recentOrders[0].origin, 'kestrel'); assert.equal(st.recentOrders[0].threadId, 'th_test');
  assert.equal((await s.req('POST', '/api/paper/tickets/decide', json(c, { id, approve: true }))).status, 400, 'a ticket is decided once');

  const k2 = await s.req('POST', '/api/paper/orders', agent(s, { symbol: 'AMD', side: 'buy', qty: 1 }));
  assert.equal((await s.req('POST', '/api/paper/tickets/decide', json(c, { id: k2.json.ticket.id, approve: false }))).json.status, 'rejected');
});

test('Kestrel in "auto" mode places directly, within the limits the user set', async (t) => {
  const { s, c } = await connected(); t.after(() => s.stop());
  assert.equal((await s.req('POST', '/api/paper/settings', agent(s, { approval: 'auto' }))).status, 403, 'Kestrel cannot change its own settings');
  const set = await s.req('POST', '/api/paper/settings', json(c, { approval: 'auto', limits: { maxOrderUsd: 1000, maxOrdersPerDay: 2, symbols: 'AAPL, msft, brk-b' } }));
  assert.deepEqual(set.json.limits, { maxOrderUsd: 1000, maxOrdersPerDay: 2, maxPositionPct: null, symbols: ['AAPL', 'MSFT', 'BRK.B'] });

  const big = await s.req('POST', '/api/paper/orders', agent(s, { symbol: 'AAPL', side: 'buy', qty: 10 }));
  assert.equal(big.json.refused, true); assert.match(big.json.reason, /above your US\$1000 limit/);
  const other = await s.req('POST', '/api/paper/orders', agent(s, { symbol: 'NVDA', side: 'buy', qty: 1 }));
  assert.match(other.json.reason, /not in your allowed symbols/);
  assert.equal((await s.req('POST', '/api/paper/orders', agent(s, { symbol: 'AAPL', side: 'buy', qty: 2 }))).json.placed, true);
  assert.equal((await s.req('POST', '/api/paper/orders', agent(s, { symbol: 'MSFT', side: 'buy', qty: 1 }))).json.placed, true);
  const third = await s.req('POST', '/api/paper/orders', agent(s, { symbol: 'AAPL', side: 'buy', qty: 1 }));
  assert.match(third.json.reason, /already placed 2 paper orders today; your limit is 2/);
  // The user's own orders are not bound by Kestrel's limits.
  assert.equal((await s.req('POST', '/api/paper/orders', json(c, { symbol: 'NVDA', side: 'buy', qty: 20 }))).json.placed, true);
});

test('the paper event stream pushes order and book changes', async (t) => {
  const { s, c } = await connected(); t.after(() => s.stop());
  const seen: string[] = [];
  const http = await import('node:http');
  await new Promise<void>((resolve) => {
    const r = http.get({ host: '127.0.0.1', port: s.port, path: '/api/paper/stream', headers: { cookie: c, host: `127.0.0.1:${s.port}` } }, (res) => {
      res.setEncoding('utf8');
      res.on('data', (chunk: string) => {
        for (const m of chunk.matchAll(/data: (.+)\n/g)) seen.push(JSON.parse(m[1]!).kind);
        if (seen.includes('hello') && seen.length === 1) void s.req('POST', '/api/paper/orders', json(c, { symbol: 'TSLA', side: 'buy', qty: 1 }));
        if (seen.includes('book')) { r.destroy(); resolve(); }
      });
    });
  });
  assert.ok(seen.includes('order') && seen.includes('book'), seen.join(','));
});

// ---- pure pieces ------------------------------------------------------------------
test('stream frames: auth, listen, trade updates (text or binary), backoff', async () => {
  assert.deepEqual(handleFrame({ stream: 'authorization', data: { status: 'authorized', action: 'authenticate' } }), { kind: 'authorized' });
  assert.equal(handleFrame({ stream: 'authorization', data: { status: 'unauthorized' } }).kind, 'auth_failed');
  assert.equal(handleFrame({ stream: 'listening', data: { streams: ['trade_updates'] } }).kind, 'listening');
  const raw = { stream: 'trade_updates', data: { event: 'fill', price: '10.5', qty: '2', timestamp: '2026-10-31T14:00:00Z', execution_id: 'e1', position_qty: '2', order: { id: 'o1', client_order_id: 'fs-k-x', symbol: 'AAPL', side: 'buy', status: 'filled', filled_qty: '2', filled_avg_price: '10.5' } } };
  const bin = new TextEncoder().encode(JSON.stringify(raw)).buffer;
  const r = handleFrame(await decodeFrame(bin));
  assert.equal(r.kind, 'update');
  if (r.kind === 'update') { assert.equal(r.update.event, 'fill'); assert.equal(r.update.order.client_order_id, 'fs-k-x'); }
  assert.equal(handleFrame({ action: 'error', data: { error_message: 'bad' } }).kind, 'error');
  assert.equal(backoffMs(0, () => 0.5), 1000); assert.equal(backoffMs(10, () => 0.5), 60000);
});

test('symbols, keys and order normalisation', async () => {
  assert.equal(toAlpacaSymbol('brk-b'), 'BRK.B'); assert.equal(toBookSymbol('BRK.B'), 'BRK-B');
  assert.throws(() => toAlpacaSymbol('0700.HK'), /US-listed/);
  assert.throws(() => checkKeyShape('AKX1234567890', KEY.secret), /live-trading key/);
  assert.equal(checkKeyShape(KEY.keyId, KEY.secret).keyId, KEY.keyId);
  assert.deepEqual(normalizeOrder({ symbol: 'aapl', side: 'BUY', notional: 50 }), { symbol: 'AAPL', side: 'buy', type: 'market', qty: null, notional: 50, limitPrice: null, tif: 'day' });
  assert.throws(() => normalizeOrder({ symbol: 'AAPL', side: 'buy', qty: 0.5, tif: 'gtc' }), /day orders/);
  const s = { approval: 'auto' as const, limits: { maxOrderUsd: null, maxOrdersPerDay: null, maxPositionPct: 10, symbols: null } };
  const o = normalizeOrder({ symbol: 'AAPL', side: 'buy', qty: 10, type: 'limit', limitPrice: 100 });
  assert.match(String(await limitBreach(o, s, { price: 100, priceSource: 'limit price', valueUsd: 1000 }, { kestrelOrdersToday: 0, equity: 10000, positionValue: 500 })), /15\.0% of paper equity/);
  assert.equal(await limitBreach(o, s, { price: 100, priceSource: 'limit price', valueUsd: 1000 }, { kestrelOrdersToday: 0, equity: 100000, positionValue: 500 }), null);
});
