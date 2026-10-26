#!/usr/bin/env node
// Fake Kestrel agent for E2E (no model, no network, no data on disk). Speaks
// the /v1 API the chat panel uses through FinSight's /api/agent/* proxy:
// threads, messages, an SSE event stream with ids + replay, stop, uploads.
// Replies echo the prompt word by word; a prompt containing "slow" streams
// for ~10 s so a test can stop it or drop the connection mid-turn.
// Test hook: POST /v1/__test/drop[?mode=end] closes every open event stream.
// Prompt words for the G (Kestrel) spec: "tools" adds a tool row, a citation
// and a cost; "markdown" replies with markdown plus an HTML/script payload;
// "fail" ends the turn with an error; "quickfail" fails it before the
// POST /messages reply arrives (the race the G card fixes).
import http from 'node:http';
import { uiFixture } from './ui-fixture.mjs';

const PORT = Number(process.env.FAKE_AGENT_PORT || 8097);
let seq = 0, ids = 0;
const threads = new Map(); // id -> { id, title, version, defaultBrain, updatedAt, events, messages, running }
const streams = new Map(); // thread id -> Set<res>
const uploads = new Map();

const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((resolve) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { try { resolve(b ? JSON.parse(b) : {}); } catch { resolve({}); } }); });
const publicThread = (t) => ({ id: t.id, title: t.title, version: t.version, defaultBrain: t.defaultBrain, updatedAt: t.updatedAt,
  preview: [...t.messages].reverse().find((x) => x.role === 'assistant')?.blocks[0]?.text?.slice(0, 120) || '' });

function emit(t, type, data) {
  const ev = { id: ++seq, type, data };
  t.events.push(ev);
  for (const res of streams.get(t.id) || []) res.write(`id: ${ev.id}\nevent: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
}

function runTurn(t, turnId, content, attachments, search = 'tavily') {
  const words = `Echo: ${content}${attachments ? ` (${attachments} attachment${attachments > 1 ? 's' : ''})` : ''}`.split(' ');
  const slow = /\bslow\b/i.test(content);
  const chunks = slow ? Array.from({ length: 40 }, (_, i) => (i ? ' ' : '') + `w${i + 1}`) : words.map((w, i) => (i ? ' ' : '') + w);
  const started = Date.now();
  t.running = turnId;
  emit(t, 'turn.started', { turnId, label: 'Fake model', search });
  if (/\bquickfail\b/i.test(content)) { t.running = null; emit(t, 'turn.failed', { turnId, code: 'MODEL_ERROR', message: 'model exploded' }); return; }
  if (/\bfail\b/i.test(content)) {
    // after the POST /messages reply (legacy agent-panel.js mis-handles a turn that ends before it)
    setTimeout(() => { t.running = null; emit(t, 'turn.failed', { turnId, code: 'MODEL_ERROR', message: 'model exploded' }); }, 300);
    return;
  }
  if (/\btools\b/i.test(content)) {
    emit(t, 'tool.started', { turnId, callId: 'c1', name: 'mcp__finsight__get_portfolio', argsSummary: '{"account":"main"}' });
    emit(t, 'tool.finished', { turnId, callId: 'c1', name: 'mcp__finsight__get_portfolio', ok: true, resultSummary: '9 positions', ms: 1200 });
    emit(t, 'citation', { turnId, url: 'https://www.example.com/report', title: 'Report', class: 'primary', retrievedAt: '2026-10-25T00:00:00Z' });
  }
  if (/\buiview\b|\buibad\b|\buiunknown\b|\buidelay\b/i.test(content)) {
    const view = uiFixture(t.id, turnId), bad = /\buibad\b/i.test(content);
    t.messages.push({ id: `m${++ids}`, role: 'assistant', turnId, blocks: [{ type: 'tool_call', id: view.callId, name: 'render_ui', args: { version: 1, value: 999999 } }] });
    t.messages.push({ id: `m${++ids}`, role: 'tool', turnId, blocks: [{ type: 'tool_result', callId: view.callId, name: 'render_ui', ok: !bad, content: bad ? 'UI_REJECTED' : 'accepted' }] });
    emit(t, 'tool.started', { turnId, callId: view.callId, name: 'render_ui', argsSummary: '{}' });
    emit(t, 'tool.finished', { turnId, callId: view.callId, name: 'render_ui', ok: !bad, resultSummary: bad ? 'UI_REJECTED: use prose' : 'accepted' });
    const deliver = () => {
      if (bad) return;
      if (/\buiunknown\b/i.test(content)) view.spec.version = 99;
      (t.uiViews ||= []).push(view);
      emit(t, 'ui.render', { turnId, callId: view.callId, view });
      emit(t, 'ui.render', { turnId, callId: view.callId, view }); // reconnect/replay duplicate
    };
    if (/\buidelay\b/i.test(content)) setTimeout(deliver, 1800); else deliver();
  }
  if (/\bmarkdown\b/i.test(content)) chunks.splice(0, chunks.length, '## Head\n**bold** <script>window.__xss = 1</script> <img src=x onerror="window.__xss = 2">\n\n| Sym | Chg |\n|---|---|\n| AAPL | +1.5% |');
  if (/\bnestedmarkdown\b/i.test(content)) chunks.splice(0, chunks.length, '**"Hottest" splits into two answers right now: Friday\'s hottest *move* was cybersecurity.** The renderer should keep this sentence bold.\n\n`**literal** *code*`');
  let i = 0, text = '';
  const tick = () => {
    if (t.running !== turnId) return; // stopped
    if (i < chunks.length) { text += chunks[i]; emit(t, 'message.delta', { turnId, text: chunks[i++] }); setTimeout(tick, slow ? 250 : 20); return; }
    t.running = null;
    t.messages.push({ id: `m${++ids}`, role: 'assistant', turnId, blocks: [{ type: 'text', text }] });
    emit(t, 'turn.finished', { turnId, costUsd: /\btools\b/i.test(content) ? 0.0123 : 0, ms: Date.now() - started });
  };
  setTimeout(tick, 20);
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x');
  const p = u.pathname.replace(/^\/v1/, '');
  const m = p.match(/^\/threads\/([^/]+)(\/[a-z]+)?$/);
  const t = m && threads.get(m[1]);

  if (req.method === 'GET' && p === '/info') return json(res, 200, { name: 'Kestrel', version: 'fake' });
  if (req.method === 'GET' && p === '/brains') return json(res, 200, { brains: [{ id: 'fake', label: 'Fake model', costTier: '$', available: true }], default: 'fake' });
  if (req.method === 'GET' && p === '/search-providers') return json(res, 200, { default: 'tavily', providers: [
    { id: 'deepseek', label: 'DeepSeek', available: true }, { id: 'tavily', label: 'Tavily', available: true }, { id: 'brave', label: 'Brave', available: false, reason: 'Add BRAVE_API_KEY' }] });
  if (req.method === 'GET' && p === '/skills') return json(res, 200, { skills: [{ name: 'pre-trade-check', description: 'Check a trade against the policy' }] });
  if (req.method === 'GET' && p === '/cost') return json(res, 200, { period: u.searchParams.get('period') || 'day', totalUsd: 0.5, capUsdPerDay: 2 });
  if (req.method === 'GET' && p === '/threads/delete-all/preview') return json(res, 200, { ids: [...threads.keys()].sort() });
  if (req.method === 'POST' && p === '/threads/delete-all') {
    const b = await readBody(req);
    if (!b.confirm || JSON.stringify([...b.ids].sort()) !== JSON.stringify([...threads.keys()].sort())) return json(res, 409, { error: { message: 'Chat list changed' } });
    threads.clear(); return json(res, 200, { ok: true });
  }
  if (req.method === 'GET' && p === '/threads') return json(res, 200, { threads: [...threads.values()].map(publicThread).reverse() });
  if (req.method === 'POST' && p === '/threads') {
    const b = await readBody(req);
    const th = { id: `t${++ids}`, title: 'New chat', version: 1, defaultBrain: b.brain || 'fake', updatedAt: Date.now(), events: [], messages: [], running: null };
    threads.set(th.id, th);
    return json(res, 200, { thread: publicThread(th) });
  }
  if (req.method === 'POST' && p === '/uploads') {
    const b = await readBody(req);
    const up = { id: `u${++ids}`, name: b.name, kind: /\.(png|jpe?g|gif|webp)$/i.test(b.name || '') ? 'image' : 'document', chars: Buffer.from(b.dataBase64 || '', 'base64').length };
    uploads.set(up.id, up);
    return json(res, 200, { upload: up });
  }
  // ?mode=end closes streams cleanly (agent shutting down); default destroys
  // the sockets (agent crash / network cut).
  if (req.method === 'POST' && p === '/__test/drop') {
    let n = 0;
    for (const set of streams.values()) for (const r of set) { if (u.searchParams.get('mode') === 'end') r.end(); else r.destroy(); n++; }
    return json(res, 200, { dropped: n });
  }
  if (m && !t) return json(res, 404, { error: { code: 'NOT_FOUND', message: 'No such chat' } });
  if (t && !m[2] && req.method === 'GET') {
    return json(res, 200, { thread: publicThread(t), messages: t.messages, uiViews: t.uiViews || [], citations: [], lastEventId: seq, runningTurn: t.running });
  }
  if (t && !m[2] && req.method === 'DELETE') { threads.delete(t.id); return json(res, 200, { ok: true }); }
  if (t && m[2] === '/messages' && req.method === 'POST') {
    const b = await readBody(req);
    const turnId = `turn${++ids}`;
    const files = (b.attachmentIds || []).map((id) => uploads.get(id)).filter(Boolean);
    t.messages.push({ id: `m${++ids}`, role: 'user', turnId, blocks: [{ type: 'text', text: b.content }, ...files.map((f) => ({ type: 'attachment', name: f.name, kind: f.kind }))] });
    t.version++; t.updatedAt = Date.now();
    if (t.title === 'New chat') t.title = String(b.content || '').slice(0, 40);
    if (/\bquickfail\b/i.test(b.content || '')) { runTurn(t, turnId, b.content, 0); return void setTimeout(() => json(res, 200, { turnId, version: t.version }), 300); }
    json(res, 200, { turnId, version: t.version });
    return runTurn(t, turnId, b.content || '', files.length, b.search || 'tavily');
  }
  if (t && m[2] === '/stop' && req.method === 'POST') {
    const turnId = t.running;
    t.running = null;
    if (turnId) emit(t, 'turn.stopped', { turnId });
    return json(res, 200, { ok: true });
  }
  if (t && m[2] === '/events' && req.method === 'GET') {
    const after = Math.max(Number(u.searchParams.get('after')) || 0, Number(req.headers['last-event-id']) || 0);
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
    res.write('retry: 300\n\n');
    for (const ev of t.events) if (ev.id > after) res.write(`id: ${ev.id}\nevent: ${ev.type}\ndata: ${JSON.stringify(ev.data)}\n\n`);
    if (!streams.has(t.id)) streams.set(t.id, new Set());
    streams.get(t.id).add(res);
    req.on('close', () => streams.get(t.id).delete(res));
    return;
  }
  json(res, 404, { error: { code: 'NOT_FOUND', message: `fake agent: no route ${req.method} ${u.pathname}` } });
});

server.listen(PORT, '127.0.0.1', () => console.log(`fake agent on http://127.0.0.1:${PORT}`));
