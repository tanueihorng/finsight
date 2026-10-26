// Link to the optional local agent service (a separate, private program).
//  - agent-link.json in DATA_DIR holds two random secrets (0600):
//      token        lets the agent READ a fixed allowlist of GET endpoints
//                   (no PIN session; any other method or path is refused)
//      proxySecret  FinSight adds it when proxying the chat panel's
//                   /api/agent/* calls to the agent, which rejects calls
//                   without it.
//  - proxy() forwards /api/agent/* to the agent (loopback), behind the normal
//    PIN session gate, with a same-origin check for writes. SSE streams through.
// No personal data or keys live in this file or in the repo.
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http';
import crypto from 'node:crypto';
import { DATA_DIR } from './config.ts';

/** DATA_DIR/agent-link.json */
export interface AgentLink { token: string; proxySecret: string; createdAt: number }

export const LINK_FILE = path.join(DATA_DIR, 'agent-link.json');
const AGENT_URL = new URL(process.env.AGENT_URL || 'http://127.0.0.1:8100');

// Read-only endpoints the agent token may call. Exact paths only.
export const TOKEN_READ_PATHS = new Set([
  '/api/portfolio', '/api/accounts', '/api/quote', '/api/history', '/api/history/batch', '/api/categories',
  '/api/events', '/api/dividends', '/api/realized', '/api/portfolio/performance', '/api/fx-risk', '/api/ledger',
  '/api/watchlist', '/api/alerts', '/api/news', '/api/fred', '/api/journal', '/api/calendar', '/api/markets', '/api/search',
]);

let cached: AgentLink | null = null;
export function ensureLink(): AgentLink {
  if (cached) return cached;
  try {
    const j = JSON.parse(fs.readFileSync(LINK_FILE, 'utf8'));
    if (typeof j.token === 'string' && j.token.length >= 32 && typeof j.proxySecret === 'string' && j.proxySecret.length >= 32) { cached = j; return j; }
  } catch { /* create below */ }
  return rotate();
}
export function rotate(): AgentLink {
  const j: AgentLink = { token: crypto.randomBytes(32).toString('base64url'), proxySecret: crypto.randomBytes(32).toString('base64url'), createdAt: Date.now() };
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = `${LINK_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(j, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, LINK_FILE); // atomic replace
  cached = j;
  return j;
}

function safeEqual(a: unknown, b: unknown): boolean {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/** 'none' (no bearer token), 'ok' (valid token, allowed GET), 'deny' (token present but not allowed). */
export function tokenCheck(req: IncomingMessage, pathname: string): 'none' | 'ok' | 'deny' {
  const h = String(req.headers.authorization || '');
  if (!h.startsWith('Bearer ')) return 'none';
  const { token } = ensureLink();
  if (!safeEqual(h.slice(7).trim(), token)) return 'deny';
  return req.method === 'GET' && TOKEN_READ_PATHS.has(pathname) ? 'ok' : 'deny';
}

function sameOrigin(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return req.method === 'GET'; // writes must carry Origin (browsers always send it on fetch POST)
  try { return new URL(origin).host === String(req.headers.host || ''); } catch { return false; }
}

const MAX_BODY = 64 * 1024;
const MAX_UPLOAD_BODY = 22 * 1024 * 1024; // 15 MB file, base64-encoded

export function proxy(req: IncomingMessage, res: ServerResponse, pathname: string, search: string): void {
  if (!sameOrigin(req)) { res.writeHead(403, { 'Content-Type': 'application/json' }); return void res.end(JSON.stringify({ error: 'Cross-origin request refused' })); }
  if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(req.method!)) { res.writeHead(405); return void res.end(); }
  const target = '/v1/' + pathname.slice('/api/agent/'.length) + (search || '');
  const headers: OutgoingHttpHeaders = { 'x-agent-secret': ensureLink().proxySecret, host: AGENT_URL.host, accept: req.headers.accept || 'application/json' };
  if (req.headers['content-type']) headers['content-type'] = req.headers['content-type'];
  if (req.headers['last-event-id']) headers['last-event-id'] = req.headers['last-event-id'];
  const upstream = http.request({ hostname: AGENT_URL.hostname, port: AGENT_URL.port, method: req.method, path: target, headers, timeout: 0 }, (up) => {
    const out: Record<string, string> = { 'Content-Type': up.headers['content-type'] || 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
    if (/event-stream/.test(out['Content-Type']!)) { out.Connection = 'keep-alive'; out['X-Accel-Buffering'] = 'no'; }
    res.writeHead(up.statusCode || 502, out);
    if (res.flushHeaders) res.flushHeaders();
    // IncomingMessage can abort after headers, without a ClientRequest error.
    // Close the browser stream so EventSource can reconnect with Last-Event-ID.
    const finish = () => { if (!res.writableEnded && !res.destroyed) res.end(); };
    up.on('aborted', finish);
    up.on('error', finish);
    up.on('close', finish);
    up.pipe(res);
  });
  upstream.on('error', () => {
    if (res.headersSent) return void res.end();
    res.writeHead(503, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { code: 'AGENT_OFFLINE', message: 'The agent is not running. Start it with: cd agent && npm start' } }));
  });
  res.on('close', () => upstream.destroy()); // response done or browser went away: release the upstream (stops SSE)
  let size = 0;
  const limit = pathname === '/api/agent/uploads' ? MAX_UPLOAD_BODY : pathname === '/api/agent/threads/delete-all' ? 4 * 1024 * 1024 : MAX_BODY;
  req.on('data', (c: Buffer) => { size += c.length; if (size > limit) { upstream.destroy(); if (!res.headersSent) { res.writeHead(413); res.end(); } } else upstream.write(c); });
  req.on('end', () => upstream.end());
}
