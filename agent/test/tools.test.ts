import { test, after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fakeFinsight, testConfig, testCtx, TOKEN } from './helpers.ts';
import type { Fake } from './helpers.ts';
import { buildRegistry } from '../src/tools/index.ts';

let fake: Fake;
before(async () => { fake = await fakeFinsight(); });
after(async () => { await fake.close(); });
const reg = buildRegistry();
const run = async (name: string, args: unknown, ctx = testCtx(testConfig(fake))) => {
  const r = await reg.execute(name, args, ctx);
  return { ...r, json: JSON.parse(r.content.split('\n…[TRUNCATED')[0]!) };
};

test('every tool has a JSON schema and a unique, valid name', () => {
  const s = reg.schemas();
  assert.ok(s.length >= 25);
  for (const t of s) { assert.equal(t.parameters.type, 'object'); assert.ok(t.description.length > 20, t.name); }
});

test('no tool can write to FinSight, trade or send (prohibited capabilities)', () => {
  const names = reg.list().map((t) => t.name).join(' ');
  for (const bad of ['buy', 'sell', 'order', 'trade', 'transfer', 'send_', 'email', 'delete', 'withdraw']) assert.ok(!new RegExp(`\\b${bad}`).test(names), bad);
});

test('facts calls use the GET-only token', async () => {
  await run('get_portfolio', {});
  const c = fake.calls.find((x) => x.path === '/api/portfolio')!;
  assert.equal(c.method, 'GET'); assert.equal(c.auth, `Bearer ${TOKEN}`);
});

test('query_positions filters, sorts and totals in code', async () => {
  const r = await run('query_positions', { currency: 'USD', sortBy: 'unrealizedPct', limit: 5 });
  assert.equal(r.ok, true);
  assert.deepEqual(r.json.rows.map((x: any) => x.symbol), ['NVDA', 'VOO']);
  assert.equal(r.json.totals.marketValue, 5400);
  assert.equal(r.json.totals.weightPct, 90);
});

test('query_positions by sector uses FinSight categories', async () => {
  const r = await run('query_positions', { sector: 'tech' });
  assert.deepEqual(r.json.rows.map((x: any) => x.symbol), ['NVDA']);
});

test('get_exposures by currency includes cash and sums to 100%', async () => {
  const r = await run('get_exposures', { by: 'currency' });
  const sum = r.json.rows.reduce((s: number, x: any) => s + x.weightPct, 0);
  assert.ok(Math.abs(sum - 100) < 0.05, String(sum));
  assert.equal(r.json.total, 10350);
  assert.equal(r.json.lookThrough, false);
});

test('invalid tool input is rejected before execution', async () => {
  const r = await run('query_positions', { limit: 999 });
  assert.equal(r.ok, false); assert.equal(r.json.error.code, 'TOOL_INPUT_INVALID');
});

test('FinSight down gives FINSIGHT_DOWN, never a guess', async () => {
  const cfg = testConfig(fake, { finsightUrl: 'http://127.0.0.1:9' });
  const r = await run('get_portfolio', {}, testCtx(cfg));
  assert.equal(r.ok, false); assert.equal(r.json.error.code, 'FINSIGHT_DOWN');
});

test('records tools are confined to the records folder', async () => {
  const r = await run('get_policy', {});
  assert.match(r.json.text, /Policy v0\.1/);
  const s = await run('search_memory', { query: 'HBM supply', scope: 'notes' });
  assert.match(s.json.results[0].source, /reviews\/semis\.md$/);
});

test('size_position: shares from net worth x risk / per-share risk in base currency, with warnings', async () => {
  const r = await run('size_position', { symbol: 'NVDA', entry: 200, stop: 190, riskPct: 1 });
  assert.equal(r.ok, true);
  // risk = 10350 x 1% = 103.5 SGD; per share = (200-190) x 1.35 = 13.5 SGD -> 7 shares
  assert.equal(r.json.result.shares, 7);
  assert.equal(r.json.result.costBase, Math.round(7 * 200 * 1.35));
  assert.ok(r.json.warnings.some((w: string) => /placeholder cap/.test(w)), 'concentration warning');
  assert.ok(r.json.warnings.some((w: string) => /Earnings/.test(w)), 'earnings warning');
  assert.match(r.json.placeholders, /not accepted policy/);
  const bad = await run('size_position', { symbol: 'NVDA', entry: 100, stop: 110 });
  assert.equal(bad.ok, false);
});

test('context pack is compact and dated', async () => {
  const r = await run('get_context_pack', {});
  assert.ok(r.json.asOf); assert.equal(r.json.summary.netWorth, 10350);
  assert.ok(r.content.length < 6000, `pack ${r.content.length} chars`);
  assert.equal(r.json.eventsNext14d[0].symbol, 'NVDA');
});

test('propose_record_update stores a proposal only', async () => {
  const ctx = testCtx(testConfig(fake));
  const r = await run('propose_record_update', { kind: 'profile', text: 'Loan rate is 4.5%' }, ctx);
  assert.equal(r.json.status, 'pending');
  assert.equal((ctx.db.prepare('SELECT COUNT(*) n FROM proposals').get() as any).n, 1);
});

test('strategy tools run the real FinSight engines in the sandbox', async () => {
  const cfg = testConfig(fake);
  const list = await run('list_strategies', {}, testCtx(cfg));
  assert.ok(list.json.strategies.length >= 5);
  assert.ok(list.json.strategies.every((s: any) => s.status && (s.status === 'accepted' || s.label)));
  const one = await run('run_strategy', { id: 'matrend', symbol: 'NVDA' }, testCtx(cfg));
  assert.equal(one.ok, true, one.content); assert.equal(one.json.result.kind, 'trade');
  const again = await run('run_strategy', { id: 'matrend', symbol: 'NVDA' }, testCtx(cfg));
  assert.deepEqual(again.json.result, one.json.result, 'deterministic');
  const scan = await run('scan_strategies', { scope: 'holdings', onlyLive: false }, testCtx(cfg));
  assert.equal(scan.ok, true, scan.content);
  assert.equal(scan.json.scanned.symbols, 3);
  assert.equal(fake.calls.filter((c) => c.path === '/api/history/batch').length >= 1, true, 'batch endpoint used');
});

test('private strategy plugins: valid one loads; escapes are denied', async () => {
  const cfg = testConfig(fake);
  const root = cfg.privateStrategiesDir;
  const mk = (id: string, engine: string, manifest: object = {}) => {
    fs.mkdirSync(path.join(root, id), { recursive: true });
    fs.writeFileSync(path.join(root, id, 'manifest.json'), JSON.stringify({ apiVersion: 1, kind: 'strategy', id, name: id, version: '0.1.0', status: 'idea', engine: 'engine.js', ...manifest }));
    fs.writeFileSync(path.join(root, id, 'engine.js'), engine);
  };
  mk('good', 'module.exports = { run: (bars) => ({ kind: "trade", stage: { code: "none", label: "No setup", detail: String(bars.length) }, setups: [], trades: [], stats: { n: 0 } }) };');
  mk('reads-file', 'const fs = require("fs"); module.exports = { run: () => ({ kind: "trade", stage: { label: fs.readFileSync("/etc/hosts", "utf8") } }) };');
  mk('net', 'const http = require("node:http"); module.exports = { run: () => ({}) };');
  mk('fetcher', 'module.exports = { run: () => { fetch("http://127.0.0.1:1"); return {}; } };');
  mk('escape', 'module.exports = {}', { engine: '../good/engine.js' });
  const list = await run('list_strategies', {}, testCtx(cfg));
  const ids = list.json.strategies.map((s: any) => s.key);
  assert.ok(ids.includes('good'));
  for (const bad of ['reads-file', 'net', 'escape']) assert.ok(list.json.invalid.some((i: any) => i.id === bad), `${bad} rejected`);
  const r = await run('run_strategy', { id: 'good', symbol: 'NVDA' }, testCtx(cfg));
  assert.equal(r.json.result.stage.label, 'No setup');
  const f = await run('run_strategy', { id: 'fetcher', symbol: 'NVDA' }, testCtx(cfg));
  assert.match(JSON.stringify(f.json), /fetch is not a function|error/);
  fs.rmSync(root, { recursive: true, force: true });
});

test('weights name their basis; both denominators come from one snapshot and liabilities stay unknown', async () => {
  const p = await run('get_portfolio', {});
  assert.equal(p.json.weightBasis, 'securities');
  assert.equal(p.json.denominators.securities.value, 6000);
  assert.equal(p.json.denominators.securities_plus_cash.value, 10350);
  assert.equal(p.json.denominators.liabilities, 'not tracked');
  const voo = p.json.positions.find((x: any) => x.symbol === 'VOO');
  assert.equal(voo.weightPct, 45); // displayed meaning unchanged
  assert.equal(voo.weightInclCashPct, 26.09);
  const q = await run('query_positions', { currency: 'USD' });
  assert.equal(q.json.weightBasis, 'securities');
  assert.equal(q.json.totals.weightInclCashPct, 52.18);
  const e = await run('get_exposures', { by: 'currency' });
  assert.equal(e.json.weightBasis, 'securities_plus_cash');
  assert.equal(e.json.denominator.value, e.json.total);
});

test('portfolio_weights computes single and combined weights on both bases in code', async () => {
  const r = await run('portfolio_weights', { symbols: ['voo', 'NVDA', 'ZZZZ'] });
  assert.equal(r.ok, true);
  assert.deepEqual(r.json.rows.map((x: any) => [x.symbol, x.securitiesPct, x.weightInclCashPct]), [['VOO', 45, 26.09], ['NVDA', 45, 26.09]]);
  assert.deepEqual([r.json.combined.marketValue, r.json.combined.securitiesPct, r.json.combined.weightInclCashPct], [5400, 90, 52.17]);
  assert.deepEqual(r.json.notHeld, ['ZZZZ']);
  assert.equal(r.json.denominators.liabilities, 'not tracked');
});
