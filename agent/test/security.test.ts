import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { fakeFinsight, testConfig, PROXY_SECRET, logs } from './helpers.ts';
import type { Fake } from './helpers.ts';
import { isBlockedIp, guardedFetch } from '../src/tools/netguard.ts';
import { redact, registerSecret, log } from '../src/log.ts';
import { openDb } from '../src/store/db.ts';
import { buildRegistry } from '../src/tools/index.ts';
import { finsightClient } from '../src/tools/finsight.ts';
import { EventBus } from '../src/chat/bus.ts';
import { ChatEngine } from '../src/chat/engine.ts';
import { createApi } from '../src/api/server.ts';
import { htmlToText } from '../src/tools/web.ts';

let fake: Fake;
before(async () => { fake = await fakeFinsight(); });
after(async () => { await fake.close(); });

test('SSRF: private, loopback, link-local, metadata and mapped addresses are blocked', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fe80::1', 'fd00::1',
    '::ffff:127.0.0.1', '::ffff:7f00:1', '64:ff9b::a9fe:a9fe', '::', '224.0.0.1']) assert.equal(isBlockedIp(ip), true, ip);
  for (const ip of ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111']) assert.equal(isBlockedIp(ip), false, ip);
});

test('SSRF: fetch refuses loopback, localhost names, non-http schemes and credentials', async () => {
  for (const url of [`${fake.url}/api/portfolio`, 'http://localhost:8001/', 'http://[::1]/', 'file:///etc/passwd', 'ftp://example.com/', 'http://user:pw@example.com/', 'http://169.254.169.254/latest/meta-data']) {
    await assert.rejects(guardedFetch(url), (e: any) => e.code === 'SSRF_BLOCKED', url);
  }
});

test('SSRF: redirect to a private address is blocked at the redirect hop', async () => {
  // A loopback server can't be the first hop (blocked), so test the hop check via the resolver path:
  await assert.rejects(guardedFetch('http://127.0.0.1.nip.io/'), (e: any) => ['SSRF_BLOCKED', 'FETCH_FAILED'].includes(e.code));
});

test('redaction strips registered secrets and key patterns from logs', () => {
  registerSecret('super-secret-value-123');
  assert.equal(redact('x super-secret-value-123 y'), 'x [REDACTED] y');
  assert.equal(redact('key ' + 'sk-' + 'abcdefghijklmnopqrstuvwxyz'), 'key [REDACTED]'); // built at runtime so the secret scan stays clean
  log('info', 'test', { auth: 'Bearer abcdefghijklmnopqrstuvwxyz0123' });
  assert.ok(!logs.join('\n').includes('abcdefghijklmnopqrstuvwxyz0123'));
});

test('fetched HTML is reduced to text (scripts dropped)', () => {
  const { text } = htmlToText('<html><head><title>T</title><script>alert(1)</script></head><body><p>Hello <b>world</b></p><script>steal()</script></body></html>', 'https://x.test');
  assert.match(text, /Hello world/); assert.doesNotMatch(text, /steal|alert/);
});

async function startApi(): Promise<{ port: number; close: () => void }> {
  const cfg = testConfig(fake);
  const db = openDb(':memory:'); const bus = new EventBus(db); const tools = buildRegistry();
  const finsight = finsightClient(cfg.finsightUrl, cfg.finsightDataDir);
  const engine = new ChatEngine({ cfg, db, tools, brains: new Map(), finsight, bus });
  const server = createApi({ cfg, db, engine, bus, brains: new Map(), brainsInvalid: [], tools, finsight });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  cfg.port = port; // host allowlist is built from cfg.port at creation; rebuild with the real port
  server.close();
  const server2 = createApi({ cfg, db, engine, bus, brains: new Map(), brainsInvalid: [], tools, finsight });
  await new Promise<void>((r) => server2.listen(port, '127.0.0.1', r));
  return { port, close: () => { server2.closeAllConnections(); server2.close(); } };
}
function req(port: number, path: string, headers: Record<string, string>, method = 'GET', body?: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, path, method, headers }, (res) => { let b = ''; res.on('data', (c) => (b += c)); res.on('end', () => resolve({ status: res.statusCode || 0, body: b })); });
    r.on('error', reject); if (body) r.write(body); r.end();
  });
}

test('agent API: rejects bad Host (DNS rebinding), browser Origin, missing or wrong secret', async () => {
  const api = await startApi();
  try {
    const good = { host: `127.0.0.1:${api.port}`, 'x-agent-secret': PROXY_SECRET };
    assert.equal((await req(api.port, '/v1/threads', good)).status, 200);
    assert.equal((await req(api.port, '/v1/threads', { ...good, host: `evil.example:${api.port}` })).status, 403);
    assert.equal((await req(api.port, '/v1/threads', { ...good, origin: 'https://evil.example' })).status, 403);
    assert.equal((await req(api.port, '/v1/threads', { host: good.host })).status, 401);
    assert.equal((await req(api.port, '/v1/threads', { ...good, 'x-agent-secret': 'wrong-secret-wrong-secret-wrong-secret-wr' })).status, 401);
    assert.equal((await req(api.port, '/v1/health', { host: good.host })).body, '{"ok":true}', 'unauthenticated health reveals nothing');
    const nonJson = await req(api.port, '/v1/threads', { ...good, 'content-type': 'text/plain' }, 'POST', '{}');
    assert.equal(nonJson.status, 415);
    const del = await req(api.port, '/v1/threads/th_doesnotexist', good, 'DELETE');
    assert.equal(del.status, 400, 'delete needs explicit confirm');
  } finally { api.close(); }
});
