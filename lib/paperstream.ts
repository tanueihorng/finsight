// Alpaca paper trade_updates stream (FEAT-012). Node's built-in WebSocket, no
// dependency. Protocol as in Alpaca's official SDK (alpaca-trade-api v5,
// streaming/tradingStream.ts): send {action:"authenticate", data:{key_id,
// secret_key}}, wait for stream "authorization" status "authorized", then
// {action:"listen", data:{streams:["trade_updates"]}}. The paper endpoint sends
// JSON in binary frames, so both text and binary are decoded. Reconnects with
// exponential backoff and jitter; rejected keys stop it (no retry loop).
import { EventEmitter } from 'node:events';
import { PAPER_STREAM_URL, baseUrl, loadKeys } from './alpaca.ts';

export interface TradeUpdate {
  event: string; at: string | null; price: string | null; qty: string | null; executionId: string | null; positionQty: string | null;
  order: { id: string; client_order_id: string; symbol: string; side: string; status: string; filled_qty: string; filled_avg_price: string | null };
}
export const events = new EventEmitter(); // 'trade_update' (TradeUpdate), 'status' (StreamStatus)
export type StreamStatus = { state: 'off' | 'connecting' | 'live' | 'retrying' | 'auth_failed'; message?: string; at: number };
let status: StreamStatus = { state: 'off', at: Date.now() };
const setStatus = (s: StreamStatus['state'], message?: string) => { status = { state: s, message, at: Date.now() }; events.emit('status', status); };
export const streamStatus = () => status;

/** Decode one frame (string, Buffer, ArrayBuffer or Blob text) into JSON. */
export async function decodeFrame(raw: unknown): Promise<any> {
  if (typeof raw === 'string') return JSON.parse(raw);
  if (raw instanceof ArrayBuffer) return JSON.parse(new TextDecoder().decode(raw));
  if (ArrayBuffer.isView(raw)) return JSON.parse(new TextDecoder().decode(raw as Uint8Array));
  if (raw && typeof (raw as Blob).text === 'function') return JSON.parse(await (raw as Blob).text());
  throw new TypeError('Unknown frame type');
}
const str = (v: unknown) => (v == null ? null : String(v));
/** One decoded frame -> what to do. Pure, so it is unit-tested without a socket. */
export function handleFrame(f: any): { kind: 'authorized' } | { kind: 'auth_failed'; message: string } | { kind: 'listening' } | { kind: 'update'; update: TradeUpdate } | { kind: 'error'; message: string } | { kind: 'ignore' } {
  if (!f || typeof f !== 'object') return { kind: 'ignore' };
  if (f.action === 'error' || f.stream === 'error') return { kind: 'error', message: String(f.data?.error_message ?? f.data?.error ?? 'stream error') };
  if (f.stream === 'authorization') return f.data?.status === 'authorized' ? { kind: 'authorized' } : { kind: 'auth_failed', message: String(f.data?.error_message || f.data?.status || 'unauthorized') };
  if (f.stream === 'listening') return { kind: 'listening' };
  if (f.stream === 'trade_updates' && f.data && typeof f.data.order === 'object' && f.data.order) {
    const d = f.data, o = d.order;
    return { kind: 'update', update: {
      event: String(d.event || ''), at: str(d.timestamp), price: str(d.price), qty: str(d.qty), executionId: str(d.execution_id), positionQty: str(d.position_qty),
      order: { id: String(o.id), client_order_id: String(o.client_order_id || ''), symbol: String(o.symbol || ''), side: String(o.side || ''), status: String(o.status || ''), filled_qty: String(o.filled_qty ?? '0'), filled_avg_price: str(o.filled_avg_price) },
    } };
  }
  return { kind: 'ignore' };
}
/** Reconnect delay: 1 s doubling to 60 s, ±20 % jitter. */
export const backoffMs = (attempt: number, rand = Math.random) => Math.round(Math.min(60_000, 1000 * 2 ** attempt) * (0.8 + 0.4 * rand()));

let ws: WebSocket | null = null, timer: NodeJS.Timeout | null = null, attempt = 0, wanted = false;
function streamUrl(): string {
  // A loopback ALPACA_PAPER_URL (tests) streams from the same host.
  return process.env.ALPACA_PAPER_URL ? baseUrl().replace(/^http/, 'ws') + '/stream' : PAPER_STREAM_URL;
}
export function start(): void {
  wanted = true;
  if (ws || timer) return;
  const keys = loadKeys();
  if (!keys) return setStatus('off', 'Not connected');
  // Offline fake (lib/fakealpaca.ts) emits updates on the bus directly.
  if (process.env.FINSIGHT_FAKE_MARKET === '1') return setStatus('live', 'Offline fake broker');
  if (typeof WebSocket !== 'function') return setStatus('off', 'This Node has no WebSocket; live order updates fall back to polling');
  setStatus(attempt ? 'retrying' : 'connecting');
  const sock = new WebSocket(streamUrl());
  ws = sock;
  sock.binaryType = 'arraybuffer';
  let authFailed = false;
  sock.addEventListener('open', () => sock.send(JSON.stringify({ action: 'authenticate', data: { key_id: keys.keyId, secret_key: keys.secret } })));
  sock.addEventListener('message', async (ev) => {
    let r;
    try { r = handleFrame(await decodeFrame(ev.data)); } catch { return; }
    if (r.kind === 'authorized') sock.send(JSON.stringify({ action: 'listen', data: { streams: ['trade_updates'] } }));
    else if (r.kind === 'listening') { attempt = 0; setStatus('live'); }
    else if (r.kind === 'auth_failed') { authFailed = true; setStatus('auth_failed', r.message); sock.close(); }
    else if (r.kind === 'update') events.emit('trade_update', r.update);
  });
  sock.addEventListener('close', () => {
    ws = null;
    if (!wanted || authFailed) { if (!authFailed) setStatus('off'); return; }
    const wait = backoffMs(attempt++);
    setStatus('retrying', `Reconnecting in ${Math.round(wait / 1000)}s`);
    timer = setTimeout(() => { timer = null; start(); }, wait);
    timer.unref();
  });
  sock.addEventListener('error', () => { /* close follows */ });
}
export function stop(): void {
  wanted = false;
  if (timer) { clearTimeout(timer); timer = null; }
  if (ws) { try { ws.close(); } catch { /* closing */ } ws = null; }
  attempt = 0;
  setStatus('off');
}
export function restart(): void { stop(); start(); }
