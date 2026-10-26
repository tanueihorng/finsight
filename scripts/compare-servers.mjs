#!/usr/bin/env node
// Phase 6 behaviour gate: runs two FinSight checkouts side by side (fake market,
// fresh temp stores, no agent) and replays one scripted session against both in
// lockstep: every API route, error paths, auth, static files. It compares
// status, the headers that matter, bodies and the final store files, and exits
// 1 on any difference that is not explicitly allowed.
//
//   node scripts/compare-servers.mjs --a <checkout> --b <checkout> [--allow <file.json>] [--verbose]
//
// Each side runs <checkout>/server.ts if present, else server.js, with the
// same virtual clock and random seed (compare-clock.mjs), so timestamps and
// most ids must match exactly. Values random by design are matched, not
// erased: crypto ids by a per-side bijection, session tokens and ETags by
// shape. The allow file lists intended differences: [{ "step": "...", "path": "..." }].
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const A = opt('--a'), B = opt('--b'), verbose = args.includes('--verbose');
if (!A || !B) { console.error('usage: compare-servers.mjs --a <checkout> --b <checkout> [--allow file.json] [--verbose]'); process.exit(2); }
const allow = opt('--allow') ? JSON.parse(fs.readFileSync(opt('--allow'), 'utf8')) : [];

// Both servers share one virtual clock start and seeded Math.random (compare-clock.mjs).
const CLOCK = new URL('./compare-clock.mjs', import.meta.url).href;
const T0 = Math.floor(Date.now() / 864e5) * 864e5 + 2 * 3600e3; // today 02:00 UTC, same for both sides
const freePort = () => new Promise((r) => { const s = http.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function request(port, method, p, headers = {}, body) {
  return new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port, method, path: p, agent: false, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
      const chunks = []; res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, buf: Buffer.concat(chunks) }));
    });
    r.on('error', reject); if (body !== undefined) r.write(body); r.end();
  });
}

async function startSide(name, root) {
  const entry = fs.existsSync(path.join(root, 'server.ts')) ? 'server.ts' : 'server.js';
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `finsight-cmp-${name}-`));
  const port = await freePort(), out = [];
  const child = spawn(process.execPath, ['--import', CLOCK, entry], {
    cwd: root, stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, FINSIGHT_DATA_DIR: dataDir, PORT: String(port), FINSIGHT_FAKE_MARKET: '1', NOTIFY: '0', FINSIGHT_CACHE_PERSIST: '0',
      ALERT_INTERVAL: '3600', AGENT_AUTOSTART: '0', AGENT_URL: 'http://127.0.0.1:9', TZ: process.env.TZ || 'Asia/Singapore', COMPARE_T0: String(T0) },
  });
  child.stdout.on('data', (c) => out.push(String(c))); child.stderr.on('data', (c) => out.push(String(c)));
  const exited = new Promise((r) => child.on('exit', (code, signal) => r({ code, signal })));
  for (let i = 0; ; i++) {
    try { await request(port, 'GET', '/api/health'); break; } catch {
      if (i > 400 || child.exitCode !== null) throw new Error(`${name} did not start:\n${out.join('')}`);
      await sleep(25);
    }
  }
  return { name, root, entry, dataDir, port, child, exited, out, cookie: '', last: {} };
}

// ---- the scripted session ------------------------------------------------
// A step is { name, method, path, body?, headers?, auth? } or a function of the
// side's context (ids differ per side and come from that side's own responses).
const J = (o) => JSON.stringify(o);
const IBKR = [
  'Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Quantity,Mult,Cost Price',
  'Open Positions,Data,Summary,Stocks,USD,AAPL,10,1,180',
  'Open Positions,Data,Summary,Stocks,SGD,D05,100,1,35.5',
  'Dividends,Header,Currency,Date,Description,Amount',
  'Dividends,Data,USD,2025-05-15,AAPL(US0378331005) Cash Dividend USD 0.26 per Share,2.60',
  'Withholding Tax,Data,USD,2025-05-15,AAPL(US0378331005) Cash Dividend USD 0.26 per Share - US Tax,-0.78,',
].join('\n');
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

function steps() {
  const s = [];
  const get = (name, p, extra = {}) => s.push({ name, method: 'GET', path: p, auth: true, ...extra });
  const post = (name, p, body, extra = {}) => s.push({ name, method: 'POST', path: p, body: body === undefined ? undefined : (typeof body === 'string' ? body : J(body)), auth: true, ...extra });

  // Before a PIN exists: everything gated, static public.
  get('health', '/api/health', { auth: false });
  get('status-fresh', '/api/auth/status', { auth: false });
  get('gated-portfolio', '/api/portfolio', { auth: false });
  get('gated-agent-status', '/api/agent-status', { auth: false });
  post('setup-bad', '/api/auth/setup', { pin: 'abc' }, { auth: false });
  post('login-before-pin', '/api/auth/login', { pin: '1234' }, { auth: false });
  post('setup', '/api/auth/setup', { pin: '482916' }, { auth: false, keepCookie: true });
  post('setup-again', '/api/auth/setup', { pin: '111111' });
  get('status-authed', '/api/auth/status');

  // Static delivery.
  for (const p of ['/', '/index.html', '/sw.js', '/styles.css', '/chart.js', '/indicators.js', '/app/manifest.json', '/app/main.js', '/app/bootstrap.js', '/manifest.webmanifest', '/missing.js',
    '/../package.json', '/..%2fpackage.json', '/%2e%2e/server.js', '/app/../../lib/config.ts']) get('static ' + p, p, { auth: false });
  s.push((ctx) => ({ name: 'static chunks', method: 'GET', path: '/app/manifest.json', auth: false, expand: JSON.parse(ctx.last['static /app/manifest.json'].buf).files }));
  s.push((ctx) => ({ name: 'static 304', method: 'GET', path: '/sw.js', auth: false, headers: { 'if-none-match': ctx.last['static /sw.js'].headers.etag } }));
  get('foreign host', '/api/health', { auth: false, headers: { host: 'evil.example' } });

  // Market and macro data (fake market).
  get('quote', '/api/quote?symbols=AAPL,MSFT,D05.SI,NOPE1,EURUSD=X');
  get('quote-empty', '/api/quote?symbols=');
  for (const [r, i] of [['1mo', '1d'], ['1y', '1d'], ['5d', '1h'], ['max', '1wk']]) get(`history ${r} ${i}`, `/api/history?symbol=AAPL&range=${r}&interval=${i}`);
  get('history-missing', '/api/history');
  get('history-unknown', '/api/history?symbol=NOPE1');
  get('batch', '/api/history/batch?symbols=aapl,MSFT,NOPE1,D05.SI&range=6mo');
  get('batch-empty', '/api/history/batch?symbols=');
  get('search', '/api/search?q=app'); get('search-empty', '/api/search?q=');
  get('markets', '/api/markets'); get('news', '/api/news'); get('news-sym', '/api/news?symbol=AAPL');
  get('worldbank', '/api/worldbank'); get('worldbank-us', '/api/worldbank?country=US&indicator=FP.CPI.TOTL.ZG');
  get('fred', '/api/fred'); get('fred-yoy', '/api/fred?series=CPIAUCSL&transform=pc1&start=2020-01-01');
  get('calendar', '/api/calendar');
  get('categories', '/api/categories?symbols=AAPL,MSFT,VOO'); get('categories-empty', '/api/categories');

  // Accounts and trades.
  get('accounts', '/api/accounts');
  post('acct-add', '/api/accounts/add', { name: 'Taxable', type: 'Brokerage' });
  s.push((ctx) => ({ name: 'acct-rename', method: 'POST', path: '/api/accounts/rename', auth: true, body: J({ id: ctx.json('acct-add').newId, name: 'Taxable 2', type: 'IRA' }) }));
  post('acct-add-2', '/api/accounts/add', { name: 'Scratch' });
  s.push((ctx) => ({ name: 'acct-remove', method: 'POST', path: '/api/accounts/remove', auth: true, body: J({ id: ctx.json('acct-add-2').newId }) }));
  post('acct-remove-bad', '/api/accounts/remove', { id: 'nope' });
  for (const [sym, q, px, d] of [['AAPL', 10, 150, day(400)], ['AAPL', 5.5, 170.25, day(90)], ['MSFT', 3, 300, null], ['D05.SI', 100, 30, day(200)], ['VOO', 2, 400, day(30)]]) {
    post(`buy ${sym} ${q}`, '/api/portfolio/buy?base=SGD&account=main', { symbol: sym, quantity: q, price: px, ...(d ? { date: d } : {}) });
  }
  post('buy-bad-symbol', '/api/portfolio/buy?account=main', { symbol: '=cmd', quantity: 1, price: 1 });
  post('buy-bad-qty', '/api/portfolio/buy?account=main', { symbol: 'AAPL', quantity: -1, price: 1 });
  post('buy-all', '/api/portfolio/buy?account=ALL', { symbol: 'AAPL', quantity: 1, price: 1 });
  post('buy-malformed', '/api/portfolio/buy?account=main', '{bad');
  post('sell partial', '/api/portfolio/sell?base=USD&account=main', { symbol: 'AAPL', quantity: 4, price: 190 });
  post('sell too many', '/api/portfolio/sell?account=main', { symbol: 'MSFT', quantity: 99, price: 1 });
  post('sell all VOO', '/api/portfolio/sell?base=SGD&account=main', { symbol: 'VOO', quantity: 2, price: 420 });
  post('delete MSFT', '/api/portfolio/delete?account=main', { symbol: 'MSFT' });
  s.push((ctx) => ({ name: 'import ibkr', method: 'POST', path: `/api/portfolio/import?base=USD&account=${ctx.json('acct-add').newId}`, auth: true, body: J({ csv: IBKR }) }));
  post('import simple', '/api/portfolio/import?account=main', { csv: 'Symbol,Quantity,Price,Date\nTSM,4,150,2025-01-02\nBAD SYM,1,1,\nNVDA,x,1,' });
  // More than the 50 transactions the portfolio response lists.
  post('import many', '/api/portfolio/import?account=main', { csv: 'Symbol,Quantity,Price,Date\n' + Array.from({ length: 55 }, (_, i) => `AMD,${i + 1},${100 + i},2025-0${1 + (i % 9)}-1${i % 10}`).join('\n') });
  post('cash', '/api/cash?base=SGD&account=main', { ccy: 'USD', amount: 1234.5 });
  post('cash-sgd', '/api/cash?base=SGD&account=main', { ccy: 'SGD', amount: 800 });
  post('cash-bad', '/api/cash?account=main', { ccy: 'XX', amount: 'abc' });
  get('dividends default rates', '/api/dividends?base=USD&account=ALL');
  post('withholding', '/api/settings/withholding', { market: 'US', pct: 15 });
  post('withholding-bad', '/api/settings/withholding', { market: 'MARS', pct: 5 });
  for (const base of ['SGD', 'USD', 'EUR']) for (const acct of ['main', 'ALL']) get(`portfolio ${base} ${acct}`, `/api/portfolio?base=${base}&account=${acct}`);
  get('portfolio-default', '/api/portfolio');
  for (const acct of ['main', 'ALL']) {
    get(`fx-risk ${acct}`, `/api/fx-risk?base=SGD&account=${acct}`);
    get(`dividends ${acct}`, `/api/dividends?base=USD&account=${acct}`);
    get(`events ${acct}`, `/api/events?account=${acct}`);
    get(`ledger ${acct}`, `/api/ledger?base=SGD&account=${acct}`);
    get(`realized ${acct}`, `/api/realized?base=SGD&account=${acct}`);
    for (const r of ['1mo', '1y', 'max']) get(`performance ${r} ${acct}`, `/api/portfolio/performance?range=${r}&base=SGD&account=${acct}`);
  }
  get('performance-bench', '/api/portfolio/performance?range=1y&base=USD&account=main&benchmark=^GSPC');
  get('chart-trades', '/api/chart-trades?symbol=AAPL&account=main');
  s.push((ctx) => {
    const buyRow = (ctx.json('ledger main').trades || ctx.json('ledger main').rows || []).find((t) => t.type === 'BUY' && t.symbol === 'D05.SI');
    return { name: 'ledger-edit', method: 'POST', path: '/api/ledger/edit?base=SGD', auth: true, body: J({ id: buyRow && buyRow.id, quantity: 120, price: 31, date: day(180) }) };
  });
  post('ledger-edit-bad', '/api/ledger/edit', { id: 'nope', quantity: 1 });
  s.push((ctx) => {
    const buyRow = (ctx.json('ledger main').trades || ctx.json('ledger main').rows || []).find((t) => t.type === 'BUY' && t.symbol === 'AAPL');
    return { name: 'ledger-delete', method: 'POST', path: '/api/ledger/delete', auth: true, body: J({ id: buyRow && buyRow.id }) };
  });
  get('ledger after', '/api/ledger?base=SGD&account=main');
  get('undo-info', '/api/undo');
  post('undo', '/api/undo'); post('undo-2', '/api/undo');
  get('portfolio after undo', '/api/portfolio?base=SGD&account=main');

  // Watchlist and alerts.
  post('watch-add', '/api/watchlist/add', { symbol: 'NVDA' }); post('watch-add-2', '/api/watchlist/add', { symbol: 'btc-usd' });
  post('watch-bad', '/api/watchlist/add', {}); post('watch-remove', '/api/watchlist/remove', { symbol: 'NVDA' });
  get('watchlist', '/api/watchlist');
  post('alert-add', '/api/alerts/add', { symbol: 'AAPL', op: '>', price: 1 });
  post('alert-add-2', '/api/alerts/add', { symbol: 'MSFT', op: 'below', price: 100000, note: 'n' });
  post('alert-bad', '/api/alerts/add', { symbol: 'AAPL', price: -1 });
  post('alert-line', '/api/alerts/add', { symbol: 'AAPL', kind: 'line', line: { pts: [{ t: Date.UTC(2026, 0, 2), p: 100 }, { t: Date.UTC(2026, 5, 1), p: 200 }], interval: '1d' } });
  s.push((ctx) => ({ name: 'alert-update', method: 'POST', path: '/api/alerts/update', auth: true, body: J({ id: ctx.json('alert-add').alerts[0].id, price: 2 }) }));
  s.push((ctx) => ({ name: 'alert-remove', method: 'POST', path: '/api/alerts/remove', auth: true, body: J({ id: ctx.json('alert-add-2').alerts[1].id }) }));
  get('alerts', '/api/alerts');

  // Chart workspace and journal.
  post('drawings', '/api/charts/drawings', { symbol: 'AAPL', drawings: [{ id: 'd1', type: 'hline', pts: [{ t: 1, p: 100 }] }] });
  get('drawings-get', '/api/charts/drawings?symbol=AAPL'); post('drawings-bad', '/api/charts/drawings', { symbol: 'AAPL', drawings: 'x' });
  post('chart-current', '/api/charts/current', { cfg: { interval: '1d', indicators: ['sma'] } });
  post('layout-save', '/api/charts/layouts/save', { name: 'mine', cfg: { interval: '1wk' } });
  get('layouts', '/api/charts/layouts'); post('layout-delete', '/api/charts/layouts/delete', { name: 'mine' });
  post('journal-create', '/api/journal/create', { symbol: 'AAPL', kind: 'paper', side: 'long', entry: 100, stop: 95, target: 115, qty: 10, exits: [{ qty: 4, price: 110 }], notes: '=SUM(A1)' });
  post('journal-bad', '/api/journal/create', { symbol: 'AAPL', side: 'long', entry: 100, stop: 105 });
  s.push((ctx) => ({ name: 'journal-update', method: 'POST', path: '/api/journal/update', auth: true, body: J({ id: ctx.json('journal-create').entry.id, entry: { exits: [{ qty: 10, price: 112 }], status: 'closed' } }) }));
  const png = 'data:image/png;base64,' + Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000', 'hex').toString('base64');
  s.push((ctx) => ({ name: 'journal-image', method: 'POST', path: '/api/journal/image', auth: true, body: J({ id: ctx.json('journal-create').entry.id, dataUrl: png }) }));
  s.push((ctx) => ({ name: 'journal-image-get', method: 'GET', path: '/api/journal/image?id=' + ctx.json('journal-create').entry.id, auth: true }));
  get('journal', '/api/journal'); get('journal-csv', '/api/journal/csv');
  s.push((ctx) => ({ name: 'journal-delete', method: 'POST', path: '/api/journal/delete', auth: true, body: J({ id: ctx.json('journal-create').entry.id }) }));

  // Agent (offline) and unknown routes.
  get('agent-status', '/api/agent-status'); get('agent-proxy', '/api/agent/v1/info');
  get('unknown', '/api/nope'); get('get-on-post', '/api/portfolio/buy');
  post('reset other', '/api/portfolio/reset?account=main');

  // Auth lifecycle last.
  post('change-wrong', '/api/auth/change', { current: '000000', pin: '135790' });
  post('change', '/api/auth/change', { current: '482916', pin: '135790' }, { keepCookie: true });
  post('logout', '/api/auth/logout');
  get('after-logout', '/api/portfolio');
  for (let i = 1; i <= 6; i++) post(`login-wrong ${i}`, '/api/auth/login', { pin: '000000' }, { auth: false });
  return s;
}

// ---- comparison ----------------------------------------------------------
// crypto.randomBytes(8) ids (journal entries): random by design on each side.
const ID_RE = /^(?=.*\d)[0-9a-f]{16}$/;
class Ids { constructor() { this.ab = new Map(); this.ba = new Map(); } match(a, b) {
  if (this.ab.has(a) || this.ba.has(b)) return this.ab.get(a) === b && this.ba.get(b) === a;
  this.ab.set(a, b); this.ba.set(b, a); return true;
} }
const ids = new Ids();

function diffValue(a, b, p, out) {
  if (a === b) return;
  if (typeof a === 'string' && typeof b === 'string') {
    if (ID_RE.test(a) && ID_RE.test(b) && ids.match(a, b)) return;
  }
  if (a && b && typeof a === 'object' && typeof b === 'object' && Array.isArray(a) === Array.isArray(b)) {
    if (Array.isArray(a)) {
      if (a.length !== b.length) out.push({ path: p, a: `length ${a.length}`, b: `length ${b.length}` });
      for (let i = 0; i < Math.min(a.length, b.length); i++) diffValue(a[i], b[i], `${p}[${i}]`, out);
      return;
    }
    // Keys that are generated ids (e.g. results by id) map like values.
    const ka = Object.keys(a), kb = Object.keys(b);
    if (ka.length !== kb.length || ka.some((k, i) => k !== kb[i] && !(ID_RE.test(k) && ID_RE.test(kb[i]) && ids.match(k, kb[i])))) {
      out.push({ path: p + ' (keys)', a: ka.join(','), b: kb.join(',') });
    }
    for (let i = 0; i < Math.min(ka.length, kb.length); i++) diffValue(a[ka[i]], b[kb[i]], `${p}.${ka[i]}`, out);
    return;
  }
  out.push({ path: p, a: JSON.stringify(a)?.slice(0, 200), b: JSON.stringify(b)?.slice(0, 200) });
}

const HEADERS = ['content-type', 'cache-control', 'content-disposition', 'x-frame-options', 'x-content-type-options', 'set-cookie', 'etag', 'content-length'];
function shapeHeader(k, v) {
  if (v === undefined) return undefined;
  if (k === 'set-cookie') return [].concat(v).map((c) => c.replace(/^sid=[0-9a-f]{48}/, 'sid=<token>'));
  if (k === 'etag') return /^W\/"[0-9a-z]+-[0-9a-z]+"$/.test(v) ? 'W/"<size>-<mtime>"' : v;
  return v;
}
// The checkout and data folder differ per side by construction.
const local = (text, side) => text.split(side.dataDir).join('<data>').split(side.root).join('<root>');
function body(res, side) {
  const ct = String(res.headers['content-type'] || '');
  if (ct.startsWith('application/json')) { const t = local(res.buf.toString('utf8'), side); try { return JSON.parse(t); } catch { return { '<invalid json>': t }; } }
  if (ct.startsWith('text/csv')) return local(res.buf.toString('utf8'), side);
  return { sha256: crypto.createHash('sha256').update(res.buf).digest('hex'), bytes: res.buf.length };
}
function compareResponse(step, ra, rb, out) {
  const d = [];
  if (ra.status !== rb.status) d.push({ path: 'status', a: ra.status, b: rb.status });
  for (const k of HEADERS) {
    if (k === 'content-length' && String(ra.headers['content-type'] || '').startsWith('application/json')) continue; // follows the body
    diffValue(shapeHeader(k, ra.headers[k]), shapeHeader(k, rb.headers[k]), 'header ' + k, d);
  }
  diffValue(body(ra, ra.side), body(rb, rb.side), 'body', d);
  for (const x of d) out.push({ step, ...x });
}

function storeFiles(dir) {
  const files = {};
  (function walk(rel) {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const r = path.join(rel, e.name);
      if (e.isDirectory()) walk(r);
      else {
        const buf = fs.readFileSync(path.join(dir, r));
        files[r] = { raw: buf.toString('utf8'), json: r.endsWith('.json') ? JSON.parse(buf.toString('utf8')) : { sha256: crypto.createHash('sha256').update(buf).digest('hex') },
          mode: (fs.statSync(path.join(dir, r)).mode & 0o777).toString(8) };
      }
    }
  })('');
  return files;
}
const SECRET_FILES = { 'auth.json': (j) => ({ keys: Object.keys(j).sort() }), 'agent-link.json': (j) => ({ keys: Object.keys(j).sort() }) };

// ---- run -----------------------------------------------------------------
const sides = [await startSide('a', path.resolve(A)), await startSide('b', path.resolve(B))];
const diffs = [];
let count = 0;
try {
  for (const raw of steps()) {
    const perSide = sides.map((side) => {
      side.json = (name) => JSON.parse(side.last[name].buf.toString('utf8'));
      return typeof raw === 'function' ? raw(side) : raw;
    });
    const name = perSide[0].name;
    const expand = perSide.map((st) => st.expand || [null]);
    for (let k = 0; k < expand[0].length; k++) {
      const results = [];
      for (const [i, side] of sides.entries()) {
        const st = perSide[i];
        const p = expand[i][k] ? expand[i][k] : st.path;
        const headers = { ...(st.body !== undefined ? { 'content-type': 'application/json' } : {}), ...(st.auth && side.cookie ? { cookie: side.cookie } : {}), ...(st.headers || {}) };
        const res = await request(side.port, st.method, p, headers, st.body);
        if (!expand[i][k]) side.last[name] = res;
        if (st.keepCookie && res.headers['set-cookie']) side.cookie = String(res.headers['set-cookie']).split(';')[0];
        res.side = side; results.push(res);
        count++;
      }
      const label = expand[0][k] ? `${name} ${expand[0][k]}` : name;
      if (verbose) console.log(`  ${results[0].status} ${label}${results[0].status >= 400 ? '  ' + results[0].buf.toString('utf8').slice(0, 90) : ''}`);
      compareResponse(label, results[0], results[1], diffs);
    }
  }
  // Final stores (after a graceful stop, so shutdown writes are included).
  const stops = await Promise.all(sides.map((s) => { s.child.kill('SIGTERM'); return s.exited; }));
  diffValue(stops[0], stops[1], 'exit', diffs);
  const [fa, fb] = sides.map((s) => storeFiles(s.dataDir));
  for (const f of [...new Set([...Object.keys(fa), ...Object.keys(fb)])].sort()) {
    const shape = SECRET_FILES[f] || ((x) => x);
    if (!(f in fa) || !(f in fb)) { diffs.push({ step: 'store', path: f, a: f in fa ? 'present' : 'missing', b: f in fb ? 'present' : 'missing' }); continue; }
    const d = [];
    diffValue(fa[f].mode, fb[f].mode, f + ' (mode)', d);
    diffValue(shape(fa[f].json), shape(fb[f].json), f, d);
    // Same content must also be the same bytes (formatting is file format),
    // once ids that are random by design are mapped.
    if (!d.length && !SECRET_FILES[f]) {
      let raw = fa[f].raw;
      for (const [x, y] of ids.ab) raw = raw.split(x).join(y);
      if (raw !== fb[f].raw) d.push({ path: f + ' (bytes)', a: `${fa[f].raw.length} bytes`, b: `${fb[f].raw.length} bytes` });
    }
    diffs.push(...d.map((x) => ({ step: 'store', ...x })));
    if (verbose && !d.length) console.log(`  store ${f}: same`);
  }
} finally {
  for (const s of sides) if (s.child.exitCode === null) s.child.kill('SIGKILL');
}

const allowed = (d) => allow.some((x) => x.step === d.step && (!x.path || d.path.startsWith(x.path)));
const unexpected = diffs.filter((d) => !allowed(d));
console.log(`compare-servers: ${count / 2} requests per side; a=${sides[0].root}/${sides[0].entry} b=${sides[1].root}/${sides[1].entry}`);
for (const d of diffs) console.log(`${allowed(d) ? 'allowed' : 'DIFF   '} [${d.step}] ${d.path}\n    a: ${d.a}\n    b: ${d.b}`);
console.log(unexpected.length ? `FAIL: ${unexpected.length} unexpected difference(s), ${diffs.length - unexpected.length} allowed` : `PASS: no unexpected differences (${diffs.length} allowed)`);
process.exit(unexpected.length ? 1 : 0);
