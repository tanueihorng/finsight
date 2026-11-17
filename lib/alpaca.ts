// Alpaca PAPER trading client (FEAT-012). Paper only: the base URL is a
// constant and there is no live-trading URL anywhere in FinSight. Tests and the
// offline fake (lib/fakealpaca.ts) may point it at a loopback host only.
// Keys stay on the server (DATA_DIR/alpaca-paper.json, 0600, or env) and are
// never returned to the browser or the agent.
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './config.ts';

export const PAPER_URL = 'https://paper-api.alpaca.markets';
export const PAPER_STREAM_URL = 'wss://paper-api.alpaca.markets/stream';
const KEYS_FILE = path.join(DATA_DIR, 'alpaca-paper.json');

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
/** Base URL: the paper constant, or a loopback override (tests). */
export function baseUrl(): string {
  const o = process.env.ALPACA_PAPER_URL;
  if (!o) return PAPER_URL;
  const u = new URL(o);
  if (!LOOPBACK.has(u.hostname)) throw new Error('ALPACA_PAPER_URL may only point at a loopback test server');
  return u.origin;
}

export interface Keys { keyId: string; secret: string }
export function loadKeys(): Keys | null {
  const e = { keyId: process.env.ALPACA_PAPER_KEY_ID || '', secret: process.env.ALPACA_PAPER_SECRET_KEY || '' };
  if (e.keyId && e.secret) return e;
  try {
    const j = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));
    return typeof j.keyId === 'string' && typeof j.secret === 'string' && j.keyId && j.secret ? { keyId: j.keyId, secret: j.secret } : null;
  } catch { return null; }
}
export const keySource = (): 'env' | 'file' | null =>
  process.env.ALPACA_PAPER_KEY_ID && process.env.ALPACA_PAPER_SECRET_KEY ? 'env' : loadKeys() ? 'file' : null;

/** Alpaca issues paper key ids starting PK and live ones starting AK. */
export function checkKeyShape(keyId: unknown, secret: unknown): Keys {
  const k = String(keyId || '').trim(), s = String(secret || '').trim();
  if (/^AK/i.test(k)) throw new Error('That is a live-trading key (it starts with AK). FinSight only accepts Alpaca paper keys, which start with PK.');
  if (!/^PK[A-Z0-9]{8,40}$/i.test(k)) throw new Error('An Alpaca paper key id starts with PK followed by letters and digits');
  if (!/^[A-Za-z0-9/+=]{20,80}$/.test(s)) throw new Error('That does not look like an Alpaca secret key');
  return { keyId: k, secret: s };
}

export class AlpacaError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

async function call<T>(keys: Keys, method: string, pathname: string, body?: unknown): Promise<T> {
  const res = await fetch(baseUrl() + pathname, {
    method,
    headers: { 'APCA-API-KEY-ID': keys.keyId, 'APCA-API-SECRET-KEY': keys.secret, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const text = await res.text();
  let j: any = null; // Alpaca's JSON, validated by the callers
  try { j = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) {
    const msg = (j && (j.message || j.error)) || text.slice(0, 200) || res.statusText;
    if (res.status === 401 || res.status === 403) throw new AlpacaError(res.status, `Alpaca paper rejected the keys (${res.status}): ${msg}`);
    throw new AlpacaError(res.status, `Alpaca ${method} ${pathname.split('?')[0]} failed (${res.status}): ${msg}`);
  }
  return j as T;
}

function requireKeys(): Keys {
  const k = loadKeys();
  if (!k) throw new AlpacaError(409, 'Alpaca paper is not connected. Add your paper API keys in PAPER mode.');
  return k;
}

// ---- wire shapes (the fields FinSight uses) ----
export interface AlpacaAccount { id: string; account_number: string; status: string; currency: string; cash: string; equity: string; buying_power: string; last_equity?: string }
export interface AlpacaPosition { symbol: string; qty: string; side: string; avg_entry_price: string; market_value: string; current_price: string; unrealized_pl: string; asset_class?: string }
export interface AlpacaOrder {
  id: string; client_order_id: string; symbol: string; side: 'buy' | 'sell'; type: string; time_in_force: string;
  qty: string | null; notional: string | null; limit_price: string | null; filled_qty: string; filled_avg_price: string | null;
  status: string; created_at: string; submitted_at?: string; filled_at: string | null; canceled_at?: string | null;
}
export interface AlpacaFill { id: string; activity_type: 'FILL'; transaction_time: string; type: string; price: string; qty: string; side: string; symbol: string; order_id: string }

export const account = () => call<AlpacaAccount>(requireKeys(), 'GET', '/v2/account');
export const positions = () => call<AlpacaPosition[]>(requireKeys(), 'GET', '/v2/positions');
export const orders = (status: 'open' | 'all' = 'all', limit = 100) =>
  call<AlpacaOrder[]>(requireKeys(), 'GET', `/v2/orders?status=${status}&limit=${limit}&direction=desc&nested=false`);
export const getOrder = (id: string) => call<AlpacaOrder>(requireKeys(), 'GET', `/v2/orders/${encodeURIComponent(id)}`);
export const getOrderByClientId = (id: string) =>
  call<AlpacaOrder>(requireKeys(), 'GET', `/v2/orders:by_client_order_id?client_order_id=${encodeURIComponent(id)}`);
export const placeOrder = (o: Record<string, unknown>) => call<AlpacaOrder>(requireKeys(), 'POST', '/v2/orders', o);
export const cancelOrder = (id: string) => call<null>(requireKeys(), 'DELETE', `/v2/orders/${encodeURIComponent(id)}`);

/** Every fill since the account opened, oldest first (paged, 100 per page). */
export async function fills(): Promise<AlpacaFill[]> {
  const keys = requireKeys(), out: AlpacaFill[] = [];
  let token = '';
  for (let page = 0; page < 200; page++) {
    const batch = await call<AlpacaFill[]>(keys, 'GET', `/v2/account/activities/FILL?direction=asc&page_size=100${token ? `&page_token=${encodeURIComponent(token)}` : ''}`);
    out.push(...batch);
    if (batch.length < 100) break;
    token = batch[batch.length - 1]!.id;
  }
  return out;
}

/** Verify keys against the paper endpoint, then store them (0600). */
export async function connect(keyId: unknown, secret: unknown): Promise<AlpacaAccount> {
  const keys = checkKeyShape(keyId, secret);
  const acct = await call<AlpacaAccount>(keys, 'GET', '/v2/account');
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${KEYS_FILE}.tmp.${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify({ ...keys, connectedAt: Date.now(), accountNumber: acct.account_number }, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, KEYS_FILE);
  return acct;
}
export function disconnect(): void { try { fs.unlinkSync(KEYS_FILE); } catch { /* already gone */ } }
