'use strict';
// HTTP behaviour of the real server (Phase 6 regression tranche): auth, the
// session gate, static delivery, body parsing, batch history, the IBKR import
// storage path, persistence across a restart and graceful shutdown. Each case
// runs its own child server on a temp data dir with the fake market. Oracles
// are what the JavaScript server does today; S1 must keep them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const { startServer, setup, request, cookieOf, json } = require('./serverproc');

const PROBE = path.join(__dirname, 'fetchprobe.mjs');
const listening = (port) => new Promise((r) => { const q = http.get({ host: '127.0.0.1', port, path: '/api/health' }, (res) => { res.resume(); r(true); }); q.on('error', () => r(false)); });

test('the API fails closed before a PIN exists; setup issues a strict session cookie once', async (t) => {
  const s = await startServer(); t.after(() => s.stop());
  assert.deepEqual((await s.req('GET', '/api/auth/status')).json, { pinSet: false, authed: false });
  const locked = await s.req('GET', '/api/portfolio');
  assert.equal(locked.status, 401); assert.deepEqual(locked.json, { error: 'Locked. Enter your PIN.' });
  assert.equal(locked.headers['cache-control'], 'no-store');

  const bad = await s.req('POST', '/api/auth/setup', json(null, { pin: '12' }));
  assert.equal(bad.status, 400); assert.deepEqual(bad.json, { error: 'PIN must be 4–12 digits' });
  assert.equal(bad.headers['set-cookie'], undefined);

  const ok = await s.req('POST', '/api/auth/setup', json(null, { pin: '482916' }));
  assert.equal(ok.status, 200);
  assert.match(String(ok.headers['set-cookie']), /^sid=[0-9a-f]{48}; HttpOnly; SameSite=Strict; Path=\/$/);
  const c = cookieOf(ok);
  assert.deepEqual((await s.req('GET', '/api/auth/status', json(c))).json, { pinSet: true, authed: true });
  assert.equal((await s.req('GET', '/api/portfolio', json(c))).status, 200);

  const again = await s.req('POST', '/api/auth/setup', json(null, { pin: '111111' }));
  assert.equal(again.status, 400); assert.deepEqual(again.json, { error: 'A PIN is already set' });

  // The PIN is stored hashed, private to the user.
  const authFile = path.join(s.dataDir, 'auth.json');
  assert.equal(fs.statSync(authFile).mode & 0o777, 0o600);
  const auth = JSON.parse(fs.readFileSync(authFile, 'utf8'));
  assert.deepEqual(Object.keys(auth).sort(), ['createdAt', 'hash', 'salt']);
  assert.doesNotMatch(fs.readFileSync(authFile, 'utf8'), /482916/);

  const out = await s.req('POST', '/api/auth/logout', json(c));
  assert.deepEqual(out.headers['set-cookie'], ['sid=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0']);
  assert.equal((await s.req('GET', '/api/portfolio', json(c))).status, 401);
});

test('five wrong PINs return 401; the next attempt, even with the right PIN, is throttled', async (t) => {
  const s = await startServer(); t.after(() => s.stop());
  await setup(s);
  for (let i = 0; i < 5; i++) {
    const r = await s.req('POST', '/api/auth/login', json(null, { pin: '000000' }));
    assert.equal(r.status, 401, `attempt ${i + 1}`); assert.deepEqual(r.json, { error: 'Wrong PIN' });
  }
  const r = await s.req('POST', '/api/auth/login', json(null, { pin: '482916' }));
  assert.equal(r.status, 429); assert.match(r.json.error, /^Too many tries — wait 1[45]s$/);
  assert.equal(r.headers['set-cookie'], undefined);
});

test('PIN change checks the session and both PINs, then invalidates every other session', async (t) => {
  const s = await startServer(); t.after(() => s.stop());
  const a = await setup(s);
  const b = cookieOf(await s.req('POST', '/api/auth/login', json(null, { pin: '482916' })));
  assert.notEqual(a, b);

  assert.deepEqual((await s.req('POST', '/api/auth/change', json(null, { current: '482916', pin: '135790' }))).json, { error: 'Locked' });
  const wrong = await s.req('POST', '/api/auth/change', json(a, { current: '000000', pin: '135790' }));
  assert.equal(wrong.status, 401); assert.deepEqual(wrong.json, { error: 'Current PIN is wrong' });
  const invalid = await s.req('POST', '/api/auth/change', json(a, { current: '482916', pin: '12a4' }));
  assert.equal(invalid.status, 400); assert.deepEqual(invalid.json, { error: 'New PIN must be 4–12 digits' });
  assert.equal((await s.req('GET', '/api/portfolio', json(b))).status, 200, 'failed changes keep sessions');

  const ok = await s.req('POST', '/api/auth/change', json(a, { current: '482916', pin: '135790' }));
  assert.equal(ok.status, 200);
  const fresh = cookieOf(ok);
  assert.equal((await s.req('GET', '/api/portfolio', json(a))).status, 401);
  assert.equal((await s.req('GET', '/api/portfolio', json(b))).status, 401);
  assert.equal((await s.req('GET', '/api/portfolio', json(fresh))).status, 200);
  assert.equal((await s.req('POST', '/api/auth/login', json(null, { pin: '482916' }))).status, 401);
  assert.equal((await s.req('POST', '/api/auth/login', json(null, { pin: '135790' }))).status, 200);
});

test('only loopback Host names are answered; every response carries the frame/sniff headers', async (t) => {
  const s = await startServer(); t.after(() => s.stop());
  for (const host of ['evil.example', `evil.example:${s.port}`, '127.0.0.1.evil.example', '[::2]']) {
    for (const p of ['/api/health', '/index.html']) {
      const r = await request(s.port, 'GET', p, { headers: { host } });
      assert.equal(r.status, 403, `${host} ${p}`); assert.equal(r.text, 'Forbidden');
    }
  }
  for (const host of [`localhost:${s.port}`, `127.0.0.1:${s.port}`, `[::1]:${s.port}`, 'localhost']) {
    assert.equal((await request(s.port, 'GET', '/api/health', { headers: { host } })).status, 200, host);
  }
  for (const p of ['/api/health', '/api/portfolio', '/index.html', '/missing.js']) {
    const r = await s.req('GET', p);
    assert.equal(r.headers['x-frame-options'], 'DENY', p); assert.equal(r.headers['x-content-type-options'], 'nosniff', p);
  }
  const forbidden = await request(s.port, 'GET', '/api/health', { headers: { host: 'evil.example' } });
  assert.equal(forbidden.headers['x-frame-options'], 'DENY');
});

test('static files revalidate with an ETag; traversal never leaks a file outside public/', async (t) => {
  const s = await startServer(); t.after(() => s.stop());
  const first = await s.req('GET', '/sw.js');
  assert.equal(first.status, 200);
  assert.equal(first.headers['content-type'], 'text/javascript; charset=utf-8');
  assert.equal(first.headers['cache-control'], 'no-cache');
  assert.match(first.headers.etag, /^W\/"[0-9a-z]+-[0-9a-z]+"$/);
  const again = await s.req('GET', '/sw.js', { headers: { 'if-none-match': first.headers.etag } });
  assert.equal(again.status, 304); assert.equal(again.text, ''); assert.equal(again.headers.etag, first.headers.etag);
  assert.equal((await s.req('GET', '/sw.js', { headers: { 'if-none-match': 'W/"other"' } })).status, 200);
  const root = await s.req('GET', '/');
  assert.equal(root.status, 200); assert.equal(root.headers['content-type'], 'text/html; charset=utf-8');

  const secrets = [fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'), fs.readFileSync(path.join(__dirname, '..', 'lib', 'config.js'), 'utf8')];
  for (const p of ['/../package.json', '/..%2fpackage.json', '/%2e%2e/package.json', '/%2e%2e%2fpackage.json', '/app/../../package.json',
    '/../lib/config.js', '/..%2flib%2fconfig.js', '/.%2e/lib/config.js', '//etc/passwd', '/index.html%00', '/public/../package.json']) {
    const r = await s.req('GET', p);
    assert.notEqual(r.status, 200, p);
    for (const secret of secrets) assert.ok(!r.text.includes(secret.slice(0, 60)), `${p} leaked a file`);
  }
});

test('bodies: malformed or missing JSON reads as {}, UTF-8 split across chunks survives, unknown routes 404', async (t) => {
  const s = await startServer(); t.after(() => s.stop());
  const c = await setup(s);
  for (const body of ['{bad', undefined, '']) {
    const r = await s.req('POST', '/api/watchlist/add', { headers: { cookie: c, 'content-type': 'application/json' }, body });
    assert.equal(r.status, 500); assert.deepEqual(r.json, { error: 'Symbol required' });
  }
  const buy = await s.req('POST', '/api/portfolio/buy', { headers: { cookie: c }, body: '{bad' });
  assert.equal(buy.status, 500); assert.match(buy.json.error, /^Need a valid symbol/);
  assert.equal((await s.req('POST', '/api/journal/create', json(c, { symbol: '' }))).status, 400);
  assert.deepEqual((await s.req('POST', '/api/charts/drawings', json(c, { symbol: 'AAPL', drawings: 'x' }))).json, { error: 'drawings must be an array' });

  // A multi-byte character split between two TCP writes.
  const bytes = Buffer.from(JSON.stringify({ name: '投資組合 €', type: 'Brokerage' }), 'utf8');
  const cut = bytes.indexOf(Buffer.from('資', 'utf8')) + 1;
  const renamed = await new Promise((resolve, reject) => {
    const r = http.request({ host: '127.0.0.1', port: s.port, method: 'POST', path: '/api/accounts/add', headers: { host: `127.0.0.1:${s.port}`, cookie: c } }, (res) => {
      let b = ''; res.setEncoding('utf8'); res.on('data', (x) => (b += x)); res.on('end', () => resolve(JSON.parse(b)));
    });
    r.on('error', reject); r.write(bytes.subarray(0, cut)); setTimeout(() => r.end(bytes.subarray(cut)), 30);
  });
  assert.equal(renamed.accounts.find((a) => a.id === renamed.newId).name, '投資組合 €');

  assert.deepEqual((await s.req('GET', '/api/nope', json(c))).json, { error: 'Unknown endpoint' });
  assert.equal((await s.req('GET', '/api/portfolio/buy', json(c))).status, 404);
  assert.equal((await s.req('GET', '/missing.js')).status, 404);
});

test('history batch: limits, per-symbol failures, upper-case keys and at most six fetches in flight', async (t) => {
  const s = await startServer(); t.after(() => s.stop());
  const c = await setup(s);
  assert.deepEqual((await s.req('GET', '/api/history/batch?symbols=', json(c))).json, { error: 'symbols required' });
  assert.deepEqual((await s.req('GET', '/api/history/batch?symbols=' + Array.from({ length: 201 }, (_, i) => 'S' + i).join(','), json(c))).json, { error: 'at most 200 symbols' });
  assert.equal((await s.req('GET', '/api/history/batch?symbols=' + Array.from({ length: 200 }, (_, i) => 'S' + i).join(',') + ',S0', json(c))).status, 200, 'duplicates do not count toward the limit');

  const r = await s.req('GET', '/api/history/batch?symbols=aapl,AAPL,%20MSFT%20,NOPE1&range=1mo', json(c));
  assert.equal(r.status, 200);
  assert.equal(r.json.range, '1mo'); assert.equal(r.json.interval, '1d');
  assert.deepEqual(Object.keys(r.json.results).sort(), ['AAPL', 'MSFT', 'NOPE1']);
  assert.equal(r.json.results.AAPL.symbol, 'AAPL'); assert.ok(r.json.results.AAPL.points.length > 10);
  assert.equal(typeof r.json.results.NOPE1.error, 'string');
  const d = await s.req('GET', '/api/history/batch?symbols=MSFT', json(c));
  assert.equal(d.json.range, '1y'); assert.equal(d.json.interval, '1d');

  const probe = path.join(s.dataDir, 'probe.json');
  const p = await startServer({ args: ['--import', PROBE], env: { FETCH_PROBE_FILE: probe, FETCH_PROBE_DELAY: '40' } }); t.after(() => p.stop());
  const pc = await setup(p);
  const syms = ['NVDA', 'MSFT', 'AAPL', 'GOOGL', 'VOO', 'TSM', 'D05.SI', 'O39.SI', 'ES3.SI', 'AMD', 'AVGO', 'C6L.SI', 'TSLA', 'AMZN'];
  const before = fs.existsSync(probe) ? JSON.parse(fs.readFileSync(probe, 'utf8')).total : 0;
  const b = await p.req('GET', '/api/history/batch?range=6mo&symbols=' + syms.join(','), json(pc));
  assert.equal(Object.keys(b.json.results).length, syms.length);
  const seen = JSON.parse(fs.readFileSync(probe, 'utf8'));
  assert.ok(seen.total - before >= syms.length, 'every symbol was fetched');
  assert.equal(seen.max, 6);
});

test('an IBKR statement imports holdings and withholding through the store and the API', async (t) => {
  const s = await startServer(); t.after(() => s.stop());
  const c = await setup(s);
  const csv = [
    'Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Quantity,Mult,Cost Price',
    'Open Positions,Data,Summary,Stocks,USD,AAPL,10,1,180',
    'Open Positions,Data,Summary,Forex,USD,USD,5000,1,1',
    'Dividends,Header,Currency,Date,Description,Amount',
    'Dividends,Data,USD,2025-05-15,AAPL(US0378331005) Cash Dividend USD 0.26 per Share,2.60',
    'Withholding Tax,Data,USD,2025-05-15,AAPL(US0378331005) Cash Dividend USD 0.26 per Share - US Tax,-0.78,',
  ].join('\n');
  const imp = await s.req('POST', '/api/portfolio/import?base=USD', json(c, { csv }));
  assert.equal(imp.status, 200);
  assert.deepEqual(imp.json.imported, { added: 1, total: 1, failed: [], dividends: 1 });

  const stored = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'portfolio.json'), 'utf8'));
  const acc = stored.accounts.find((a) => a.id === stored.activeId);
  assert.deepEqual(acc.dividends, [{ symbol: 'AAPL', date: '2025-05-15', amount: 2.6, currency: 'USD', tax: 0.78 }]);
  assert.deepEqual(acc.positions.map((x) => [x.symbol, x.quantity, x.avgCost]), [['AAPL', 10, 180]]);
  assert.equal(fs.statSync(path.join(s.dataDir, 'portfolio.json')).mode & 0o777, 0o600);

  const d = (await s.req('GET', '/api/dividends?base=USD', json(c))).json;
  assert.deepEqual(d.received.total, { gross: 2.6, tax: 0.78, net: 1.82 });
  assert.deepEqual(d.bySymbol, [{ symbol: 'AAPL', gross: 2.6, tax: 0.78, net: 1.82 }]);
  assert.equal(d.recent[0].whtActual, true);

  // Replace drops the old holdings and dividends.
  const rep = await s.req('POST', '/api/portfolio/import?base=USD', json(c, { csv: 'Symbol,Quantity,Price\nMSFT,2,400', replace: true }));
  assert.deepEqual(rep.json.imported, { added: 1, total: 1, failed: [], dividends: 0 });
  const after = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'portfolio.json'), 'utf8')).accounts.find((a) => a.id === stored.activeId);
  assert.deepEqual(after.positions.map((x) => x.symbol), ['MSFT']); assert.deepEqual(after.dividends, []);
});

test('parallel writes serialize; the undo history keeps the last 25 changes', async (t) => {
  const s = await startServer(); t.after(() => s.stop());
  const c = await setup(s);
  const buys = await Promise.all(Array.from({ length: 12 }, () => s.req('POST', '/api/portfolio/buy?base=USD', json(c, { symbol: 'AAPL', quantity: 1.5, price: 100 }))));
  assert.ok(buys.every((r) => r.status === 200));
  let pf = (await s.req('GET', '/api/portfolio?base=USD', json(c))).json;
  assert.equal(pf.positions.find((x) => x.symbol === 'AAPL').quantity, 18);
  const stored = JSON.parse(fs.readFileSync(path.join(s.dataDir, 'portfolio.json'), 'utf8'));
  assert.equal(stored.accounts[0].transactions.length, 12);
  assert.equal(new Set(stored.accounts[0].transactions.map((x) => x.id)).size, 12);

  for (let i = 0; i < 16; i++) await s.req('POST', '/api/cash?base=USD', json(c, { ccy: 'USD', amount: 1000 + i }));
  assert.equal((await s.req('GET', '/api/undo', json(c))).json.available, 25);
  assert.equal(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'undo.json'), 'utf8')).length, 25);
  const u = await s.req('POST', '/api/undo', json(c));
  assert.equal(u.status, 200); assert.equal(u.json.available, 24);
  pf = (await s.req('GET', '/api/portfolio?base=USD', json(c))).json;
  assert.deepEqual(pf.cash, [{ ccy: 'USD', amount: 1014, base: 1014 }]);
});

test('a restart keeps the PIN, holdings and persisted quotes but not sessions; SIGTERM exits cleanly', async (t) => {
  const s = await startServer({ env: { FINSIGHT_CACHE_PERSIST: '' } }); t.after(() => s.stop());
  const c = await setup(s);
  await s.req('POST', '/api/portfolio/buy?base=USD', json(c, { symbol: 'AAPL', quantity: 3, price: 100 }));
  await s.req('POST', '/api/cash?base=USD', json(c, { ccy: 'SGD', amount: 2500 }));
  const live = (await s.req('GET', '/api/quote?symbols=AAPL', json(c))).json.quotes[0];
  assert.ok(live.price > 0);
  assert.deepEqual(await s.stop('SIGTERM'), { code: 0, signal: null });
  assert.equal(await listening(s.port), false);
  assert.match(s.output(), /SIGTERM received — closing server/);
  assert.deepEqual(fs.readdirSync(s.dataDir).filter((f) => f.includes('.tmp.')), [], 'no temp files left');
  assert.ok(fs.existsSync(path.join(s.dataDir, 'cache.json')));

  // Same store; every upstream fetch now fails, so a quote can only come from disk.
  const r = await startServer({ dataDir: s.dataDir, env: { FINSIGHT_CACHE_PERSIST: '', FETCH_PROBE_FAIL: '1' }, args: ['--import', PROBE] });
  t.after(() => r.stop());
  assert.deepEqual((await r.req('GET', '/api/auth/status', json(c))).json, { pinSet: true, authed: false });
  assert.equal((await r.req('GET', '/api/portfolio', json(c))).status, 401);
  const c2 = cookieOf(await r.req('POST', '/api/auth/login', json(null, { pin: '482916' })));
  const pf = (await r.req('GET', '/api/portfolio?base=USD', json(c2))).json;
  assert.equal(pf.positions.find((x) => x.symbol === 'AAPL').quantity, 3);
  assert.deepEqual(pf.cash.map((x) => [x.ccy, x.amount]), [['SGD', 2500]]);
  const q = (await r.req('GET', '/api/quote?symbols=AAPL', json(c2))).json.quotes[0];
  assert.equal(q.price, live.price);
});
