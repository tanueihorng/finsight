// Offline fake of the Alpaca paper API (FEAT-011), used with FINSIGHT_FAKE_MARKET=1
// (lib/fakemarket.ts routes paper-api.alpaca.markets here). Deterministic:
// market orders fill at once at the fixture quote; limit orders fill when the
// quote is marketable. Trade updates go straight to paperstream's event bus,
// so no socket is opened. State persists in DATA_DIR/paper/fake-alpaca.json.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.ts';
import { events } from './paperstream.ts';

type Order = Record<string, any>; // Alpaca order JSON
interface State { accountNumber: string; cash: number; orders: Order[]; fills: Order[]; positions: Record<string, { qty: number; cost: number }> }
const FILE = () => path.join(DATA_DIR, 'paper', 'fake-alpaca.json');
const START_CASH = 100_000;
let price: (symbol: string) => Promise<number | null> = async () => null;
/** fakemarket supplies the fixture price. */
export function setPriceSource(fn: (symbol: string) => Promise<number | null>) { price = fn; }

function load(): State {
  try { return JSON.parse(fs.readFileSync(FILE(), 'utf8')); }
  catch { return { accountNumber: 'PA3FAKE' + crypto.randomBytes(3).toString('hex').toUpperCase(), cash: START_CASH, orders: [], fills: [], positions: {} }; }
}
function save(s: State) { fs.mkdirSync(path.dirname(FILE()), { recursive: true }); fs.writeFileSync(FILE(), JSON.stringify(s, null, 2), { mode: 0o600 }); }
const json = (status: number, body: unknown) => new Response(body == null ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const yahoo = (s: string) => s.replace(/\./g, '-');
const OPEN = new Set(['new', 'partially_filled']);
let seq = 0;
const stamp = () => new Date(Date.now() + (seq++ % 1000)).toISOString();

function emit(event: string, o: Order, extra: Record<string, unknown> = {}) {
  setImmediate(() => events.emit('trade_update', { event, at: stamp(), price: extra.price ?? null, qty: extra.qty ?? null, executionId: extra.executionId ?? null, positionQty: extra.positionQty ?? null,
    order: { id: o.id, client_order_id: o.client_order_id, symbol: o.symbol, side: o.side, status: o.status, filled_qty: o.filled_qty, filled_avg_price: o.filled_avg_price } }));
}
async function tryFill(s: State, o: Order): Promise<boolean> {
  const px = await price(yahoo(o.symbol));
  if (!px) return false;
  if (o.type === 'limit' && (o.side === 'buy' ? px > Number(o.limit_price) : px < Number(o.limit_price))) return false;
  const qty = o.qty != null ? Number(o.qty) : Math.floor((Number(o.notional) / px) * 1e6) / 1e6;
  const pos = s.positions[o.symbol] ?? { qty: 0, cost: 0 };
  if (o.side === 'buy') {
    if (qty * px > s.cash + 1e-9) { o.status = 'rejected'; emit('rejected', o); return true; }
    s.cash -= qty * px; pos.cost += qty * px; pos.qty += qty;
  } else {
    if (qty > pos.qty + 1e-9) { o.status = 'rejected'; emit('rejected', o); return true; }
    pos.cost -= pos.qty ? pos.cost * (qty / pos.qty) : 0; pos.qty -= qty; s.cash += qty * px;
  }
  if (pos.qty > 1e-9) s.positions[o.symbol] = pos; else delete s.positions[o.symbol];
  const at = stamp();
  Object.assign(o, { status: 'filled', filled_qty: String(qty), filled_avg_price: String(px), filled_at: at, qty: String(qty) });
  const execId = crypto.randomUUID();
  s.fills.push({ id: `${at.replace(/\D/g, '')}::${execId}`, activity_type: 'FILL', transaction_time: at, type: 'fill', price: String(px), qty: String(qty), side: o.side, symbol: o.symbol, order_id: o.id, leaves_qty: '0', cum_qty: String(qty) });
  emit('fill', o, { price: String(px), qty: String(qty), executionId: execId, positionQty: String(pos.qty) });
  return true;
}
/** Re-check open limit orders (called on every request, like a tick). */
async function tick(s: State) { for (const o of s.orders) if (OPEN.has(o.status)) await tryFill(s, o); }

function authed(init?: RequestInit): boolean {
  const h = new Headers(init?.headers);
  return /^PK/i.test(h.get('APCA-API-KEY-ID') || '') && !!h.get('APCA-API-SECRET-KEY');
}
export async function handle(u: URL, init?: RequestInit): Promise<Response> {
  if (!authed(init)) return json(401, { message: 'request is not authorized' });
  const method = (init?.method || 'GET').toUpperCase(), p = u.pathname;
  const s = load();
  try {
    await tick(s);
    if (p === '/v2/account' && method === 'GET') {
      let mv = 0;
      for (const [sym, pos] of Object.entries(s.positions)) mv += pos.qty * ((await price(yahoo(sym))) ?? pos.cost / pos.qty);
      return json(200, { id: 'fake', account_number: s.accountNumber, status: 'ACTIVE', currency: 'USD', cash: String(s.cash), equity: String(s.cash + mv), buying_power: String(s.cash * 2), last_equity: String(START_CASH) });
    }
    if (p === '/v2/positions' && method === 'GET') {
      const out = [];
      for (const [sym, pos] of Object.entries(s.positions)) {
        const px = (await price(yahoo(sym))) ?? pos.cost / pos.qty;
        out.push({ symbol: sym, qty: String(pos.qty), side: 'long', avg_entry_price: String(pos.cost / pos.qty), market_value: String(pos.qty * px), current_price: String(px), unrealized_pl: String(pos.qty * px - pos.cost), asset_class: 'us_equity' });
      }
      return json(200, out);
    }
    if (p === '/v2/orders' && method === 'GET') {
      const st = u.searchParams.get('status') || 'open';
      const list = [...s.orders].reverse().filter((o) => st === 'all' || (st === 'open' ? OPEN.has(o.status) : !OPEN.has(o.status)));
      return json(200, list.slice(0, Number(u.searchParams.get('limit')) || 50));
    }
    if (p === '/v2/orders' && method === 'POST') {
      const b = JSON.parse(String(init?.body || '{}'));
      if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(b.symbol || '')) return json(422, { message: `asset "${b.symbol}" not found` });
      if (!(await price(yahoo(b.symbol)))) return json(422, { message: `asset ${b.symbol} is not tradable` });
      const o: Order = { id: crypto.randomUUID(), client_order_id: b.client_order_id || crypto.randomUUID(), symbol: b.symbol, side: b.side, type: b.type, time_in_force: b.time_in_force,
        qty: b.qty ?? null, notional: b.notional ?? null, limit_price: b.limit_price ?? null, filled_qty: '0', filled_avg_price: null, status: 'new', created_at: stamp(), submitted_at: stamp(), filled_at: null, canceled_at: null };
      s.orders.push(o);
      emit('new', o);
      await tryFill(s, o);
      return json(200, o);
    }
    const m = p.match(/^\/v2\/orders\/([A-Za-z0-9-]+)$/);
    if (m && method === 'DELETE') {
      const o = s.orders.find((x) => x.id === m[1]);
      if (!o) return json(404, { message: 'order not found' });
      if (!OPEN.has(o.status)) return json(422, { message: `order is already in "${o.status}" state` });
      Object.assign(o, { status: 'canceled', canceled_at: stamp() });
      emit('canceled', o);
      return json(204, null);
    }
    if (m && method === 'GET') { const o = s.orders.find((x) => x.id === m[1]); return o ? json(200, o) : json(404, { message: 'order not found' }); }
    if (p === '/v2/account/activities/FILL' && method === 'GET') {
      const token = u.searchParams.get('page_token'), size = Number(u.searchParams.get('page_size')) || 100;
      const i = token ? s.fills.findIndex((f) => f.id === token) + 1 : 0;
      return json(200, s.fills.slice(i, i + size));
    }
    return json(404, { message: 'Not Found' });
  } finally { save(s); }
}
