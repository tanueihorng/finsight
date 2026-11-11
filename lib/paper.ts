// Paper trading (FEAT-012): order entry for the user and Kestrel,
// Kestrel's approval mode and limits, pending tickets, and the PAPER book,
// which mirrors the Alpaca paper account by replaying its fills.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import * as alpaca from './alpaca.ts';
import * as stream from './paperstream.ts';
import { bookDir, withBook } from './book.ts';
import { buy, sell, setCash } from './portfolio.ts';
import { getQuote } from './market.ts';
import { loadPortfolio, savePortfolio, withLock, recalcPosition } from './store.ts';

const dir = () => bookDir('paper');
const SETTINGS_FILE = () => path.join(dir(), 'settings.json');
const ORDERS_FILE = () => path.join(dir(), 'orders.json');
const SYNC_FILE = () => path.join(dir(), 'sync.json');
function readJson<T>(file: string, fallback: T): T { try { return JSON.parse(fs.readFileSync(file, 'utf8')) as T; } catch { return fallback; } }
function writeJson(file: string, v: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}
/** Browser and agent listeners: 'change' with { kind, ... }. */
export const bus = new EventEmitter();
const notify = (kind: string, extra: Record<string, unknown> = {}) => bus.emit('change', { kind, at: Date.now(), ...extra });

// ---- settings (the user's choice; agent may read, never write) -------------
export type Approval = 'ask' | 'auto';
export interface Limits { maxOrderUsd: number | null; maxOrdersPerDay: number | null; maxPositionPct: number | null; symbols: string[] | null }
export interface PaperSettings { approval: Approval; limits: Limits }
const DEFAULTS: PaperSettings = { approval: 'ask', limits: { maxOrderUsd: null, maxOrdersPerDay: null, maxPositionPct: null, symbols: null } };
export function getSettings(): PaperSettings {
  const s = readJson<Partial<PaperSettings>>(SETTINGS_FILE(), {});
  return { approval: s.approval === 'auto' ? 'auto' : 'ask', limits: { ...DEFAULTS.limits, ...(s.limits || {}) } };
}
const optPos = (v: unknown, name: string, max: number): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  if (!(n > 0) || n > max) throw new Error(`${name} must be a number above 0 and at most ${max}, or empty for no limit`);
  return n;
};
export function setSettings(raw: Record<string, any>): PaperSettings {
  const cur = getSettings();
  const approval = raw.approval === undefined ? cur.approval : raw.approval;
  if (approval !== 'ask' && approval !== 'auto') throw new Error('Approval must be ask or auto');
  const l = raw.limits === undefined ? cur.limits : raw.limits || {};
  const symbols: string[] | null = l.symbols == null || l.symbols === '' ? null
    : (Array.isArray(l.symbols) ? l.symbols : String(l.symbols).split(/[\s,]+/)).map((x: unknown) => toAlpacaSymbol(x));
  const next: PaperSettings = {
    approval,
    limits: {
      maxOrderUsd: optPos(l.maxOrderUsd, 'Maximum order value', 1e9),
      maxOrdersPerDay: l.maxOrdersPerDay == null || l.maxOrdersPerDay === '' ? null : Math.floor(optPos(l.maxOrdersPerDay, 'Orders per day', 1000)!),
      maxPositionPct: optPos(l.maxPositionPct, 'Maximum position weight', 100),
      symbols: symbols && symbols.length ? [...new Set(symbols)] : null,
    },
  };
  writeJson(SETTINGS_FILE(), next);
  notify('settings');
  return next;
}

// ---- order input ------------------------------------------------------------
export type Origin = 'user' | 'kestrel';
export interface OrderInput { symbol: string; side: 'buy' | 'sell'; type: 'market' | 'limit'; qty: number | null; notional: number | null; limitPrice: number | null; tif: 'day' | 'gtc' }
/** FinSight/Yahoo symbol -> Alpaca (BRK-B -> BRK.B). US listings only. */
export function toAlpacaSymbol(s: unknown): string {
  const sym = String(s || '').trim().toUpperCase().replace(/^([A-Z]{1,5})-([A-Z])$/, '$1.$2');
  if (!/^[A-Z]{1,5}(\.[A-Z])?$/.test(sym)) {
    throw new Error(`${String(s || '').toUpperCase() || 'That symbol'} can't be paper traded: Alpaca paper covers US-listed stocks and ETFs only (no exchange suffix such as .SI or .HK)`);
  }
  return sym;
}
/** Alpaca -> FinSight/Yahoo symbol (BRK.B -> BRK-B), so book quotes work. */
export const toBookSymbol = (s: string) => s.toUpperCase().replace(/\./g, '-');
const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v));
export function normalizeOrder(raw: Record<string, any>): OrderInput {
  const symbol = toAlpacaSymbol(raw.symbol);
  const side = String(raw.side || '').toLowerCase();
  if (side !== 'buy' && side !== 'sell') throw new Error('Side must be buy or sell');
  const type = String(raw.type || 'market').toLowerCase();
  if (type !== 'market' && type !== 'limit') throw new Error('Order type must be market or limit');
  const qty = num(raw.qty ?? raw.quantity), notional = num(raw.notional), limitPrice = num(raw.limitPrice ?? raw.limit_price);
  if ((qty == null) === (notional == null)) throw new Error('Give either a share quantity or a USD amount, not both');
  if (qty != null && !(qty > 0 && Number.isFinite(qty))) throw new Error('Quantity must be above 0');
  if (notional != null && !(notional >= 1 && Number.isFinite(notional))) throw new Error('A USD amount must be at least 1');
  if (notional != null && type !== 'market') throw new Error('A USD amount works with market orders only');
  if (type === 'limit' && !(limitPrice != null && limitPrice > 0 && Number.isFinite(limitPrice))) throw new Error('A limit order needs a limit price above 0');
  if (type === 'market' && limitPrice != null) throw new Error('A market order has no limit price');
  const fractional = notional != null || (qty != null && qty % 1 !== 0);
  let tif = String(raw.tif || raw.time_in_force || 'day').toLowerCase();
  if (tif !== 'day' && tif !== 'gtc') throw new Error('Time in force must be day or gtc');
  if (fractional && tif !== 'day') throw new Error('Fractional and USD-amount orders must be day orders');
  return { symbol, side, type, qty, notional, limitPrice, tif: tif as 'day' | 'gtc' };
}
const toAlpaca = (o: OrderInput, clientOrderId: string) => ({
  symbol: o.symbol, side: o.side, type: o.type, time_in_force: o.tif, client_order_id: clientOrderId,
  ...(o.qty != null ? { qty: String(o.qty) } : { notional: String(o.notional) }),
  ...(o.limitPrice != null ? { limit_price: String(o.limitPrice) } : {}),
});

// ---- order records (origin, tickets) ------------------------------------------
export interface OrderMeta { origin: Origin; threadId?: string; at: number; ticketId?: string }
export type TicketStatus = 'pending' | 'approving' | 'approved' | 'rejected' | 'failed';
export interface Ticket { id: string; status: TicketStatus; order: OrderInput; origin: 'kestrel'; threadId?: string; note?: string; createdAt: number; decidedAt?: number; orderId?: string; error?: string; estimate?: Estimate }
interface OrdersFile { meta: Record<string, OrderMeta>; tickets: Ticket[] }
const readOrders = (): OrdersFile => { const j = readJson<Partial<OrdersFile>>(ORDERS_FILE(), {}); return { meta: j.meta || {}, tickets: Array.isArray(j.tickets) ? j.tickets : [] }; };
let ordersLock: Promise<unknown> = Promise.resolve();
function withOrders<T>(fn: (f: OrdersFile) => T | Promise<T>): Promise<T> {
  const r = ordersLock.then(async () => { const f = readOrders(); const out = await fn(f); f.tickets = f.tickets.slice(-200); writeJson(ORDERS_FILE(), f); return out; });
  ordersLock = r.catch(() => {});
  return r;
}

// ---- Kestrel limits (deterministic, before anything reaches Alpaca) ----------
export interface Estimate { price: number | null; priceSource: string; valueUsd: number | null }
async function estimate(o: OrderInput): Promise<Estimate> {
  if (o.notional != null) return { price: null, priceSource: 'USD amount', valueUsd: o.notional };
  if (o.limitPrice != null) return { price: o.limitPrice, priceSource: 'limit price', valueUsd: o.qty! * o.limitPrice };
  try { const q = await getQuote(toBookSymbol(o.symbol)); return { price: q.price ?? null, priceSource: 'last quote (Yahoo)', valueUsd: q.price ? o.qty! * q.price : null }; }
  catch { return { price: null, priceSource: 'no quote', valueUsd: null }; }
}
const startOfToday = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d.getTime(); };
/** The first limit the order breaks, or null. Applies to Kestrel's orders. */
export async function limitBreach(o: OrderInput, s: PaperSettings, est: Estimate, ctx: { kestrelOrdersToday: number; equity?: number; positionValue?: number | null }): Promise<string | null> {
  const l = s.limits;
  if (l.symbols && !l.symbols.includes(o.symbol)) return `${o.symbol} is not in your allowed symbols (${l.symbols.join(', ')})`;
  if (l.maxOrdersPerDay != null && ctx.kestrelOrdersToday >= l.maxOrdersPerDay) return `Kestrel has already placed ${ctx.kestrelOrdersToday} paper orders today; your limit is ${l.maxOrdersPerDay}`;
  if (l.maxOrderUsd != null) {
    if (est.valueUsd == null) return `Can't check your US$${l.maxOrderUsd} order limit: no price for ${o.symbol}. Use a limit order or a USD amount`;
    if (est.valueUsd > l.maxOrderUsd + 1e-9) return `Order value about US$${est.valueUsd.toFixed(2)} (${est.priceSource}) is above your US$${l.maxOrderUsd} limit`;
  }
  if (l.maxPositionPct != null && o.side === 'buy') {
    if (est.valueUsd == null || !ctx.equity || ctx.positionValue === null) return `Can't check your ${l.maxPositionPct}% position limit: no price or account equity`;
    const after = ((ctx.positionValue || 0) + est.valueUsd) / ctx.equity * 100;
    if (after > l.maxPositionPct + 1e-9) return `${o.symbol} would be about ${after.toFixed(1)}% of paper equity after this order; your limit is ${l.maxPositionPct}%`;
  }
  return null;
}

// ---- placing orders -------------------------------------------------------------
const clientId = (origin: Origin) => `fs-${origin === 'kestrel' ? 'k' : 'u'}-${crypto.randomBytes(9).toString('base64url')}`;
async function submit(o: OrderInput, meta: Omit<OrderMeta, 'at'>) {
  const cid = clientId(meta.origin);
  await withOrders((f) => { f.meta[cid] = { ...meta, at: Date.now() }; });
  try {
    const order = await alpaca.placeOrder(toAlpaca(o, cid));
    notify('order', { orderId: order.id, origin: meta.origin });
    scheduleSync();
    return order;
  } catch (e) {
    await withOrders((f) => { delete f.meta[cid]; });
    throw e;
  }
}
export async function placeUserOrder(raw: Record<string, any>) {
  return { placed: true, order: await submit(normalizeOrder(raw), { origin: 'user' }) };
}
/** USD still committed by open buys of one symbol, or null when one can't be priced. */
async function openBuyValue(open: alpaca.AlpacaOrder[]): Promise<number | null> {
  let total = 0, quoted: number | null | undefined;
  for (const x of open) {
    const filled = Number(x.filled_qty || 0);
    if (x.notional != null) { total += Math.max(0, Number(x.notional) - filled * Number(x.filled_avg_price || 0)); continue; }
    if (x.limit_price == null && quoted === undefined) {
      try { quoted = (await getQuote(toBookSymbol(x.symbol))).price ?? null; } catch { quoted = null; }
    }
    const price = x.limit_price != null ? Number(x.limit_price) : quoted, left = Number(x.qty) - filled;
    if (!price || !(price > 0) || !Number.isFinite(left)) return null;
    total += Math.max(0, left) * price;
  }
  return Number.isFinite(total) ? total : null;
}
async function kestrelContext(o: OrderInput) {
  const f = readOrders(), today = startOfToday();
  const kestrelOrdersToday = Object.values(f.meta).filter((m) => m.origin === 'kestrel' && m.at >= today).length;
  const s = getSettings();
  if (s.limits.maxPositionPct == null) return { kestrelOrdersToday };
  // Open orders first: a fill between the reads is then counted twice, never missed.
  const open = (await alpaca.orders('open', 500)).filter((x) => x.symbol === o.symbol && x.side === 'buy');
  const [acct, pos] = await Promise.all([alpaca.account(), alpaca.positions()]);
  const p = pos.find((x) => x.symbol === o.symbol);
  const held = p ? Math.abs(Number(p.market_value)) : 0, resting = await openBuyValue(open);
  return { kestrelOrdersToday, equity: Number(acct.equity), positionValue: resting === null || !Number.isFinite(held) ? null : held + resting };
}
// Every Kestrel order, automatic or approved, passes one gate, one at a time,
// so concurrent calls cannot both pass the daily-count and position checks
// before either is recorded.
let kestrelQueue: Promise<unknown> = Promise.resolve();
function inKestrelGate<T>(fn: () => Promise<T>): Promise<T> {
  const r = kestrelQueue.then(fn);
  kestrelQueue = r.catch(() => {});
  return r;
}
async function checkKestrelLimits(o: OrderInput) {
  const s = getSettings(), est = await estimate(o);
  return { s, est, breach: await limitBreach(o, s, est, await kestrelContext(o)) };
}
/** Kestrel's order: limits first, then a ticket (ask) or straight to Alpaca (auto). */
export function placeKestrelOrder(raw: Record<string, any>, threadId?: string) {
  return inKestrelGate(() => placeKestrelOrderNow(raw, threadId));
}
async function placeKestrelOrderNow(raw: Record<string, any>, threadId?: string) {
  const o = normalizeOrder(raw);
  const { s, est, breach } = await checkKestrelLimits(o);
  if (breach) return { placed: false, refused: true, reason: breach, approval: s.approval, limits: s.limits };
  const note = raw.note ? String(raw.note).slice(0, 500) : undefined;
  if (s.approval === 'ask') {
    const t: Ticket = { id: 'tk' + crypto.randomBytes(6).toString('hex'), status: 'pending', order: o, origin: 'kestrel', threadId, note, createdAt: Date.now(), estimate: est };
    await withOrders((f) => { f.tickets.push(t); });
    notify('tickets', { ticketId: t.id });
    return { placed: false, pendingApproval: true, ticket: t, message: 'Waiting for the user to approve or reject this paper order in the terminal.' };
  }
  const order = await submit(o, { origin: 'kestrel', threadId });
  return { placed: true, order, approval: 'auto' };
}
export async function decideTicket(id: unknown, approve: boolean) {
  // Claim the ticket inside the orders lock: a double click or a second tab
  // must not send the same order twice.
  const t = await withOrders((f) => {
    const x = f.tickets.find((y) => y.id === id);
    if (!x) throw new Error('No such ticket');
    if (x.status !== 'pending') throw new Error(`This ticket was already ${x.status}`);
    Object.assign(x, { status: approve ? 'approving' : 'rejected', decidedAt: Date.now() });
    return { ...x };
  });
  if (!approve) {
    notify('tickets', { ticketId: id });
    return { ticketId: id, status: 'rejected' as const };
  }
  // Approval allows this order; it doesn't lift the user's limits, which are
  // re-read here because they, the price and the account may have moved.
  return inKestrelGate(async () => {
    let breach: string | null;
    try { breach = (await checkKestrelLimits(t.order)).breach; }
    catch (e) { breach = `Can't check your limits right now: ${String((e as Error).message || e).slice(0, 200)}`; }
    if (breach) {
      const error = breach;
      await withOrders((f) => { const x = f.tickets.find((y) => y.id === id); if (x) { Object.assign(x, { status: 'pending', error }); delete x.decidedAt; } });
      notify('tickets', { ticketId: id });
      throw new Error(`Not sent: ${error}. The ticket is still waiting.`);
    }
    try {
      const order = await submit(t.order, { origin: 'kestrel', threadId: t.threadId, ticketId: t.id });
      await withOrders((f) => { const x = f.tickets.find((y) => y.id === id); if (x) { Object.assign(x, { status: 'approved', decidedAt: Date.now(), orderId: order.id }); delete x.error; } });
      notify('tickets', { ticketId: id });
      return { ticketId: id, status: 'approved' as const, order };
    } catch (e) {
      const error = String((e as Error).message || e).slice(0, 300);
      await withOrders((f) => { const x = f.tickets.find((y) => y.id === id); if (x) Object.assign(x, { status: 'failed', decidedAt: Date.now(), error }); });
      notify('tickets', { ticketId: id });
      throw e;
    }
  });
}
export async function cancelOrder(id: unknown, by: Origin = 'user') {
  const oid = String(id || '');
  if (!/^[A-Za-z0-9-]{8,64}$/.test(oid)) throw new Error('Unknown order id');
  // In ask mode Kestrel may cancel only the orders it placed; the user's own
  // orders are cancelled by the user. In auto mode it may cancel any.
  if (by === 'kestrel' && getSettings().approval === 'ask') {
    const o = await alpaca.getOrder(oid), meta = readOrders().meta[o.client_order_id];
    if (meta?.origin !== 'kestrel') return { cancelled: null, refused: true, reason: 'This order was not placed by Kestrel. With approval set to ask, only the user can cancel it in the terminal.' };
  }
  await alpaca.cancelOrder(oid);
  notify('order', { orderId: oid });
  scheduleSync();
  return { cancelled: oid };
}

// ---- the PAPER book: replay Alpaca fills ----------------------------------------
interface SyncState { accountNumber: string | null; applied: string[]; skipped: { id: string; symbol: string; side: string; qty: number; reason: string }[]; syncedAt: number | null; error: string | null; drift: string[] }
const readSync = (): SyncState => ({ accountNumber: null, applied: [], skipped: [], syncedAt: null, error: null, drift: [], ...readJson<Partial<SyncState>>(SYNC_FILE(), {}) });

async function resetBook() {
  await withBook('paper', () => withLock(() => {
    const p = loadPortfolio();
    const acc = p.accounts[0]!;
    Object.assign(acc, { name: 'Alpaca Paper', type: 'Paper', positions: [], transactions: [], dividends: [], cash: {} });
    p.accounts = [acc]; p.activeId = acc.id;
    savePortfolio(p);
  }));
  try { fs.unlinkSync(path.join(dir(), 'undo.json')); } catch { /* none */ }
}
async function heldQty(symbol: string): Promise<number> {
  return withBook('paper', () => { const p = loadPortfolio(); return p.accounts[0]!.positions.find((x) => x.symbol === symbol)?.quantity ?? 0; });
}
async function replay(fills: alpaca.AlpacaFill[], st: SyncState) {
  const done = new Set(st.applied);
  for (const f of fills) {
    if (done.has(f.id)) continue;
    const symbol = toBookSymbol(f.symbol), qty = Number(f.qty), price = Number(f.price), t = Date.parse(f.transaction_time);
    if (!(qty > 0) || !(price > 0)) { st.skipped.push({ id: f.id, symbol, side: f.side, qty, reason: 'fill without quantity or price' }); }
    else if (f.side === 'buy') await withBook('paper', () => buy(symbol, qty, price, t, undefined, 'SGD'));
    else if (f.side === 'sell') {
      const held = await heldQty(symbol);
      if (held + 1e-9 < qty) st.skipped.push({ id: f.id, symbol, side: f.side, qty, reason: `sell of ${qty} with ${held} held (short sales are not mirrored)` });
      else await withBook('paper', () => sell(symbol, qty, price, undefined, 'SGD', t));
    } else st.skipped.push({ id: f.id, symbol, side: f.side, qty, reason: `${f.side} is not mirrored in the book` });
    st.applied.push(f.id); done.add(f.id);
  }
}
async function compare(): Promise<string[]> {
  const pos = await alpaca.positions();
  const book = await withBook('paper', () => loadPortfolio().accounts[0]!.positions);
  const drift: string[] = [];
  const syms = new Set([...pos.filter((p) => p.side === 'long').map((p) => toBookSymbol(p.symbol)), ...book.map((p) => p.symbol)]);
  for (const s of syms) {
    const a = Number(pos.find((p) => toBookSymbol(p.symbol) === s && p.side === 'long')?.qty || 0), b = book.find((p) => p.symbol === s)?.quantity || 0;
    if (Math.abs(a - b) > 1e-6) drift.push(`${s}: Alpaca ${a}, book ${b}`);
  }
  return drift;
}
async function syncOnce() {
  const st = readSync();
  try {
    const acct = await alpaca.account();
    if (st.accountNumber !== acct.account_number) { // first sync, or the paper account was reset
      await resetBook();
      Object.assign(st, { accountNumber: acct.account_number, applied: [], skipped: [], drift: [] });
    }
    await replay(await alpaca.fills(), st);
    await withBook('paper', () => setCash('USD', Number(acct.cash)));
    st.drift = await compare();
    if (st.drift.length && st.applied.length) { // rebuild once from scratch, then report what still differs
      await resetBook();
      Object.assign(st, { applied: [], skipped: [] });
      await replay(await alpaca.fills(), st);
      await withBook('paper', () => setCash('USD', Number(acct.cash)));
      st.drift = await compare();
    }
    await withBook('paper', () => withLock(() => { const p = loadPortfolio(); p.accounts[0]!.positions.forEach(recalcPosition); savePortfolio(p); }));
    Object.assign(st, { syncedAt: Date.now(), error: null });
  } catch (e) {
    st.error = String((e as Error).message || e).slice(0, 300);
  }
  writeJson(SYNC_FILE(), st);
  notify('book', { error: st.error });
  return st;
}
let syncing: Promise<SyncState> | null = null, again = false, timer: NodeJS.Timeout | null = null;
export function sync(): Promise<SyncState> {
  if (syncing) { again = true; return syncing; }
  syncing = syncOnce().finally(() => { syncing = null; if (again) { again = false; void sync(); } });
  return syncing;
}
/** Coalesce bursts (a fill arrives as several stream events). */
export function scheduleSync(ms = 400): void {
  if (!alpaca.loadKeys()) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { timer = null; void sync(); }, ms);
  timer.unref();
}

// ---- state for the terminal and Kestrel -------------------------------------------
const view = (o: alpaca.AlpacaOrder, meta: Record<string, OrderMeta>) => ({
  id: o.id, symbol: o.symbol, side: o.side, type: o.type, tif: o.time_in_force, qty: num(o.qty), notional: num(o.notional), limitPrice: num(o.limit_price),
  filledQty: num(o.filled_qty), filledAvgPrice: num(o.filled_avg_price), status: o.status, createdAt: o.created_at, filledAt: o.filled_at,
  origin: meta[o.client_order_id]?.origin ?? 'alpaca', threadId: meta[o.client_order_id]?.threadId ?? null,
});
export async function paperState() {
  const keySource = alpaca.keySource(), settings = getSettings(), f = readOrders(), st = readSync();
  const base = { connected: !!keySource, keySource, settings, tickets: f.tickets.slice(-50).reverse(), stream: stream.streamStatus(), sync: { syncedAt: st.syncedAt, error: st.error, skipped: st.skipped.slice(-20), drift: st.drift } };
  if (!keySource) return { ...base, account: null, positions: [], openOrders: [], recentOrders: [] };
  try {
    const [acct, pos, ords] = await Promise.all([alpaca.account(), alpaca.positions(), alpaca.orders('all', 50)]);
    const orders = ords.map((o) => view(o, f.meta));
    const open = new Set(['new', 'accepted', 'pending_new', 'partially_filled', 'held', 'accepted_for_bidding', 'pending_cancel', 'pending_replace', 'calculated']);
    return {
      ...base, retrievedAt: new Date().toISOString(), source: 'Alpaca paper API',
      account: { number: acct.account_number, status: acct.status, currency: acct.currency, cash: Number(acct.cash), equity: Number(acct.equity), buyingPower: Number(acct.buying_power), lastEquity: acct.last_equity != null ? Number(acct.last_equity) : null },
      positions: pos.map((p) => ({ symbol: p.symbol, bookSymbol: toBookSymbol(p.symbol), qty: Number(p.qty), side: p.side, avgEntryPrice: Number(p.avg_entry_price), currentPrice: Number(p.current_price), marketValue: Number(p.market_value), unrealizedPl: Number(p.unrealized_pl) })),
      openOrders: orders.filter((o) => open.has(o.status)),
      recentOrders: orders.filter((o) => !open.has(o.status)).slice(0, 25),
    };
  } catch (e) {
    return { ...base, account: null, positions: [], openOrders: [], recentOrders: [], error: String((e as Error).message || e).slice(0, 300) };
  }
}

// ---- connection lifecycle ------------------------------------------------------------
stream.events.on('trade_update', (u: stream.TradeUpdate) => { notify('order', { event: u.event, orderId: u.order.id, symbol: u.order.symbol }); if (/fill|cancel|expired|rejected/.test(u.event)) scheduleSync(150); });
stream.events.on('status', (s: stream.StreamStatus) => notify('stream', { stream: s }));
export async function connect(keyId: unknown, secret: unknown) {
  const acct = await alpaca.connect(keyId, secret);
  stream.restart();
  await sync();
  return { connected: true, accountNumber: acct.account_number };
}
export function disconnect() { alpaca.disconnect(); stream.stop(); notify('stream'); return { connected: false }; }
/** Server start: stream and a first sync when keys exist; a slow poll as a backstop. */
export function startPaper(): void {
  if (!alpaca.loadKeys()) return;
  stream.start();
  void sync();
  setInterval(() => { if (alpaca.loadKeys()) void sync(); }, 5 * 60_000).unref();
}
