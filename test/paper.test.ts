// Paper trading (FEAT-012): REAL/PAPER book switch, Alpaca paper connect,
// orders and fills mirrored into the PAPER book, and Kestrel's orders under
// the user's approval mode and limits. Runs the real server against the
// offline fake broker (lib/fakealpaca.ts); no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { startServer, setup, json, sleep, cookieOf, type Server } from './serverproc.ts';
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

test('startup recovers interrupted approvals without creating a second broker order', async (t) => {
  const { s, c } = await connected();
  t.after(() => s.stop());
  const propose = (symbol: string) => s.req('POST', '/api/paper/orders', agent(s, { symbol, side: 'buy', qty: 1 }));
  const known = (await propose('NVDA')).json.ticket.id;
  const approved = (await s.req('POST', '/api/paper/tickets/decide', json(c, { id: known, approve: true }))).json.order;
  const beforeSend = (await propose('AAPL')).json.ticket.id;
  const missing = (await propose('AMD')).json.ticket.id;
  const legacy = (await propose('MSFT')).json.ticket.id;
  await s.stop();

  const orderFile = path.join(s.dataDir, 'paper', 'orders.json');
  const state = JSON.parse(fs.readFileSync(orderFile, 'utf8'));
  for (const ticket of state.tickets) {
    ticket.status = 'approving';
    ticket.decidedAt = Date.now();
    delete ticket.orderId;
    if (ticket.id === beforeSend) ticket.clientOrderId = null;
    else if (ticket.id === missing) ticket.clientOrderId = 'fixture-missing-order';
    else delete ticket.clientOrderId; // Legacy ticket with or without metadata.
  }
  fs.writeFileSync(orderFile, JSON.stringify(state));

  const restarted = await startServer({ dataDir: s.dataDir });
  t.after(() => restarted.stop());
  const login = await restarted.req('POST', '/api/auth/login', json(null, { pin: '482916' }));
  assert.equal(login.status, 200, login.text);
  const auth = cookieOf(login);
  const readState = () => restarted.req('GET', '/api/paper/state', json(auth)).then((r) => r.json);
  const recovered = await until(readState, (r) => r.tickets?.some((ticket: { id: string; status: string }) => ticket.id === known && ticket.status === 'approved'));
  const tickets = Object.fromEntries(recovered.tickets.map((ticket: { id: string }) => [ticket.id, ticket]));
  assert.equal(tickets[known].orderId, approved.id);
  assert.equal(tickets[beforeSend].status, 'pending');
  assert.equal(tickets[missing].status, 'unconfirmed');
  assert.equal(tickets[legacy].status, 'unconfirmed');
  assert.match(tickets[legacy].error, /no recorded order ID/);
  for (const id of [known, missing, legacy]) {
    const retry = await restarted.req('POST', '/api/paper/tickets/decide', json(auth, { id, approve: true }));
    assert.equal(retry.status, 400, retry.text);
  }
  const after = await readState();
  assert.deepEqual(after.recentOrders.map((order: { id: string }) => order.id), [approved.id]);
});

test('an accepted paper order with a lost response reconciles against the original client ID', async (t) => {
  const s = await startServer({ env: { FINSIGHT_FAKE_ALPACA_LOSE_ORDER_RESPONSE: '1' } });
  t.after(() => s.stop());
  const c = await setup(s);
  assert.equal((await s.req('POST', '/api/paper/connect', json(c, KEY))).status, 200);
  const proposed = await s.req('POST', '/api/paper/orders', agent(s, { symbol: 'NVDA', side: 'buy', qty: 1 }));
  const id = proposed.json.ticket.id;
  const res = await s.req('POST', '/api/paper/tickets/decide', json(c, { id, approve: true }));
  assert.match(res.json.error, /could not be confirmed/);
  assert.equal((await s.req('POST', '/api/paper/tickets/decide', json(c, { id, approve: true }))).status, 400);
  const recovered = await until(() => s.req('GET', '/api/paper/state', json(c)).then((r) => r.json),
    (r) => r.tickets[0].status === 'approved');
  assert.equal(recovered.recentOrders.length, 1);
  assert.equal(recovered.tickets[0].orderId, recovered.recentOrders[0].id);
  assert.equal(recovered.recentOrders[0].origin, 'kestrel');
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

test('security: one order per approval, Kestrel cancels only its own orders in ask mode, serialized limits, same-origin writes', async (t) => {
  const { s, c } = await connected(); t.after(() => s.stop());
  // A double click or a second tab approves once and sends one order.
  const k = await s.req('POST', '/api/paper/orders', agent(s, { symbol: 'MSFT', side: 'buy', type: 'limit', qty: 1, limitPrice: 300, tif: 'gtc' }));
  const id = k.json.ticket.id;
  const both = await Promise.all([1, 2].map(() => s.req('POST', '/api/paper/tickets/decide', json(c, { id, approve: true }))));
  assert.deepEqual(both.map((x) => x.status).sort(), [200, 400]);
  let st = (await s.req('GET', '/api/paper/state', json(c))).json;
  assert.equal(st.openOrders.length, 1, 'exactly one order reached Alpaca');
  const kestrelOrder = st.openOrders[0].id;

  // Ask mode: Kestrel cannot cancel the user's order, but can cancel its own.
  const mine = await s.req('POST', '/api/paper/orders', json(c, { symbol: 'AAPL', side: 'buy', type: 'limit', qty: 1, limitPrice: 100, tif: 'gtc' }));
  const refused = await s.req('POST', '/api/paper/orders/cancel', agent(s, { id: mine.json.order.id }));
  assert.equal(refused.json.refused, true); assert.match(refused.json.reason, /not placed by Kestrel/);
  assert.equal((await s.req('POST', '/api/paper/orders/cancel', agent(s, { id: kestrelOrder }))).json.cancelled, kestrelOrder);
  st = (await s.req('GET', '/api/paper/state', json(c))).json;
  assert.deepEqual(st.openOrders.map((o: { id: string }) => o.id), [mine.json.order.id]);

  // Auto mode: concurrent Kestrel orders cannot slip past the daily count together.
  await s.req('POST', '/api/paper/settings', json(c, { approval: 'auto', limits: { maxOrdersPerDay: 2 } }));
  const burst = await Promise.all([1, 2, 3].map(() => s.req('POST', '/api/paper/orders', agent(s, { symbol: 'NVDA', side: 'buy', qty: 1 }))));
  assert.equal(burst.filter((x) => x.json.placed).length, 1, 'one more order fits today (the approved ticket counts)');

  // A write from another origin (another localhost port shares the cookie) is refused.
  const cross = { ...json(c, { book: 'paper' }) } as { headers: Record<string, string> };
  for (const h of [{ origin: 'http://localhost:9999' }, { 'sec-fetch-site': 'same-site' }] as Record<string, string>[]) {
    const r = await s.req('POST', '/api/book', { ...cross, headers: { ...cross.headers, ...h } });
    assert.equal(r.status, 403, JSON.stringify(h));
  }
  assert.equal((await s.req('POST', '/api/book', { ...cross, headers: { ...cross.headers, 'sec-fetch-site': 'same-origin' } })).status, 200);
  assert.throws(() => normalizeOrder({ symbol: 'AAPL', side: 'buy', type: 'limit', qty: 1, limitPrice: Infinity }), /limit price/);
});

test('approving a ticket re-checks the limits as they are now, in the same gate as automatic orders', async (t) => {
  const { s, c } = await connected(); t.after(() => s.stop());
  await s.req('POST', '/api/paper/settings', json(c, { approval: 'ask', limits: { maxOrdersPerDay: 1, maxOrderUsd: 1000 } }));
  const order = { symbol: 'AAPL', side: 'buy', type: 'limit', qty: 1, limitPrice: 100, tif: 'gtc' };
  const a = (await s.req('POST', '/api/paper/orders', agent(s, order))).json, b = (await s.req('POST', '/api/paper/orders', agent(s, order))).json;
  const decide = (id: string) => s.req('POST', '/api/paper/tickets/decide', json(c, { id, approve: true }));
  assert.equal((await decide(a.ticket.id)).json.status, 'approved');

  const daily = await decide(b.ticket.id);
  assert.equal(daily.status, 400); assert.match(daily.json.error, /your limit is 1/);
  let st = (await s.req('GET', '/api/paper/state', json(c))).json;
  assert.equal(st.openOrders.length, 1, 'the refused ticket never reached Alpaca');
  const ticket = st.tickets.find((x: { id: string }) => x.id === b.ticket.id);
  assert.equal(ticket.status, 'pending', 'still waiting for the user'); assert.match(ticket.error, /your limit is 1/);

  await s.req('POST', '/api/paper/settings', json(c, { approval: 'ask', limits: { maxOrderUsd: 50 } }));
  assert.match((await decide(b.ticket.id)).json.error, /above your US\$50 limit/);
  await s.req('POST', '/api/paper/settings', json(c, { approval: 'ask', limits: {} }));
  assert.equal((await decide(b.ticket.id)).json.status, 'approved', 'raising the limit lets the same ticket through');
  st = (await s.req('GET', '/api/paper/state', json(c))).json;
  assert.equal(st.tickets.find((x: { id: string }) => x.id === b.ticket.id).error, undefined);
});

test('concentration counts unfilled buys of the symbol, and only what is unfilled', async (t) => {
  const { s, c } = await connected(); t.after(() => s.stop());
  await s.req('POST', '/api/paper/settings', json(c, { approval: 'auto', limits: { maxPositionPct: 10 } }));
  const place = (body: Record<string, unknown>) => s.req('POST', '/api/paper/orders', agent(s, body)).then((x) => x.json);
  const msft = { symbol: 'MSFT', side: 'buy', type: 'limit', qty: 60, limitPrice: 100, tif: 'gtc' };
  const first = await place(msft);
  assert.equal(first.placed, true);
  const second = await place(msft);
  assert.equal(second.refused, true); assert.match(second.reason, /MSFT would be about 12\.0% of paper equity/);
  assert.equal((await place({ ...msft, symbol: 'AAPL' })).placed, true, 'another symbol has its own room');
  assert.equal((await place({ ...msft, side: 'sell' })).refused, undefined, 'a sell adds no concentration');

  // Cancelling frees the room again.
  await s.req('POST', '/api/paper/orders/cancel', json(c, { id: first.order.id }));
  assert.equal((await place(msft)).placed, true);
  // Concurrent orders are serialized against the same room.
  const burst = await Promise.all([1, 2].map(() => place({ ...msft, symbol: 'AMD' })));
  assert.equal(burst.filter((x) => x.placed).length, 1);
});

test('every response names its book, a switch is pushed, and a write from a stale tab is refused', async (t) => {
  const s = await startServer(); t.after(() => s.stop());
  const c = await setup(s);
  assert.equal((await s.req('GET', '/api/portfolio', json(c))).headers['x-finsight-book'], 'real');

  const ac = new AbortController(); t.after(() => ac.abort());
  const res = await fetch(`http://127.0.0.1:${s.port}/api/paper/stream`, { headers: { cookie: c }, signal: ac.signal });
  const reader = res.body!.getReader(), text = new TextDecoder(); let got = '';
  await s.req('POST', '/api/book', json(c, { book: 'paper' }));
  const end = Date.now() + 3000;
  while (!got.includes('"book-choice"') && Date.now() < end) got += text.decode((await reader.read()).value);
  assert.match(got, /"kind":"book-choice","book":"paper"/);

  const stale = await s.req('POST', '/api/watchlist/add', { ...json(c, { symbol: 'AMD' }), headers: { ...json(c).headers, 'x-finsight-book': 'real' } });
  assert.equal(stale.status, 409); assert.match(stale.json.error, /now PAPER/);
  const current = await s.req('POST', '/api/watchlist/add', { ...json(c, { symbol: 'AMD' }), headers: { ...json(c).headers, 'x-finsight-book': 'paper' } });
  assert.equal(current.status, 200);
  assert.equal((await s.req('POST', '/api/book', { ...json(c, { book: 'real' }), headers: { ...json(c).headers, 'x-finsight-book': 'paper' } })).status, 200, 'a stale tab may still switch');
});
