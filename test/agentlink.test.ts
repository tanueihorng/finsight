// Agent link: GET-only token allowlist, session-gated proxy with origin check,
// SSE passthrough and the offline response. Runs a real server.ts in a child
// process with an isolated data dir and a fake agent; no network needed.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import type { AddressInfo } from 'node:net';

interface Hit { method?: string; url?: string; secret?: string | string[]; origin?: string; host?: string }
interface Res { status: number; headers: http.IncomingHttpHeaders; body: string }

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'finsight-agentlink-'));
let fsPort: number, agentPort: number, child: ChildProcess, agent: http.Server, agentHits: Hit[] = [];

function freePort(): Promise<number> { return new Promise((r) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as AddressInfo).port; s.close(() => r(p)); }); }); }
function req(port: number, method: string, p: string, headers: Record<string, string> = {}, body?: string): Promise<Res> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      let b = ''; res.on('data', (c: Buffer) => (b += c)); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: b }));
    });
    r.on('error', reject); if (body) r.write(body); r.end();
  });
}

before(async () => {
  fsPort = await freePort(); agentPort = await freePort();
  agent = http.createServer((q, s) => {
    agentHits.push({ method: q.method, url: q.url, secret: q.headers['x-agent-secret'], origin: q.headers.origin, host: q.headers.host });
    if (q.url === '/v1/threads/th_cut/events') { s.writeHead(200, { 'Content-Type': 'text/event-stream' }); s.write('id: 1\ndata: partial\n\n'); setTimeout(() => s.destroy(), 50); return; }
    if (q.url!.startsWith('/v1/threads/th_x/events')) { s.writeHead(200, { 'Content-Type': 'text/event-stream' }); s.write('id: 1\nevent: turn.started\ndata: {}\n\n'); setTimeout(() => s.end('id: 2\nevent: turn.finished\ndata: {}\n\n'), 50); return; }
    s.writeHead(200, { 'Content-Type': 'application/json' }); s.end(JSON.stringify({ ok: true, url: q.url }));
  });
  await new Promise<void>((r) => agent.listen(agentPort, '127.0.0.1', r));
  child = spawn(process.execPath, [path.join(import.meta.dirname, '..', 'server.ts')], { env: { ...process.env, FINSIGHT_DATA_DIR: dataDir, PORT: String(fsPort), AGENT_URL: `http://127.0.0.1:${agentPort}`, NOTIFY: '0', FINSIGHT_CACHE_PERSIST: '0', ALERT_INTERVAL: '3600', AGENT_AUTOSTART: '0' }, stdio: 'ignore' });
  for (let i = 0; i < 100; i++) { try { await req(fsPort, 'GET', '/api/health'); break; } catch { await new Promise((r) => setTimeout(r, 50)); } }
});
after(() => { child.kill(); agent.close(); });

const link = () => JSON.parse(fs.readFileSync(path.join(dataDir, 'agent-link.json'), 'utf8'));
async function session() {
  const r = await req(fsPort, 'POST', '/api/auth/setup', { 'content-type': 'application/json' }, JSON.stringify({ pin: '482916' }));
  return String(r.headers['set-cookie']).split(';')[0]!;
}

test('agent-link.json is created with private permissions and strong secrets', () => {
  const st = fs.statSync(path.join(dataDir, 'agent-link.json'));
  assert.equal(st.mode & 0o777, 0o600);
  const j = link(); assert.ok(j.token.length >= 32 && j.proxySecret.length >= 32 && j.token !== j.proxySecret);
});

test('before a PIN exists the gate fails closed, even for the token', async () => {
  const auth = { authorization: `Bearer ${link().token}` };
  assert.equal((await req(fsPort, 'GET', '/api/accounts', auth)).status, 401);
});

test('token: allowed GET works without a session; writes, other paths and wrong tokens are refused', async () => {
  await session();
  const auth = { authorization: `Bearer ${link().token}` };
  assert.equal((await req(fsPort, 'GET', '/api/accounts', auth)).status, 200);
  assert.equal((await req(fsPort, 'POST', '/api/accounts/add', { ...auth, 'content-type': 'application/json' }, '{"name":"x"}')).status, 403, 'token cannot write');
  assert.equal((await req(fsPort, 'GET', '/api/charts/layouts', auth)).status, 403, 'token cannot read outside the allowlist');
  assert.equal((await req(fsPort, 'GET', '/api/agent/threads', auth)).status, 403, 'token cannot use the agent proxy');
  assert.equal((await req(fsPort, 'GET', '/api/accounts', { authorization: 'Bearer wrong-wrong-wrong-wrong-wrong-wrong-wrong' })).status, 403);
  assert.equal((await req(fsPort, 'GET', '/api/accounts')).status, 401, 'no token, no session');
});

test('proxy: needs a session, adds the secret, drops browser Origin, enforces same-origin writes', async () => {
  const cookie = await (async () => {
    const r = await req(fsPort, 'POST', '/api/auth/login', { 'content-type': 'application/json' }, JSON.stringify({ pin: '482916' }));
    return String(r.headers['set-cookie']).split(';')[0]!;
  })();
  assert.equal((await req(fsPort, 'GET', '/api/agent/threads')).status, 401);
  agentHits = [];
  const ok = await req(fsPort, 'GET', '/api/agent/threads?archived=1', { cookie });
  assert.equal(ok.status, 200);
  assert.equal(JSON.parse(ok.body).url, '/v1/threads?archived=1');
  const hit = agentHits[0]!;
  assert.equal(hit.secret, link().proxySecret);
  assert.equal(hit.origin, undefined);
  assert.equal(hit.host, `127.0.0.1:${agentPort}`);
  const origin = `http://127.0.0.1:${fsPort}`;
  assert.equal((await req(fsPort, 'POST', '/api/agent/threads', { cookie, origin, 'content-type': 'application/json' }, '{}')).status, 200);
  assert.equal((await req(fsPort, 'POST', '/api/agent/threads', { cookie, origin: 'https://evil.example', 'content-type': 'application/json' }, '{}')).status, 403);
  assert.equal((await req(fsPort, 'POST', '/api/agent/threads', { cookie, 'content-type': 'application/json' }, '{}')).status, 403, 'write without Origin refused');
  const sse = await req(fsPort, 'GET', '/api/agent/threads/th_x/events', { cookie, accept: 'text/event-stream' });
  assert.match(sse.headers['content-type']!, /event-stream/);
  assert.match(sse.body, /turn\.started[\s\S]*turn\.finished/);
  const cut = await Promise.race([
    req(fsPort, 'GET', '/api/agent/threads/th_cut/events', { cookie, accept: 'text/event-stream' }),
    new Promise<never>((_, reject) => { const timer = setTimeout(() => reject(new Error('browser stream never ended')), 2000); timer.unref(); }),
  ]);
  assert.equal(cut.status, 200);
  assert.equal(cut.body, 'id: 1\ndata: partial\n\n');
  agent.close();
  await new Promise((r) => setTimeout(r, 50));
  const off = await req(fsPort, 'GET', '/api/agent/threads', { cookie });
  assert.equal(off.status, 503); assert.equal(JSON.parse(off.body).error.code, 'AGENT_OFFLINE');
});
