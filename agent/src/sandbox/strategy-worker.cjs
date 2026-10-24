'use strict';
// Strategy sandbox worker. Runs under Node's permission model (see host.ts):
// read access only to this file and the strategy folders; no network, no file
// writes, no child processes, no workers. Receives one batch of jobs over IPC
// and replies with compact results. Engines are the SAME code the FinSight
// chart runs (public/strategies.js); private plugins follow the same run() API.
const path = require('path');
const fs = require('fs');

const Module = require('module');

const [, , builtinDir, privateDir] = process.argv;
const engines = new Map(); // id -> { meta, run }

// Node 24's permission model restricts files, child processes, workers and
// native bindings but not the network, so engines also lose network-capable
// modules and globals here. Strategy engines are pure functions over bars.
const DENY = new Set(['net', 'http', 'https', 'http2', 'tls', 'dgram', 'dns', 'child_process', 'worker_threads', 'cluster',
  'inspector', 'vm', 'module', 'fs', 'fs/promises', 'v8', 'repl', 'diagnostics_channel', 'undici']);
const origLoad = Module._load;
function lockDown() {
  Module._load = function (request, parent, isMain) {
    const name = String(request).replace(/^node:/, '');
    if (DENY.has(name) || DENY.has(name.split('/')[0])) throw new Error(`module "${request}" is not allowed in strategy engines`);
    return origLoad.call(this, request, parent, isMain);
  };
  for (const g of ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'Request', 'Response', 'Headers']) {
    try { Object.defineProperty(globalThis, g, { value: undefined, configurable: false, writable: false }); } catch { /* already absent */ }
  }
}

function loadBuiltin() {
  const lib = require(path.join(builtinDir, 'strategies.js'));
  for (const s of lib.list()) engines.set(s.id, { meta: { ...s, origin: 'builtin' }, run: (bars) => lib.run(s.id, bars) });
}

function loadPrivate() {
  if (!privateDir) return [];
  let dirs = [];
  try { dirs = fs.readdirSync(privateDir, { withFileTypes: true }).filter((d) => d.isDirectory()); } catch { return []; }
  const invalid = [];
  for (const d of dirs) {
    const dir = path.join(privateDir, d.name);
    try {
      const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      if (m.apiVersion !== 1 || m.kind !== 'strategy' || !/^[a-z0-9-]{2,40}$/.test(m.id || '')) throw new Error('manifest: need apiVersion 1, kind "strategy", id [a-z0-9-]');
      if (engines.has(m.id)) throw new Error(`id ${m.id} already used`);
      const meta = { id: m.id, name: m.name || m.id, kind: m.type === 'discretionary' ? 'checklist' : 'trade', summary: m.summary || '', rules: m.rules || [], version: m.version, status: m.status, origin: 'private' };
      if (m.engine) {
        const file = path.resolve(dir, String(m.engine));
        if (!file.startsWith(dir + path.sep) || !/\.c?js$/.test(file)) throw new Error('engine must be a .js file inside the plugin folder');
        const mod = require(file);
        if (typeof mod.run !== 'function') throw new Error('engine must export run(bars, params)');
        engines.set(m.id, { meta, run: (bars) => mod.run(bars, m.params || {}) });
      } else engines.set(m.id, { meta, run: null });
    } catch (e) { invalid.push({ id: d.name, error: String(e && e.message || e) }); }
  }
  return invalid;
}

const r4 = (n) => (typeof n === 'number' && isFinite(n) ? Math.round(n * 1e4) / 1e4 : n == null ? null : n);
function compact(res, bars) {
  const last = bars.length ? bars[bars.length - 1] : null;
  const date = (i) => (bars[i] ? new Date(bars[i].t).toISOString().slice(0, 10) : null);
  const tr = (t) => t && ({ entryDate: date(t.entryIdx), entry: r4(t.entry), stop: r4(t.stop), exitDate: t.exitIdx != null ? date(t.exitIdx) : null,
    exitWhy: t.exitWhy || null, R: r4(t.Rmult), retPct: r4(t.retPct != null ? t.retPct * 100 : null) });
  const setups = (res.setups || []).slice(-3).map((s) => ({ date: date(s.i), trigger: r4(s.trig), stop: r4(s.stop), type: s.type || null }));
  return {
    kind: res.kind, lastBar: last ? { date: date(bars.length - 1), close: r4(last.c) } : null,
    stage: res.stage ? { code: res.stage.code, label: res.stage.label, detail: res.stage.detail } : null,
    openTrade: tr(res.open), recentSetups: setups, trades: (res.trades || []).length,
    lastTrades: (res.trades || []).slice(-3).map(tr), stats: res.stats || null, measure: res.measure || null,
    tranches: res.tranches ? res.tranches.slice(-3) : undefined,
  };
}

process.on('message', (msg) => {
  try {
    lockDown();
    loadBuiltin();
    const invalid = loadPrivate();
    if (msg.op === 'list') {
      return process.send({ ok: true, strategies: [...engines.values()].map((e) => ({ ...e.meta, mechanical: !!e.run })), invalid });
    }
    if (msg.op === 'run') {
      const out = [];
      for (const job of msg.jobs) {
        const e = engines.get(job.id);
        if (!e) { out.push({ id: job.id, symbol: job.symbol, error: 'unknown strategy' }); continue; }
        if (!e.run) { out.push({ id: job.id, symbol: job.symbol, error: 'discretionary strategy: no engine, use its checklist' }); continue; }
        const bars = (job.bars || []).filter((b) => b && [b.o, b.h, b.l, b.c].every((x) => typeof x === 'number' && isFinite(x)));
        try { out.push({ id: job.id, symbol: job.symbol, ...compact(e.run(bars), bars) }); }
        catch (err) { out.push({ id: job.id, symbol: job.symbol, error: String(err && err.message || err) }); }
      }
      return process.send({ ok: true, results: out });
    }
    process.send({ ok: false, error: 'unknown op' });
  } catch (e) {
    process.send({ ok: false, error: String(e && e.message || e) });
  }
});
