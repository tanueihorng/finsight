// Agent HTTP API (loopback only). Reached exclusively through FinSight's
// /api/agent/* proxy, which adds the shared proxy secret. Requests are
// rejected unless: Host is this loopback port (anti DNS-rebinding), no
// browser Origin is present (no direct browser access), and the secret matches.
import http from 'node:http';
import crypto from 'node:crypto';
import type { Config } from '../config.ts';
import type { DB } from '../store/db.ts';
import * as store from '../store/db.ts';
import type { ChatEngine } from '../chat/engine.ts';
import type { EventBus } from '../chat/bus.ts';
import type { BrainEntry } from '../brains/registry.ts';
import type { ToolRegistry, ToolCtx } from '../tools/registry.ts';
import type { FinsightClient } from '../tools/finsight.ts';
import { readAgentLink } from '../tools/finsight.ts';
import { AgentError } from '../types.ts';
import { log } from '../log.ts';
import { audit } from '../obs/audit.ts';
import { z } from 'zod';
import type { Skill } from '../skills.ts';
import { saveUpload, MAX_UPLOAD_BYTES } from '../uploads.ts';
import { getAudit } from '../obs/audit.ts';

export type ApiDeps = { cfg: Config; db: DB; engine: ChatEngine; bus: EventBus; brains: Map<string, BrainEntry>; brainsInvalid: { id: string; error: string }[]; tools: ToolRegistry; finsight: FinsightClient; skills?: () => Map<string, Skill> };

const Send = z.object({
  content: z.string().min(1).max(12_000), brain: z.string().max(40).optional(),
  pageContext: z.object({ view: z.string().max(40).optional(), symbol: z.string().max(24).optional(), timeframe: z.string().max(10).optional(),
    strategy: z.string().max(40).optional(), account: z.string().max(64).optional(), base: z.string().max(3).optional() }).strict().optional(),
  idempotencyKey: z.string().min(8).max(80).optional(), expectedVersion: z.number().int().min(0).optional(),
  attachmentIds: z.array(z.string().regex(/^up_[\w-]{8,40}$/)).max(5).optional(),
}).strict();
const Upload = z.object({ name: z.string().min(1).max(200), dataBase64: z.string().min(4) }).strict();
const NewThread = z.object({ title: z.string().max(120).optional(), brain: z.string().max(40).optional() }).strict();
const PatchThread = z.object({ title: z.string().min(1).max(120).optional(), archived: z.boolean().optional() }).strict();

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  const s = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(s);
}
const fail = (res: http.ServerResponse, e: unknown) => {
  if (e instanceof AgentError) return send(res, e.status, { error: { code: e.code, message: e.message, details: e.details } });
  if (e instanceof z.ZodError) return send(res, 400, { error: { code: 'BAD_INPUT', message: z.prettifyError(e) } });
  log('error', 'api.error', { error: String((e as Error)?.stack || e).slice(0, 2000) });
  return send(res, 500, { error: { code: 'INTERNAL', message: 'Internal error' } });
};

function readJson(req: http.IncomingMessage, max = 64 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (!/^application\/json\b/i.test(String(req.headers['content-type'] || ''))) return reject(new AgentError('BAD_INPUT', 'Content-Type must be application/json', 415));
    const chunks: Buffer[] = []; let size = 0;
    req.on('data', (c: Buffer) => { size += c.length; if (size > max) { reject(new AgentError('TOO_LARGE', 'Body too large', 413)); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}); } catch { reject(new AgentError('BAD_INPUT', 'Invalid JSON')); } });
    req.on('error', reject);
  });
}

export function createApi(d: ApiDeps): http.Server {
  const allowedHosts = new Set([`127.0.0.1:${d.cfg.port}`, `localhost:${d.cfg.port}`, `[::1]:${d.cfg.port}`]);
  return http.createServer(async (req, res) => {
    const reqId = crypto.randomBytes(6).toString('hex'), t0 = Date.now();
    res.on('finish', () => audit('http', { reqId, method: req.method, path: (req.url || '').split('?')[0], status: res.statusCode, ms: Date.now() - t0 }));
    try {
      const host = String(req.headers.host || '').toLowerCase();
      if (!allowedHosts.has(host)) return send(res, 403, { error: { code: 'FORBIDDEN', message: 'Bad host' } });
      if (req.headers.origin) return send(res, 403, { error: { code: 'FORBIDDEN', message: 'Direct browser access is not allowed' } });
      const u = new URL(req.url || '/', `http://${host}`);
      const p = u.pathname;
      if (p === '/v1/health' && req.method === 'GET' && !req.headers['x-agent-secret']) return send(res, 200, { ok: true });
      const link = readAgentLink(d.cfg.finsightDataDir);
      const secret = String(req.headers['x-agent-secret'] || '');
      if (!link || !secret || !safeEqual(secret, link.proxySecret)) return send(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Missing or bad proxy secret' } });
      return await route(d, req, res, p, u);
    } catch (e) { return fail(res, e); }
  });
}

async function route(d: ApiDeps, req: http.IncomingMessage, res: http.ServerResponse, p: string, u: URL) {
  const m = req.method || 'GET';
  let mt: RegExpMatchArray | null;

  if (p === '/v1/health' && m === 'GET') {
    let finsight = 'ok';
    try { await d.finsight.get('/api/accounts', {}, AbortSignal.timeout(3000)); } catch (e) { finsight = e instanceof AgentError ? e.code : 'error'; }
    return send(res, 200, { ok: true, finsight, brains: [...d.brains.values()].filter((b) => b.available).length, time: Date.now() });
  }
  if (p === '/v1/brains' && m === 'GET') {
    return send(res, 200, { default: d.cfg.defaultBrain, brains: [...d.brains.values()].map((b) => ({
      id: b.manifest.id, label: b.manifest.label, costTier: b.manifest.costTier, transport: b.manifest.transport,
      tools: b.manifest.capabilities.tools, nativeSearch: b.manifest.capabilities.nativeSearch, available: b.available, reason: b.reason })) });
  }
  if (p === '/v1/info' && m === 'GET') return send(res, 200, { name: d.cfg.assistantName, version: '0.2.0' });
  if (p === '/v1/skills' && m === 'GET') {
    return send(res, 200, { skills: [...(d.skills?.() ?? new Map()).values()].map((s) => ({ name: s.name, description: s.description, source: s.source })) });
  }
  if (p === '/v1/uploads' && m === 'POST') {
    const b = Upload.parse(await readJson(req, Math.ceil(MAX_UPLOAD_BYTES * 1.4) + 4096));
    return send(res, 201, { upload: await saveUpload(d.cfg.home, b.name, b.dataBase64) });
  }
  if (p === '/v1/logs' && m === 'GET') {
    const a = getAudit(); if (!a) return send(res, 200, { lines: [] });
    return send(res, 200, { lines: a.read({ turnId: u.searchParams.get('turnId') || undefined, kind: u.searchParams.get('kind') || undefined, limit: Math.min(2000, Number(u.searchParams.get('limit')) || 300) }) });
  }
  if (p === '/v1/plugins' && m === 'GET') return send(res, 200, { brains: { valid: [...d.brains.keys()], invalid: d.brainsInvalid }, tools: d.tools.list().map((t) => t.name) });

  if (p === '/v1/threads' && m === 'GET') return send(res, 200, { threads: store.listThreads(d.db, u.searchParams.get('archived') === '1') });
  if (p === '/v1/threads' && m === 'POST') {
    const b = NewThread.parse(await readJson(req));
    if (b.brain && !d.brains.get(b.brain)?.available) throw new AgentError('BRAIN_UNAVAILABLE', `Model ${b.brain} is not available`);
    return send(res, 201, { thread: store.createThread(d.db, b.title || 'New chat', b.brain ?? null) });
  }
  if ((mt = p.match(/^\/v1\/threads\/(th_[\w-]{6,})$/))) {
    const id = mt[1]!;
    if (m === 'GET') {
      const t = store.getThread(d.db, id); if (!t) throw new AgentError('NOT_FOUND', 'Thread not found', 404);
      const messages = store.listMessages(d.db, id).map((x) => ({ id: x.id, seq: x.seq, role: x.role, brain: x.brain, turnId: x.turnId, createdAt: x.createdAt,
        blocks: x.blocks.filter((b) => !(b.type === 'notice' && b.kind === 'context_pack')).map((b) => (b.type === 'tool_result' ? { ...b, content: b.content.slice(0, 400) } : b)) }));
      const lastEvent = (d.db.prepare('SELECT MAX(id) v FROM events WHERE thread_id = ?').get(id) as { v: number | null }).v ?? 0;
      const citations = store.eventsAfter(d.db, id, 0, 5000).filter((e) => e.type === 'citation').map((e) => e.payload);
      return send(res, 200, { thread: t, messages, citations, runningTurn: d.engine.isRunning(id), lastEventId: lastEvent });
    }
    if (m === 'PATCH') return send(res, 200, { thread: store.updateThread(d.db, id, PatchThread.parse(await readJson(req))) });
    if (m === 'DELETE') {
      if (u.searchParams.get('confirm') !== 'true') throw new AgentError('CONFIRM_REQUIRED', 'Add ?confirm=true to delete a chat permanently');
      if (d.engine.isRunning(id)) throw new AgentError('CONFLICT', 'Stop the running reply first', 409);
      store.deleteThread(d.db, id); return send(res, 200, { ok: true });
    }
  }
  if ((mt = p.match(/^\/v1\/threads\/(th_[\w-]{6,})\/messages$/)) && m === 'POST') {
    const b = Send.parse(await readJson(req));
    const r = d.engine.send({ threadId: mt[1]!, ...b });
    return send(res, r.existing ? 200 : 202, r);
  }
  if ((mt = p.match(/^\/v1\/threads\/(th_[\w-]{6,})\/stop$/)) && m === 'POST') return send(res, 200, { stopped: d.engine.stop(mt[1]!) });
  if ((mt = p.match(/^\/v1\/threads\/(th_[\w-]{6,})\/events$/)) && m === 'GET') return sse(d, req, res, mt[1]!, u);

  if (p === '/v1/strategies' && m === 'GET') {
    const ctx: ToolCtx = { cfg: d.cfg, db: d.db, finsight: d.finsight, signal: AbortSignal.timeout(15000), budget: { searches: 0, fetches: 0 }, citations: [] };
    const r = await d.tools.execute('list_strategies', {}, ctx);
    return send(res, r.ok ? 200 : 502, JSON.parse(r.content));
  }
  if ((mt = p.match(/^\/v1\/turns\/(turn_[\w-]{6,})\/trace$/)) && m === 'GET') return send(res, 200, { steps: store.getTrace(d.db, mt[1]!) });
  if (p === '/v1/cost' && m === 'GET') {
    const period = u.searchParams.get('period') === 'month' ? 'month' : 'day';
    const since = period === 'day' ? store.startOfToday() : (() => { const x = new Date(); x.setDate(1); x.setHours(0, 0, 0, 0); return x.getTime(); })();
    return send(res, 200, { period, since, totalUsd: store.spendSince(d.db, since), capUsdPerDay: d.cfg.limits.dayUsd, rows: store.spendReport(d.db, since) });
  }
  if (p === '/v1/proposals' && m === 'GET') return send(res, 200, { proposals: store.listProposals(d.db, u.searchParams.get('status') || 'pending') });
  if ((mt = p.match(/^\/v1\/proposals\/(prop_[\w-]{6,})\/(accept|reject)$/)) && m === 'POST') {
    // Recording the user's decision only; applying it to records is a later, separate feature.
    return send(res, 200, { ok: store.decideProposal(d.db, mt[1]!, mt[2] === 'accept' ? 'accepted' : 'rejected') });
  }
  throw new AgentError('NOT_FOUND', 'Unknown endpoint', 404);
}

function sse(d: ApiDeps, req: http.IncomingMessage, res: http.ServerResponse, threadId: string, u: URL) {
  if (!store.getThread(d.db, threadId)) throw new AgentError('NOT_FOUND', 'Thread not found', 404);
  const after = Number(req.headers['last-event-id'] || u.searchParams.get('after') || 0) || 0;
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write('retry: 2000\n\n');
  const write = (e: store.Evt) => res.write(`id: ${e.id}\nevent: ${e.type}\ndata: ${JSON.stringify(e.payload)}\n\n`);
  let last = after;
  // Subscribe first, then replay, de-duplicating by id: no event can fall in the gap.
  const queue: store.Evt[] = []; let replaying = true;
  const unsub = d.bus.subscribe(threadId, (e) => { if (replaying) queue.push(e); else if (e.id > last) { last = e.id; write(e); } });
  for (const e of store.eventsAfter(d.db, threadId, after)) { last = e.id; write(e); }
  replaying = false;
  for (const e of queue) if (e.id > last) { last = e.id; write(e); }
  const hb = setInterval(() => res.write(': hb\n\n'), 15_000);
  req.on('close', () => { clearInterval(hb); unsub(); });
}
