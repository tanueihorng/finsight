// Portfolio backtest: dataset cleaning, full-trade output and the tool end to end.
// The Python replay itself is covered by agent/quant/tests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { benchmarkWindowWarning, buildCalendar, cleanSeries, fingerprint } from '../src/quant/data.ts';
import { QUANT_PYTHON, runQuantWorker } from '../src/quant/host.ts';
import { MAX_SAVED_RUNS, digest, listRuns, saveRun } from '../src/quant/runs.ts';
import { openDb } from '../src/store/db.ts';
import { buildRegistry } from '../src/tools/index.ts';
import { fakeFinsight, testConfig, testCtx, PROXY_SECRET } from './helpers.ts';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { EventBus } from '../src/chat/bus.ts';
import { ChatEngine } from '../src/chat/engine.ts';
import { createApi } from '../src/api/server.ts';
import { finsightClient } from '../src/tools/finsight.ts';

const at = (date: string, c = 100, extra: object = {}) => ({ t: Date.parse(`${date}T14:30:00Z`), o: c, h: c, l: c, c, v: 1000, ...extra });
const noon = Date.parse('2026-03-04T17:00:00Z'); // 12:00 in New York
const afterClose = Date.parse('2026-03-04T21:30:00Z');

test('in-progress session bars are dropped until the New York close has passed', () => {
  const points = [at('2026-03-03'), at('2026-03-04')];
  assert.deepEqual(cleanSeries('A', points, noon).bars.map((b) => b.date), ['2026-03-03']);
  assert.deepEqual(cleanSeries('A', points, afterClose).bars.map((b) => b.date), ['2026-03-03', '2026-03-04']);
});

test('invalid bars are removed and reported; adjusted close is kept', () => {
  const { bars, warnings } = cleanSeries('A', [at('2026-03-02', 100, { adj: 99 }), { ...at('2026-03-03'), o: null }, { ...at('2026-03-04'), l: 0 }], afterClose + 864e5);
  assert.equal(bars.length, 1);
  assert.equal(bars[0]!.adj, 99);
  assert.match(warnings[0]!, /dropped 2 bars/);
});

test('large jumps and long gaps are flagged', () => {
  const { warnings } = cleanSeries('A', [at('2026-01-02', 100), at('2026-01-05', 300), at('2026-02-20', 300)], afterClose);
  assert.ok(warnings.some((w) => /moved more than 50%/.test(w)));
  assert.ok(warnings.some((w) => /no bars between/.test(w)));
});

test('duplicate sessions keep one bar, in date order', () => {
  const { bars } = cleanSeries('A', [at('2026-03-03', 101), at('2026-03-02', 100), at('2026-03-03', 102)], afterClose);
  assert.deepEqual(bars.map((b) => b.c), [100, 102]);
});

test('calendar starts on a benchmark day and fingerprints are order independent', () => {
  const bench = cleanSeries('SPY', [at('2024-03-01'), at('2025-03-03'), at('2026-03-03')], afterClose).bars;
  const other = cleanSeries('A', [at('2025-03-04')], afterClose).bars;
  assert.deepEqual(buildCalendar(1, bench, [other]), ['2025-03-03', '2025-03-04', '2026-03-03']);
  assert.equal(fingerprint({ A: other, B: bench }), fingerprint({ B: bench, A: other }));
  assert.notEqual(fingerprint({ A: other }), fingerprint({ A: bench }));
});

test('short benchmark history is disclosed without warning for a holiday-sized gap', () => {
  const short = cleanSeries('SPY', [at('2023-01-03'), at('2025-01-02')], afterClose).bars;
  assert.match(benchmarkWindowWarning(9, short)!, /9-year window is shortened/);
  const complete = cleanSeries('SPY', [at('2024-01-03'), at('2025-01-02')], afterClose).bars;
  assert.equal(benchmarkWindowWarning(1, complete), null);
});

const needsWorker = { skip: fs.existsSync(QUANT_PYTHON) ? false : 'run: uv sync --project agent/quant' };

test('worker failures surface as typed errors, never as a result', needsWorker, async () => {
  const live = () => AbortSignal.timeout(30_000);
  await assert.rejects(runQuantWorker({ version: 99 }, live()), (e: any) => e.code === 'QUANT_INVALID');
  await assert.rejects(runQuantWorker({ version: 1 }, live()), (e: any) => e.code === 'QUANT_INVALID');
  await assert.rejects(runQuantWorker({ version: 1 }, live(), 1), (e: any) => e.code === 'QUANT_TIMEOUT');
  const controller = new AbortController();
  const pending = runQuantWorker({ version: 1 }, controller.signal);
  controller.abort();
  await assert.rejects(pending, (e: any) => e.name === 'AbortError');
});

test('session dates and the close cut-off follow New York across daylight saving', () => {
  const summer = Date.parse('2026-07-01T20:10:00Z'), winter = Date.parse('2026-01-05T21:10:00Z'); // 16:10 in New York on both days
  assert.equal(cleanSeries('A', [{ ...at('2026-07-01'), t: Date.parse('2026-07-01T13:30:00Z') }], summer).bars.length, 0);
  assert.equal(cleanSeries('A', [{ ...at('2026-07-01'), t: Date.parse('2026-07-01T13:30:00Z') }], summer + 10 * 6e4).bars.length, 1);
  assert.equal(cleanSeries('A', [at('2026-01-05')], winter).bars.length, 0);
  assert.equal(cleanSeries('A', [at('2026-01-05')], winter + 5 * 6e4).bars[0]!.date, '2026-01-05');
});

test('backtest_portfolio refuses strategies that produce no trades', async () => {
  const fake = await fakeFinsight();
  try {
    const out = await buildRegistry().execute('backtest_portfolio', { strategy: 'dcazones', symbols: ['AAA'] }, testCtx(testConfig(fake)));
    assert.equal(out.ok, false);
    assert.match(out.content, /does not produce trades/);
  } finally { await fake.close(); }
});

test('backtest_portfolio replays engine trades in Python and labels the evidence', needsWorker, async () => {
  const fake = await fakeFinsight();
  try {
    const registry = buildRegistry();
    const args = { strategy: 'matrend', symbols: ['AAA', 'BBBB'], years: 1, positionPct: 20 };
    const first = await registry.execute('backtest_portfolio', args, testCtx(testConfig(fake)));
    assert.equal(first.ok, true, first.content);
    const a = JSON.parse(first.content);
    assert.equal(a.reconciled, true);
    assert.equal(a.benchmark, 'SPY');
    assert.match(a.validation, /In-sample/);
    assert.match(a.warnings[0], /Survivorship/);
    assert.match(a.strategy, /^matrend@/);
    assert.equal(typeof a.performance.strategy.totalReturnPct, 'number');
    assert.equal(typeof a.performance.benchmark.maxDrawdownPct, 'number');
    assert.ok(a.provenance.datasetSha256.length === 64 && a.provenance.engineSha256.length === 64);
    const again = JSON.parse((await registry.execute('backtest_portfolio', args, testCtx(testConfig(fake)))).content);
    assert.match(a.runId, /^qr_/);
    assert.notEqual(again.runId, a.runId);
    delete a.asOf; delete again.asOf; delete a.runId; delete again.runId;
    assert.deepEqual(again, a, 'same inputs and data give the same result');
  } finally { await fake.close(); }
});

// ---- saved runs ----

const savedArgs = { strategy: 'matrend', symbols: ['AAA', 'BBBB'], years: 1, positionPct: 20 };
const content = (out: { ok: boolean; content: string }) => { assert.equal(out.ok, true, out.content); return JSON.parse(out.content); };

async function savedRun() {
  const fake = await fakeFinsight();
  const cfg = testConfig(fake);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'quant-runs-')), 'agent.db');
  const db = openDb(file);
  const registry = buildRegistry();
  const saved = content(await registry.execute('backtest_portfolio', savedArgs, testCtx(cfg, db)));
  db.close();
  await fake.close(); // anything that tries to refetch history now fails
  return { cfg, file, registry, saved };
}
const ask = (s: Awaited<ReturnType<typeof savedRun>>, db: ReturnType<typeof openDb>, args: object) => s.registry.execute('get_quant_run', args, testCtx(s.cfg, db));

test('a saved run survives a restart and reproduces from stored bars with FinSight down', needsWorker, async () => {
  const s = await savedRun();
  const db = openDb(s.file);
  try {
    const read = content(await ask(s, db, { runId: s.saved.runId }));
    assert.equal(read.robustness, null);
    delete read.savedAt; delete read.robustness;
    assert.deepEqual(read, s.saved);
    const again = content(await ask(s, db, { runId: s.saved.runId, reproduce: true }));
    assert.equal(again.reproduced, true, JSON.stringify(again));
    assert.deepEqual([again.candidatesMatch, again.resultMatch, again.engineChanged, again.workerChanged, again.changedSections], [true, true, false, false, []]);
    const listed = content(await ask(s, db, {}));
    assert.equal(listed.runs[0].runId, s.saved.runId);
    assert.equal(listed.runs[0].cagrPct, s.saved.performance.strategy.cagrPct);
    assert.match(listed.validation, /In-sample/);
    assert.match(listed.survivorship, /Survivorship/);
  } finally { db.close(); }
});

test('reproduce recomputes rather than echoing the stored answer', needsWorker, async () => {
  const s = await savedRun();
  const db = openDb(s.file);
  try {
    const edit = (change: (r: any) => void) => { const r = JSON.parse((db.prepare('SELECT result_json j FROM quant_runs').get() as any).j); change(r); db.prepare('UPDATE quant_runs SET result_json = ?').run(JSON.stringify(r)); };
    edit((r) => { r.settings.costBps = 80; });
    const costlier = content(await ask(s, db, { runId: s.saved.runId, reproduce: true }));
    assert.equal(costlier.reproduced, false);
    assert.equal(costlier.candidatesMatch, true);
    assert.ok(costlier.changedSections.includes('performance'), JSON.stringify(costlier));
    edit((r) => { r.settings.costBps = 10; r.provenance.candidatesSha256 = 'x'; });
    const candidates = content(await ask(s, db, { runId: s.saved.runId, reproduce: true }));
    assert.deepEqual([candidates.reproduced, candidates.candidatesMatch, candidates.resultMatch], [false, false, true]);
    edit((r) => { r.provenance.candidatesSha256 = candidates.current.candidatesSha256; r.provenance.engineSha256 = 'old'; r.provenance.workerSha256 = 'old'; });
    const code = content(await ask(s, db, { runId: s.saved.runId, reproduce: true }));
    assert.deepEqual([code.reproduced, code.engineChanged, code.workerChanged], [true, true, true]);
  } finally { db.close(); }
});

test('altered stored bars are refused, whether or not their own hash was rewritten', needsWorker, async () => {
  const s = await savedRun();
  const db = openDb(s.file);
  try {
    const link = db.prepare("SELECT sha256 FROM quant_run_series WHERE symbol = 'AAA'").get() as { sha256: string };
    const blob = db.prepare('SELECT bars_gz b FROM quant_series WHERE sha256 = ?').get(link.sha256) as { b: Buffer };
    const bars = JSON.parse(zlib.gunzipSync(blob.b).toString());
    bars[5].c += 0.01;
    const refused = () => ask(s, db, { runId: s.saved.runId, reproduce: true });
    db.prepare('UPDATE quant_series SET bars_gz = ? WHERE sha256 = ?').run(zlib.gzipSync(JSON.stringify(bars)), link.sha256);
    let out = await refused();
    assert.equal(out.ok, false);
    assert.match(out.content, /QUANT_RUN_CORRUPT.*AAA bars changed/);

    db.prepare('UPDATE quant_series SET bars_gz = ? WHERE sha256 = ?').run(Buffer.from('not gzip'), link.sha256);
    assert.match((await refused()).content, /AAA bars are unreadable/);

    db.pragma('foreign_keys = OFF');
    const rewritten = digest(bars);
    db.prepare('UPDATE quant_series SET sha256 = ?, bars_gz = ? WHERE sha256 = ?').run(rewritten, zlib.gzipSync(JSON.stringify(bars)), link.sha256);
    db.prepare("UPDATE quant_run_series SET sha256 = ? WHERE symbol = 'AAA'").run(rewritten);
    out = await refused();
    assert.equal(out.ok, false);
    assert.match(out.content, /does not match the hash recorded/);
  } finally { db.close(); }
});

test('saved series are shared between runs and retention removes only unreferenced bars', () => {
  const db = openDb(':memory:');
  const bars = (c: number) => [{ t: 1, date: '2026-01-02', o: c, h: c, l: c, c, v: 1, adj: c }];
  const result = { provenance: {} };
  const first = saveRun(db, { strategyKey: 'matrend', series: { KEEP: bars(1), OLD: bars(2) }, result });
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) n FROM ${table}`).get() as { n: number }).n;
  const second = saveRun(db, { strategyKey: 'matrend', series: { KEEP: bars(1) }, result });
  assert.equal(count('quant_series'), 2);
  assert.deepEqual(listRuns(db, 2).map((r) => r.id), [second, first], 'newest first');
  for (let i = 0; i < MAX_SAVED_RUNS; i++) saveRun(db, { strategyKey: 'matrend', series: { KEEP: bars(1), NEW: bars(100 + i) }, result });
  assert.equal(count('quant_runs'), MAX_SAVED_RUNS);
  assert.equal((db.prepare('SELECT COUNT(*) n FROM quant_runs WHERE id = ?').get(first) as { n: number }).n, 0);
  assert.equal(count('quant_series'), MAX_SAVED_RUNS + 1, 'one shared series plus one per kept run');
  db.close();
});

test('get_quant_run reports unknown runs and needs a run to reproduce', async () => {
  const fake = await fakeFinsight();
  try {
    const registry = buildRegistry(), ctx = testCtx(testConfig(fake));
    assert.match((await registry.execute('get_quant_run', { runId: 'qr_missing' }, ctx)).content, /NOT_FOUND/);
    assert.match((await registry.execute('get_quant_run', { reproduce: true }, ctx)).content, /reproduce needs a runId/);
    assert.deepEqual(content(await registry.execute('get_quant_run', {}, ctx)).runs, []);
  } finally { await fake.close(); }
});

// ---- robustness checks ----

test('validate_quant_run studies a saved run from stored bars, repeatably, and stores the result', needsWorker, async () => {
  const s = await savedRun();
  const db = openDb(s.file);
  try {
    assert.equal(content(await ask(s, db, { runId: s.saved.runId })).robustness, null);
    const first = content(await s.registry.execute('validate_quant_run', { runId: s.saved.runId }, testCtx(s.cfg, db)));
    assert.equal(first.runId, s.saved.runId);
    assert.equal(first.baseMatchesRun, true);
    assert.equal(first.status, s.saved.status);
    assert.match(first.label, /not out-of-sample proof/);
    assert.ok(first.limits.some((l: string) => /not a p-value/.test(l)) && first.limits.some((l: string) => /authorises a paper order/.test(l)));
    assert.match(first.warnings[0], /Survivorship/);
    assert.equal(first.checks.length, 6);
    assert.equal(first.summary.pass + first.summary.fail + first.summary.insufficient, 6);
    assert.equal(first.provenance.datasetSha256, s.saved.provenance.datasetSha256);
    const again = content(await s.registry.execute('validate_quant_run', { runId: s.saved.runId }, testCtx(s.cfg, db)));
    assert.equal(again.provenance.studySha256, first.provenance.studySha256, 'same inputs give the same study');
    delete again.runId;
    assert.deepEqual(content(await ask(s, db, { runId: s.saved.runId, detail: 'robustness' })).robustness, again);
    const read = content(await ask(s, db, { runId: s.saved.runId })).robustness;
    assert.deepEqual([read.checks, read.limits, read.label, read.warnings, read.summary], [again.checks, again.limits, again.label, again.warnings, again.summary]);
    assert.equal(read.time, undefined, 'the per-study tables stay out of the default read');
    assert.deepEqual(content(await ask(s, db, {})).runs[0].robustnessChecks, again.summary);
  } finally { db.close(); }
});

test('validate_quant_run refuses when the engine no longer produces the saved trades', needsWorker, async () => {
  const s = await savedRun();
  const db = openDb(s.file);
  try {
    const r = JSON.parse((db.prepare('SELECT result_json j FROM quant_runs').get() as any).j);
    r.provenance.candidatesSha256 = 'different';
    db.prepare('UPDATE quant_runs SET result_json = ?').run(JSON.stringify(r));
    const out = await s.registry.execute('validate_quant_run', { runId: s.saved.runId }, testCtx(s.cfg, db));
    assert.equal(out.ok, false);
    assert.match(out.content, /QUANT_ENGINE_CHANGED/);
    assert.equal((db.prepare('SELECT robustness_json j FROM quant_runs').get() as any).j, null);
  } finally { db.close(); }
});

test('validate_quant_run reports an unknown run', async () => {
  const fake = await fakeFinsight();
  try { assert.match((await buildRegistry().execute('validate_quant_run', { runId: 'qr_missing' }, testCtx(testConfig(fake)))).content, /NOT_FOUND/); }
  finally { await fake.close(); }
});

test('a validated 50-symbol run stays within one tool result when read back', needsWorker, async () => {
  const fake = await fakeFinsight();
  try {
    const registry = buildRegistry(), ctx = testCtx(testConfig(fake));
    const symbols = Array.from({ length: 50 }, (_, i) => `S${String(i).padStart(2, '0')}A`);
    const saved = content(await registry.execute('backtest_portfolio', { strategy: 'matrend', symbols, years: 1, positionPct: 2, maxPositions: 50 }, ctx));
    content(await registry.execute('validate_quant_run', { runId: saved.runId }, ctx));
    for (const detail of ['run', 'robustness']) assert.ok(content(await registry.execute('get_quant_run', { runId: saved.runId, detail }, ctx)).runId);
  } finally { await fake.close(); }
});

// ---- Quant Lab API ----

async function labApi() {
  const fake = await fakeFinsight();
  const cfg = testConfig(fake);
  const db = openDb(':memory:'), bus = new EventBus(db), tools = buildRegistry(), finsight = finsightClient(cfg.finsightUrl, cfg.finsightDataDir);
  const engine = new ChatEngine({ cfg, db, tools, brains: new Map(), finsight, bus });
  const probe = http.createServer().listen(0, '127.0.0.1');
  await new Promise((r) => probe.once('listening', r));
  cfg.port = (probe.address() as AddressInfo).port;
  await new Promise((r) => probe.close(r));
  const server = createApi({ cfg, db, engine, bus, brains: new Map(), brainsInvalid: [], tools, finsight });
  await new Promise<void>((r) => server.listen(cfg.port, '127.0.0.1', r));
  const call = async (path: string, body?: unknown, signal?: AbortSignal) => {
    const res = await fetch(`http://127.0.0.1:${cfg.port}${path}`, { method: body === undefined ? 'GET' : 'POST', signal, headers: { 'x-agent-secret': PROXY_SECRET, 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, body: await res.json() as any };
  };
  return { call, close: async () => { server.closeAllConnections(); server.close(); db.close(); await fake.close(); } };
}

test('Quant Lab API runs, checks, reads the whole study and reproduces', needsWorker, async () => {
  const lab = await labApi();
  try {
    assert.deepEqual((await lab.call('/v1/quant/runs')).body.runs, []);
    const created = await lab.call('/v1/quant/runs', savedArgs);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    assert.deepEqual(Object.keys(created.body), ['runId']);
    const { runId } = created.body;

    const unchecked = await lab.call(`/v1/quant/runs/${runId}`);
    assert.equal(unchecked.body.robustness, null);
    assert.equal(unchecked.body.series, undefined, 'stored price series stay on the agent');

    const checked = await lab.call(`/v1/quant/runs/${runId}/validate`, {});
    assert.equal(checked.status, 200, JSON.stringify(checked.body));
    const { pass, fail, insufficient } = checked.body.summary;
    assert.equal(pass + fail + insufficient, 6);

    const full = (await lab.call(`/v1/quant/runs/${runId}`)).body;
    assert.equal(full.robustness.checks.length, 6);
    assert.ok(full.robustness.bootstrap.intervals.excessCagrPct, 'the tables a chat read leaves out are here');
    assert.ok(full.robustness.cost.grid.length > 0);
    assert.ok(full.monthlyEquity.length > 0);

    const [row] = (await lab.call('/v1/quant/runs')).body.runs;
    assert.equal(row.runId, runId);
    assert.deepEqual(row.robustnessChecks, checked.body.summary);
    assert.equal(row.settings.positionPct, 20);

    const again = await lab.call(`/v1/quant/runs/${runId}/reproduce`, {});
    assert.equal(again.body.reproduced, true, JSON.stringify(again.body));
    assert.equal(again.body.stored, undefined);
  } finally { await lab.close(); }
});

test('Quant Lab API refuses bad input, unknown runs and a second job at once', needsWorker, async () => {
  const lab = await labApi();
  try {
    assert.equal((await lab.call('/v1/quant/runs', { strategy: 'matrend', symbols: [] })).status, 400);
    const missing = await lab.call('/v1/quant/runs/qr_doesnotexist');
    assert.equal(missing.body.error.code, 'NOT_FOUND');
    assert.equal((await lab.call('/v1/quant/runs/not-a-run')).status, 404);
    assert.equal((await lab.call('/v1/quant/runs/qr_doesnotexist/delete', {})).status, 404);

    const first = lab.call('/v1/quant/runs', savedArgs);
    await new Promise((r) => setTimeout(r, 30));
    const second = await lab.call('/v1/quant/runs', savedArgs);
    assert.equal(second.status, 409);
    assert.equal(second.body.error.code, 'QUANT_BUSY');
    assert.equal((await first).status, 201);
    assert.equal((await lab.call('/v1/quant/runs', savedArgs)).status, 201, 'the lock is released afterwards');
  } finally { await lab.close(); }
});

test('Quant Lab API stops the job when the browser cancels, and accepts the next one', needsWorker, async () => {
  const lab = await labApi();
  try {
    const stop = new AbortController();
    const cancelled = lab.call('/v1/quant/runs', savedArgs, stop.signal).catch((e: Error) => e.name);
    await new Promise((r) => setTimeout(r, 30));
    stop.abort();
    assert.equal(await cancelled, 'AbortError');
    let next = await lab.call('/v1/quant/runs', savedArgs);
    for (let i = 0; next.status === 409 && i < 50; i++) { await new Promise((r) => setTimeout(r, 100)); next = await lab.call('/v1/quant/runs', savedArgs); }
    assert.equal(next.status, 201, JSON.stringify(next.body));
    assert.equal((await lab.call('/v1/quant/runs')).body.runs.length, 1, 'the cancelled run was not saved');
  } finally { await lab.close(); }
});
