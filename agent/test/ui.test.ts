import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fakeFinsight, testConfig, testCtx, PROXY_SECRET, type Fake } from './helpers.ts';
import { loadConfig } from '../src/config.ts';
import { UiRequest, UiView, MAX_UI_BYTES } from '../src/ui/schema.ts';
import { bindUi, type UiState } from '../src/tools/ui.ts';
import { buildRegistry } from '../src/tools/index.ts';
import * as store from '../src/store/db.ts';
import { ChatEngine } from '../src/chat/engine.ts';
import { EventBus } from '../src/chat/bus.ts';
import { mockBrain, type Script } from '../src/brains/mock.ts';
import { BrainManifest } from '../src/brains/types.ts';
import { createApi } from '../src/api/server.ts';
import type { AddressInfo } from 'node:net';
let fake: Fake;
before(async () => { fake = await fakeFinsight(); });
after(async () => { await fake.close(); });
const time = '2026-10-26T01:00:00.000Z';
const request = { version: 1, components: [{ kind: 'stat_grid', id: 'cash', sourceCallId: 'cash1', fields: ['/totalBase'] }] };
function state(data: unknown = { base: 'SGD', totalBase: 4350, asOf: time, cash: [{ ccy: 'USD', amount: 1000, base: 1350 }] }): UiState {
  return { enabled: true, attempts: 0, completed: new Map([['cash1', { name: 'get_cash', data, completedAt: time, account: 'main' }]]) };
}
function parse(x: unknown) { return UiRequest.parse(x); }
test('UI binds exact source values, canonical labels/units and generated fallback', () => {
  const s = bindUi(parse(request), state());
  assert.match(s.fallback, /Total cash: SGD 4,350.00/);
  assert.match(s.fallback, /Requested account: main/);
  assert.equal(s.components[0]?.source.asOf, time);
  assert.throws(() => parse({ ...request, fallback: 'Invented: 999999' }));
  assert.throws(() => parse({ version: 1, components: [{ ...request.components[0], value: 999999, label: 'Net worth', ccy: 'USD' }] }));
  assert.throws(() => bindUi(parse(request), state({ base: 'SGD', totalBase: Infinity })));
  assert.throws(() => bindUi(parse(request), state({ base: 'notmoney', totalBase: 1 })));
});
test('UI rejects foreign, missing, unsuccessful, unsupported and prototype field references', () => {
  assert.throws(() => bindUi(parse(request), { ...state(), completed: new Map() }));
  for (const field of ['/constructor', '/__proto__', '/cash/0/amount', '/totalBase/foo']) {
    assert.throws(() => bindUi(parse({ version: 1, components: [{ ...request.components[0], fields: [field] }] }), state()));
  }
  assert.throws(() => bindUi(parse(request), state({ error: 'offline', base: 'SGD', totalBase: 4350 })));
  assert.throws(() => bindUi(parse(request), { ...state(), completed: new Map([['cash1', { name: 'fetch_url', data: { totalBase: 4350 }, completedAt: time, account: 'ALL' }]]) }));
});
test('table native and reporting currencies differ; null and empty arrays remain honest', () => {
  const s = bindUi(parse({ version: 1, components: [{ id: 'cash', kind: 'table', sourceCallId: 'cash1', rowsPath: '/cash', fields: ['/ccy', '/amount', '/base'], limit: 1 }] }), state());
  const c = s.components[0]; assert.equal(c?.kind, 'table');
  if (c?.kind === 'table') assert.deepEqual(c.rows[0]?.map((v) => v.text), ['USD', 'USD 1,000.00', 'SGD 1,350.00']);
  assert.match(s.fallback, /Showing 1 of 1/);
  assert.match(bindUi(parse(request), state({ base: 'SGD', totalBase: null })).fallback, /Total cash: —/);
  const empty = bindUi(parse({ version: 1, components: [{ id: 'x', kind: 'table', sourceCallId: 'cash1', rowsPath: '/cash', fields: ['/ccy'] }] }), state({ base: 'SGD', cash: [] }));
  assert.match(empty.fallback, /Showing 0 of 0/);
});
test('strict version/kinds/counts/duplicate ids and serialized byte limits', async () => {
  assert.throws(() => parse({ ...request, version: 2 }));
  assert.throws(() => parse({ version: 1, components: [{ kind: 'calculator', id: 'x' }] }));
  assert.throws(() => parse({ version: 1, components: Array(5).fill(request.components[0]) }));
  assert.throws(() => bindUi(parse({ version: 1, components: [request.components[0], request.components[0]] }), state()));
  const ctx = testCtx(testConfig(fake, { uiViews: true })); ctx.ui = state();
  const result = await buildRegistry().execute('render_ui', { junk: '字'.repeat(MAX_UI_BYTES / 2) }, ctx);
  assert.equal(result.ok, false); assert.match(result.content, /24 KiB/); ctx.db.close();
});
test('price chart binds source history exactly and rejects fabricated or invalid bars', () => {
  const input = parse({ version: 1, components: [{ id: 'chart', kind: 'price_chart', sourceCallId: 'h1' }] });
  const history = { symbol: 'AMD', currency: 'USD', range: '1mo', interval: '1d', asOf: time, ohlcv: [{ t: 1704067200000, c: 100.12345 }, { t: 1704153600000, c: 101.75 }] };
  const st = (data: unknown, name = 'get_history'): UiState => ({ enabled: true, attempts: 0, completed: new Map([['h1', { name, data, completedAt: time, account: 'ALL' }]]) });
  const result = bindUi(input, st(history)), chart = result.components[0];
  assert.equal(chart?.kind, 'price_chart');
  if (chart?.kind === 'price_chart') { assert.deepEqual(chart.points, [{ time: 1704067200000, close: 100.12345 }, { time: 1704153600000, close: 101.75 }]); assert.equal(chart.currency, 'USD'); }
  assert.match(result.fallback, /100.12345/);
  assert.throws(() => parse({ version: 1, components: [{ id: 'chart', kind: 'price_chart', sourceCallId: 'h1', points: [999] }] }));
  assert.throws(() => bindUi(input, st(history, 'get_quote')));
  for (const invalid of [{ ...history, currency: null }, { ...history, ohlcv: [] }, { ...history, ohlcv: [history.ohlcv[1], history.ohlcv[0]] }, { ...history, ohlcv: [{ t: 1, c: Infinity }, { t: 2, c: 10 }] }]) assert.throws(() => bindUi(input, st(invalid)));
});
test('direct/MCP/aborted calls cannot persist; invalid attempts count toward three-call cap', async () => {
  const ctx = testCtx(testConfig(fake, { uiViews: true }));
  assert.equal((await buildRegistry().execute('render_ui', request, ctx)).ok, false);
  ctx.ui = state();
  for (let i = 0; i < 3; i++) assert.equal((await buildRegistry().execute('render_ui', {}, ctx)).ok, false);
  const r = await buildRegistry().execute('render_ui', request, ctx); assert.match(r.content, /three-attempt limit/);
  const t = store.createThread(ctx.db); ctx.threadId = t.id; ctx.turnId = 'turn_x'; ctx.callId = 'u1'; ctx.ui = state(); ctx.signal = AbortSignal.abort();
  assert.equal((await buildRegistry().execute('render_ui', request, ctx)).ok, false);
  assert.deepEqual(store.listUiViews(ctx.db, t.id), []); ctx.db.close();
});
async function run(script: Script, enabled = true, capable = true, file = ':memory:') {
  const cfg = testConfig(fake, { uiViews: enabled }); cfg.defaultBrain = 'mock';
  const db = store.openDb(file), tools = buildRegistry(), bus = new EventBus(db), finsight = testCtx(cfg, db).finsight;
  const engine = new ChatEngine({ cfg, db, tools, bus, finsight, brains: new Map() });
  const manifest = BrainManifest.parse({ apiVersion: 1, kind: 'brain', id: 'mock', label: 'Mock', transport: 'mock', model: 'm', pricing: { inputPerM: 0, outputPerM: 0, version: 't' }, capabilities: { tools: true, ui: capable, streaming: true, contextTokens: 100000 }, costTier: '$' });
  engine.setBrain('mock', mockBrain(manifest, script));
  const t = store.createThread(db), turn = engine.send({ threadId: t.id, content: 'Show cash and holdings' });
  for (let i = 0; i < 500 && engine.isRunning(t.id); i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(engine.isRunning(t.id), null);
  return { cfg, db, tools, bus, finsight, engine, t, turn, manifest };
}
test('mock model uses actual compact history reference to render and persist a chart', async () => {
  const o = await run((req, step) => {
    if (step === 0) return [{ type: 'tool_call', id: 'hist', name: 'get_history', args: { symbol: 'AMD', range: '1y', interval: '1d', includeBars: true, chartOnly: true } }];
    if (step === 1) {
      const result = req.messages.at(-1)!.blocks.find((b) => b.type === 'tool_result');
      assert.ok(result?.type === 'tool_result'); const data = JSON.parse(result.content);
      assert.equal(data.ohlcv.length, 150); assert.equal(data.uiSource.tool, 'get_history');
      return [{ type: 'tool_call', id: 'chart1', name: 'render_ui', args: { version: 1, complete: true, components: [{ id: 'chart', kind: 'price_chart', sourceCallId: data.uiSource.ref }] } }];
    }
    return [{ type: 'text', text: 'Done' }];
  });
  const view = store.listUiViews(o.db, o.t.id)[0]; assert.ok(view);
  const chart = view.spec.components[0]; assert.equal(chart?.kind, 'price_chart');
  if (chart?.kind === 'price_chart') { assert.equal(chart.points.length, 150); assert.equal(chart.symbol, 'AMD'); assert.match(chart.source.note, /150 sampled of 500/); }
  o.db.close();
});
const fetchCash = { type: 'tool_call' as const, id: 'cash1', name: 'get_cash', args: {} };
const render = { type: 'tool_call' as const, id: 'ui1', name: 'render_ui', args: request };
test('mock round trip: accepted API snapshot survives restart/event pruning and deletion', async () => {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ui-db-')), 'agent.db');
  const o = await run((req, step) => {
    assert.ok(req.tools.some((t) => t.name === 'render_ui'));
    if (step === 0) return [fetchCash];
    if (step === 1) {
      const result = req.messages.at(-1)!.blocks.find((b) => b.type === 'tool_result');
      assert.ok(result?.type === 'tool_result');
      const data = JSON.parse(result.content);
      assert.match(data.uiSource.ref, /^ui_source_\d+$/);
      assert.equal(data.uiSource.tool, 'get_cash');
      return [{ ...render, args: { version: 1, components: [{ ...request.components[0], sourceCallId: data.uiSource.ref }] } }];
    }
    return [{ type: 'text', text: 'Cash snapshot above.' }];
  }, true, true, file);
  const views = store.listUiViews(o.db, o.t.id); assert.equal(views.length, 1);
  assert.ok(UiView.safeParse(views[0]).success); assert.equal(views[0]!.spec.components[0]!.source.callId, 'cash1'); assert.match(views[0]!.spec.fallback, /SGD 4,350.00/);
  assert.equal(store.eventsAfter(o.db, o.t.id, 0).filter((e) => e.type === 'ui.render').length, 1);
  const canonical = JSON.stringify(views);
  o.engine.setBrain('other', mockBrain({ ...o.manifest, id: 'other' }, (_req, step) => step === 0 ? [render] : [{ type: 'text', text: 'Use a fresh source.' }]));
  o.engine.send({ threadId: o.t.id, content: 'Switch models and try reusing cash1', brain: 'other' });
  for (let i = 0; i < 500 && o.engine.isRunning(o.t.id); i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(o.engine.isRunning(o.t.id), null);
  assert.equal(store.getThread(o.db, o.t.id)?.defaultBrain, 'other');
  assert.equal(JSON.stringify(store.listUiViews(o.db, o.t.id)), canonical, 'model switch cannot mutate accepted snapshots or reuse old source refs');
  o.db.prepare('DELETE FROM events').run(); o.db.close();
  const db = store.openDb(file); assert.equal(JSON.stringify(store.listUiViews(db, o.t.id)), canonical);
  const server = createApi({ ...o, db, brains: new Map(), brainsInvalid: [] });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const resp = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port: (server.address() as AddressInfo).port, path: `/v1/threads/${o.t.id}`, headers: { 'X-Agent-Secret': PROXY_SECRET, Host: `127.0.0.1:${o.cfg.port}` } }, (r) => {
        let body = ''; r.on('data', (d) => { body += d; }); r.on('end', () => resolve({ status: r.statusCode!, body }));
      }).on('error', reject);
    });
    assert.equal(resp.status, 200, resp.body); const data = JSON.parse(resp.body) as { uiViews: unknown }; assert.equal(JSON.stringify(data.uiViews), canonical);
  } finally { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); }
  store.deleteThread(db, o.t.id); assert.deepEqual(store.listUiViews(db, o.t.id), []); db.close();
});
test('same-batch result, old-turn refs and disabled/uncapable brain never create a view', async () => {
  for (const [enabled, capable] of [[true, true], [false, true], [true, false]]) {
    const o = await run((req, step) => {
      assert.equal(req.tools.some((t) => t.name === 'render_ui'), enabled && capable);
      return step === 0 ? [fetchCash, render] : [{ type: 'text', text: 'Text fallback.' }];
    }, enabled, capable);
    assert.deepEqual(store.listUiViews(o.db, o.t.id), []);
    assert.ok(store.listMessages(o.db, o.t.id).some((m) => m.blocks.some((b) => b.type === 'tool_call' && b.name === 'render_ui')));
    const manifest = BrainManifest.parse({ apiVersion: 1, kind: 'brain', id: 'mock', label: 'Mock', transport: 'mock', model: 'm', pricing: { inputPerM: 0, outputPerM: 0, version: 't' }, capabilities: { tools: true, ui: true, streaming: true, contextTokens: 100000 }, costTier: '$' });
    o.engine.setBrain('mock', mockBrain(manifest, (_r, step) => step === 0 ? [render] : [{ type: 'text', text: 'done' }]));
    o.engine.send({ threadId: o.t.id, content: 'Try reusing old cash1' });
    for (let i = 0; i < 500 && o.engine.isRunning(o.t.id); i++) await new Promise((r) => setTimeout(r, 10));
    assert.deepEqual(store.listUiViews(o.db, o.t.id), []); o.db.close();
  }
});

test('all six supported sources bind actual tool results with their own field units', async () => {
  const ctx = testCtx(testConfig(fake)), reg = buildRegistry();
  const cases = [
    ['get_portfolio', {}, '/positions', ['/symbol', '/avgCost', '/marketValue', '/weightPct']],
    ['query_positions', { limit: 2 }, '/rows', ['/symbol', '/last', '/unrealizedPct']],
    ['get_cash', {}, '/cash', ['/ccy', '/amount', '/base']],
    ['get_exposures', { by: 'sector' }, '/rows', ['/group', '/value', '/weightPct']],
    ['get_accounts', {}, '/accounts', ['/id', '/name', '/count']],
    ['get_quote', { symbols: ['NVDA'] }, '/quotes', ['/symbol', '/price', '/changePct']],
  ] as const;
  for (const [name, args, rowsPath, fields] of cases) {
    const result = await reg.execute(name, args, ctx); assert.equal(result.ok, true, name);
    const s: UiState = { enabled: true, attempts: 0, completed: new Map([['src', { name, data: JSON.parse(result.content), completedAt: time, account: 'ALL' }]]) };
    const ui = bindUi(parse({ version: 1, components: [{ id: 'rows', kind: 'table', sourceCallId: 'src', rowsPath, fields }] }), s);
    assert.equal(ui.components[0]?.source.tool, name);
    if (name === 'get_portfolio') {
      assert.match(ui.fallback, /USD 100.00/); assert.match(ui.fallback, /SGD 2,700.00/); assert.match(ui.fallback, /Liabilities/);
      const stats = bindUi(parse({ version: 1, components: [{ id: 'stats', kind: 'stat_grid', sourceCallId: 'src', fields: ['/summary/netWorth', '/summary/positions'] }] }), s);
      assert.match(stats.fallback, /SGD 10,350.00/); assert.match(stats.fallback, /Positions: 3/);
    }
    if (name === 'get_exposures') assert.match(ui.fallback, /no look-through/);
    if (name === 'query_positions') assert.match(ui.fallback, /totals cover returned positions/);
  }
  ctx.db.close();
});
test('oversized generated view is rejected with narrowing guidance before persistence', () => {
  const s = state(); s.completed.set('p1', { name: 'get_portfolio', completedAt: time, account: 'ALL', data: { summary: { base: 'SGD' }, positions: Array(50).fill({ symbol: 'SYNTHETIC', name: '字'.repeat(110), currency: 'USD', quantity: 10, avgCost: 100, last: 200, marketValue: 2700, weightPct: 45 }) } });
  assert.throws(() => bindUi(parse({ version: 1, components: Array.from({length: 4}, (_, i) => ({ id: 'table' + i, kind: 'table', sourceCallId: 'p1', rowsPath: '/positions', fields: ['/symbol', '/name', '/quantity', '/avgCost', '/last', '/marketValue', '/weightPct'], limit: 50 })) }), s), /24 KiB; reduce rows or columns/);
});

test('accepted call retry is idempotent and cannot replace its original canonical values', async () => {
  const ctx = testCtx(testConfig(fake, { uiViews: true })); ctx.ui = state();
  const t = store.createThread(ctx.db); ctx.threadId = t.id; ctx.turnId = 'turn_retry'; ctx.callId = 'u1';
  const reg = buildRegistry();
  const first = await reg.execute('render_ui', request, ctx); assert.equal(first.ok, true);
  ctx.ui.completed.set('cash1', { name: 'get_cash', completedAt: time, account: 'ALL', data: { base: 'USD', totalBase: 999999 } });
  const retry = await reg.execute('render_ui', request, ctx);
  assert.deepEqual(retry, first); assert.equal(store.listUiViews(ctx.db, t.id).length, 1);
  assert.match(retry.content, /SGD 4,350.00/); assert.doesNotMatch(retry.content, /999999/); ctx.db.close();
});

test('invalid provider envelope cannot persist an otherwise valid view', async () => {
  const ctx = testCtx(testConfig(fake, { uiViews: true })); ctx.ui = state();
  ctx.threadId = store.createThread(ctx.db).id; ctx.turnId = 'turn_valid'; ctx.callId = 'provider_id_' + 'x'.repeat(100);
  const result = await buildRegistry().execute('render_ui', request, ctx);
  assert.equal(result.ok, false);
  assert.deepEqual(store.listUiViews(ctx.db, ctx.threadId), []); ctx.db.close();
});

test('tiny nonzero source quotes remain visible rather than rounding to zero', () => {
  const s: UiState = { enabled: true, attempts: 0, completed: new Map([['q1', { name: 'get_quote', account: 'ALL', completedAt: time, data: { asOf: time, quotes: [{ symbol: 'MICRO', currency: 'USD', price: 0.00000001234 }] } }]]) };
  const ui = bindUi(parse({ version: 1, components: [{ id: 'quotes', kind: 'table', sourceCallId: 'q1', rowsPath: '/quotes', fields: ['/symbol', '/price'] }] }), s);
  assert.match(ui.fallback, /USD 0.00000001234/);
  const row = ui.components[0]; if (row?.kind === 'table') assert.equal(row.rows[0]?.[1]?.value, 0.00000001234);
});

test('reported portfolio account takes precedence over request context; other tools identify request scope', () => {
  const s: UiState = { enabled: true, attempts: 0, completed: new Map([['p1', { name: 'get_portfolio', account: 'requested', completedAt: time, data: { summary: { base: 'SGD', account: 'actual', netWorth: 100 } } }]]) };
  const ui = bindUi(parse({ version: 1, components: [{ id: 'net', kind: 'stat_grid', sourceCallId: 'p1', fields: ['/summary/netWorth'] }] }), s);
  assert.match(ui.fallback, /Account: actual/); assert.doesNotMatch(ui.fallback, /Account: requested/);
  assert.match(bindUi(parse(request), state()).fallback, /Requested account: main/);
});

test('operator UI setting persists in config while an explicit environment value takes precedence', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-operator-'));
  try {
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ uiViews: true }));
    assert.equal(loadConfig({ AGENT_HOME: home }).uiViews, true);
    assert.equal(loadConfig({ AGENT_HOME: home, KESTREL_UI: '0' }).uiViews, false);
    assert.equal(loadConfig({ AGENT_HOME: home, KESTREL_UI: '1' }).uiViews, true);
    fs.writeFileSync(path.join(home, 'config.json'), JSON.stringify({ uiViews: 'yes' }));
    assert.throws(() => loadConfig({ AGENT_HOME: home }), /Invalid/);
  } finally { fs.rmSync(home, { recursive: true, force: true }); }
});

test('explicit complete view avoids another model call; a rejected complete view still gets a repair step', async () => {
  let steps = 0;
  const o = await run((req, step) => {
    steps++;
    if (step === 0) return [fetchCash];
    if (step === 1) {
      const b = req.messages.at(-1)!.blocks[0]; assert.ok(b?.type === 'tool_result');
      const ref = JSON.parse(b.content).uiSource.ref;
      return [{ ...render, args: { version: 1, complete: true, components: [{ ...request.components[0], sourceCallId: ref }] } }];
    }
    throw new Error('An already complete view must not request another model step');
  });
  assert.equal(steps, 2); assert.equal(store.listUiViews(o.db, o.t.id).length, 1); o.db.close();
  let repairSteps = 0;
  const bad = await run((_req, step) => { repairSteps++; return step === 0 ? [{ ...render, args: { ...request, complete: true } }] : [{ type: 'text', text: 'Text fallback after rejection.' }]; });
  assert.equal(repairSteps, 2); assert.equal(store.listUiViews(bad.db, bad.t.id).length, 0); bad.db.close();
});

test('model discovery advertises views only when the operator gate and an available tool-capable API brain agree', async () => {
  const cfg = testConfig(fake, { uiViews: true }), db = store.openDb(':memory:'), tools = buildRegistry(), bus = new EventBus(db), finsight = testCtx(cfg, db).finsight;
  const base = BrainManifest.parse({ apiVersion: 1, kind: 'brain', id: 'api', label: 'API', transport: 'openai-compatible', model: 'synthetic', pricing: { inputPerM: 0, outputPerM: 0, version: 't' }, capabilities: { tools: true, ui: true, streaming: true, contextTokens: 100000 }, costTier: '$' });
  const entries = [base, { ...base, id: 'no-tools', capabilities: { ...base.capabilities, tools: false } }, { ...base, id: 'offline' }, { ...base, id: 'cli', transport: 'claude-code' as const }];
  const brains = new Map(entries.map((manifest) => [manifest.id, { manifest, available: manifest.id !== 'offline', create: () => mockBrain(manifest, () => []) }]));
  const engine = new ChatEngine({ cfg, db, tools, bus, finsight, brains });
  const server = createApi({ cfg, db, tools, bus, finsight, brains, engine, brainsInvalid: [] });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const get = () => new Promise<{ brains: { id: string; ui: boolean }[] }>((resolve, reject) => {
    http.get({ hostname: '127.0.0.1', port: (server.address() as AddressInfo).port, path: '/v1/brains', headers: { 'X-Agent-Secret': PROXY_SECRET, Host: `127.0.0.1:${cfg.port}` } }, (r) => {
      let body = ''; r.on('data', (d) => { body += d; }); r.on('end', () => resolve(JSON.parse(body)));
    }).on('error', reject);
  });
  try {
    assert.deepEqual((await get()).brains.map((b) => [b.id, b.ui]), [['api', true], ['no-tools', false], ['offline', false], ['cli', false]]);
    cfg.uiViews = false; assert.ok((await get()).brains.every((b) => !b.ui));
  } finally { server.closeAllConnections(); await new Promise<void>((r) => server.close(() => r())); db.close(); }
});

// Thinking-effort merge: Luna/Sol views now run through the Responses transport.
test('Responses brain at high effort: source reference, render_ui and complete view persist with encrypted reasoning kept private', async () => {
  const { responsesBrain } = await import('../src/brains/responses.ts');
  const luna = BrainManifest.parse(JSON.parse(fs.readFileSync(new URL('../plugins/brains/gpt-6-luna/manifest.json', import.meta.url), 'utf8')));
  assert.equal(luna.transport, 'openai-responses'); assert.equal(luna.capabilities.ui, true);
  const sse = (output: unknown[]) => new Response(`data: ${JSON.stringify({ type: 'response.completed', response: { status: 'completed', output, usage: { input_tokens: 10, output_tokens: 5 } } })}\n\n`);
  const reasoning = { type: 'reasoning', id: 'rs_1', summary: [], encrypted_content: 'opaque-view-test' };
  let step = 0;
  const brain = responsesBrain(luna, 'test', async (_u, o) => {
    const sent = JSON.parse(String(o?.body)); step++;
    assert.equal(sent.reasoning.effort, 'high');
    assert.ok(sent.tools.some((t: { name: string }) => t.name === 'render_ui'));
    if (step === 1) return sse([reasoning, { type: 'function_call', id: 'fc_1', call_id: 'call_cash', name: 'get_cash', arguments: '{}' }]);
    const out = sent.input.find((i: { type: string; call_id?: string }) => i.type === 'function_call_output' && i.call_id === 'call_cash');
    const ref = JSON.parse(out.output).uiSource.ref as string;
    assert.ok(sent.input.some((i: { encrypted_content?: string }) => i.encrypted_content === 'opaque-view-test'));
    return sse([{ type: 'function_call', id: 'fc_2', call_id: 'call_ui', name: 'render_ui',
      arguments: JSON.stringify({ version: 1, complete: true, components: [{ kind: 'stat_grid', id: 'cash', sourceCallId: ref, fields: ['/totalBase'] }] }) }]);
  });
  const cfg = testConfig(fake, { uiViews: true }); cfg.defaultBrain = 'gpt-6-luna';
  const db = store.openDb(':memory:');
  try {
    const engine = new ChatEngine({ cfg, db, tools: buildRegistry(), bus: new EventBus(db), finsight: testCtx(cfg, db).finsight, brains: new Map() });
    engine.setBrain('gpt-6-luna', brain);
    const t = store.createThread(db);
    engine.send({ threadId: t.id, content: 'Show my cash as cards', effort: 'high' });
    for (let i = 0; i < 500 && engine.isRunning(t.id); i++) await new Promise((r) => setTimeout(r, 10));
    assert.equal(step, 2, 'complete:true ends the turn without another model call');
    const views = store.listUiViews(db, t.id); assert.equal(views.length, 1); assert.equal(views[0]!.spec.components[0]!.source.callId, 'call_cash');
    assert.ok(store.eventsAfter(db, t.id, 0).some((e) => e.type === 'turn.finished'));
    assert.ok(!JSON.stringify(store.listMessages(db, t.id).flatMap((m) => m.blocks)).includes('opaque-view-test'));
  } finally { db.close(); }
});
